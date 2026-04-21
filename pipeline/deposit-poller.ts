import db, { ExchangeRequestStatus } from "../db/index"
import { emitNotification } from "./notifications/emit"
import { getBalance } from "./kms-local"
import { decimalGt, toDecimal } from "../lib/decimal"
import { createSystemLog, getCoinNetworkMapping } from "./helpers"
import { exchangeRequestInclude, type ExchangeRequestContext } from "./types"
import { processPolledDeposit } from "./deposit-process"

let processDeposit: typeof processPolledDeposit = processPolledDeposit

// Test-only hook to avoid global module mocks leaking across files.
export function __setProcessDepositForTests(fn: typeof processPolledDeposit): void {
  processDeposit = fn
}

const POLL_INTERVAL_MS = Number(process.env.DEPOSIT_POLL_INTERVAL_MS ?? 30_000)
const DEPOSIT_TIMEOUT_HOURS = Number(process.env.DEPOSIT_TIMEOUT_HOURS ?? 6)
const POLL_CONCURRENCY = Math.max(1, Number(process.env.DEPOSIT_POLL_CONCURRENCY ?? 2))

const POLL_STATUSES = [ExchangeRequestStatus.CREATED, ExchangeRequestStatus.WAITING_DEPOSIT]

async function markRequestFailed(request: ExchangeRequestContext, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.exchangeRequest.update({
      where: { id: request.id },
      data: { status: ExchangeRequestStatus.FAILED, failedReason: reason },
    })
    await createSystemLog(tx, "warn", "DEPOSIT_TIMEOUT", reason, {
      exchangeRequestId: request.id,
      createdAt: request.createdAt.toISOString(),
    })
  })

  await emitNotification("deposit.expired", {
    correlationId: request.id,
    summary: `Deposit timeout for exchange request ${request.id}`,
    payload: {
      exchangeRequestId: request.id,
      reason,
      createdAt: request.createdAt.toISOString(),
    },
  })

  console.warn(`[deposit-poller] request ${request.id} marked FAILED: ${reason}`)
}

async function checkAndProcessDeposit(request: ExchangeRequestContext): Promise<void> {
  const tag = `[deposit-poller:${request.id}]`
  const depositAddress = request.depositAddress!
  const mapping = await getCoinNetworkMapping(request.fromCoinId, request.fromNetworkId)

  let result: { balance: string }
  try {
    result = await getBalance(
      {
        address: depositAddress.address,
        chain: request.fromNetwork.chain,
        contractAddress: mapping?.contractAddress ?? undefined,
        decimals: mapping?.decimals ?? undefined,
      },
      `poll:${request.id}`,
    )
  } catch (err) {
    console.error(`${tag} getBalance failed:`, err)
    return
  }

  if (!decimalGt(toDecimal(result.balance), 0)) return

  console.info(`${tag} balance detected: ${result.balance} ${request.fromCoin.code}`)
  await processDeposit(request, result.balance)
}

async function runPollCycle(): Promise<void> {
  const requests = await db.exchangeRequest.findMany({
    where: {
      status: { in: POLL_STATUSES },
      depositAddressId: { not: null },
    },
    include: exchangeRequestInclude,
  })

  if (requests.length === 0) return

  console.info(`[deposit-poller] polling ${requests.length} active request(s)`)

  const now = Date.now()
  const timeoutMs = DEPOSIT_TIMEOUT_HOURS * 60 * 60 * 1000
  const oldestCreatedAt = requests.reduce(
    (min, r) => (r.createdAt.getTime() < min ? r.createdAt.getTime() : min),
    requests[0]!.createdAt.getTime(),
  )
  const oldestAgeMs = now - oldestCreatedAt
  console.info(
    `[deposit-poller] timeout=${DEPOSIT_TIMEOUT_HOURS}h (${timeoutMs}ms), oldestAge=${oldestAgeMs}ms`,
  )

  const expired = requests.filter(r => now - r.createdAt.getTime() > timeoutMs)
  const pending = requests.filter(r => now - r.createdAt.getTime() <= timeoutMs)

  await Promise.allSettled(
    expired.map(r =>
      markRequestFailed(r, `Deposit not received within ${DEPOSIT_TIMEOUT_HOURS} hours`),
    ),
  )

  await promisePool(pending, POLL_CONCURRENCY, (r) => checkAndProcessDeposit(r))
}

async function promisePool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const item = items.shift()
      if (!item) return
      try {
        await fn(item)
      } catch (err) {
        // keep pool alive; per-item failures are logged by caller
        console.error("[deposit-poller] worker error:", err)
      }
    }
  })

  await Promise.all(workers)
}

export class DepositPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  start(): void {
    if (this.intervalId !== null) return
    console.info(`[deposit-poller] starting, interval=${POLL_INTERVAL_MS}ms`)
    this.runCycle()
    this.intervalId = setInterval(() => this.runCycle(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.info("[deposit-poller] stopped")
    }
  }

  private runCycle(): void {
    if (this.isRunning) {
      console.warn("[deposit-poller] skipping cycle: previous cycle still running")
      return
    }

    this.isRunning = true
    runPollCycle()
      .catch((err) => {
        // Postgres P2037 (TooManyConnections) can fire when the DB is saturated
        // by other services. Downgrade to a warning and retry on the next tick
        // instead of spamming a full stacktrace every cycle.
        const code = (err as { code?: string })?.code
        if (code === "P2037") {
          console.warn(
            "[deposit-poller] DB saturated (P2037 TooManyConnections) — retrying next cycle",
          )
          return
        }
        console.error("[deposit-poller] cycle error:", err)
      })
      .finally(() => {
        this.isRunning = false
      })
  }
}

export const depositPoller = new DepositPoller()
