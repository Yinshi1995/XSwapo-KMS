/**
 * pipeline/transfer-watcher.ts — background worker that detects on-chain
 * confirmation of outgoing internal transactions (CLIENT_REFUND,
 * TRANSFER_TO_BINANCE, GAS_TOPUP) and drives the downstream pipeline.
 *
 * In the webhook-driven era, Tatum notified us when a broadcasted transaction
 * got confirmed and we piggy-backed on the same handler (process.ts). Now that
 * we own the lifecycle, we poll `kms.getTxStatus()` for every BROADCASTED
 * internal transaction on a short interval and trigger the same follow-ups:
 *
 *   CLIENT_REFUND       → mark ExchangeRequest (partially-)refunded
 *   TRANSFER_TO_BINANCE → advance status to PROCESSING and start exchange
 *                          settlement (swap + withdraw)
 *   GAS_TOPUP           → resume the blocked client-deposit pipeline
 */

import db, {
  Prisma,
  TransactionStatus,
  TransactionType,
} from "../db/index"
import { emitNotification } from "./notifications/emit"
import { getTxStatus } from "./kms-local"
import {
  maybeResumePipelineAfterGasTopUp,
  updateRequestFromConfirmedInternalTransaction,
} from "./process"
import { maybeStartExchangeSettlementForConfirmedTransfer } from "./settlement"

const watcherTransactionInclude = {
  network: true,
} satisfies Prisma.TransactionInclude

type WatchedTransaction = Prisma.TransactionGetPayload<{
  include: typeof watcherTransactionInclude
}>

// ─── Tuning ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Number(process.env.TRANSFER_WATCHER_INTERVAL_MS ?? 30_000)
const MAX_CONFIRMATION_AGE_MS = Number(
  process.env.TRANSFER_WATCHER_MAX_AGE_MS ?? 24 * 60 * 60 * 1000,
)

const WATCHED_TYPES: TransactionType[] = [
  TransactionType.CLIENT_REFUND,
  TransactionType.TRANSFER_TO_BINANCE,
  TransactionType.GAS_TOPUP,
]

// ─── Fetch ───────────────────────────────────────────────────────────

async function findBroadcastedTransactions(): Promise<WatchedTransaction[]> {
  const cutoff = new Date(Date.now() - MAX_CONFIRMATION_AGE_MS)
  return db.transaction.findMany({
    where: {
      status: TransactionStatus.BROADCASTED,
      type: { in: WATCHED_TYPES },
      createdAt: { gte: cutoff },
      NOT: { txHash: null },
    },
    include: watcherTransactionInclude,
    orderBy: { createdAt: "asc" },
    take: 50,
  })
}

// ─── Persist confirmation ────────────────────────────────────────────

async function markConfirmed(txRecord: WatchedTransaction, blockNumber: number | null) {
  return db.$transaction(async (tx) => {
    const updated = await tx.transaction.update({
      where: { id: txRecord.id },
      data: {
        status: TransactionStatus.CONFIRMED,
        blockNumber: blockNumber ?? txRecord.blockNumber,
        confirmedAt: new Date(),
      },
    })
    await updateRequestFromConfirmedInternalTransaction(tx, updated)
    return updated
  })
}

async function markFailed(txRecord: WatchedTransaction) {
  return db.transaction.update({
    where: { id: txRecord.id },
    data: {
      status: TransactionStatus.FAILED,
      failedReason: txRecord.failedReason ?? "on-chain transaction reverted",
    },
  })
}

// ─── Single-transaction tick ─────────────────────────────────────────

async function processPendingTransaction(txRecord: WatchedTransaction): Promise<void> {
  const tag = `[tx-watcher:${txRecord.id}]`
  const chain = txRecord.network?.chain

  if (!txRecord.txHash || !chain) {
    console.warn(`${tag} skipping — missing txHash or network.chain`)
    return
  }

  let result: Awaited<ReturnType<typeof getTxStatus>>
  try {
    result = await getTxStatus(txRecord.txHash, chain)
  } catch (err) {
    console.warn(`${tag} getTxStatus failed:`, err instanceof Error ? err.message : err)
    return
  }

  if (result.status === "pending") return

  if (result.status === "failed") {
    console.warn(`${tag} on-chain tx ${txRecord.txHash} FAILED`)
    await markFailed(txRecord)
    await emitNotification("system.error", {
      correlationId: txRecord.exchangeRequestId ?? txRecord.id,
      summary: `On-chain transaction failed: ${txRecord.type} ${txRecord.txHash}`,
      payload: {
        transactionId: txRecord.id,
        type: txRecord.type,
        txHash: txRecord.txHash,
        chain,
        exchangeRequestId: txRecord.exchangeRequestId,
      },
    })
    return
  }

  console.info(`${tag} on-chain tx ${txRecord.txHash} CONFIRMED (block=${result.blockNumber ?? "?"})`)
  const confirmed = await markConfirmed(txRecord, result.blockNumber ?? null)

  const confirmedEventType =
    confirmed.type === TransactionType.CLIENT_REFUND
      ? "refund.completed"
      : confirmed.type === TransactionType.GAS_TOPUP
        ? "gas.topup.completed"
        : "transfer.confirmed"

  await emitNotification(confirmedEventType as Parameters<typeof emitNotification>[0], {
    correlationId: confirmed.exchangeRequestId ?? confirmed.id,
    summary: `${confirmed.type} confirmed on ${chain} (tx ${confirmed.txHash})`,
    payload: {
      transactionId: confirmed.id,
      type: confirmed.type,
      txHash: confirmed.txHash,
      chain,
      blockNumber: confirmed.blockNumber,
      exchangeRequestId: confirmed.exchangeRequestId,
    },
  })

  try {
    if (confirmed.type === TransactionType.TRANSFER_TO_BINANCE) {
      await maybeStartExchangeSettlementForConfirmedTransfer(confirmed)
    } else if (confirmed.type === TransactionType.GAS_TOPUP) {
      await maybeResumePipelineAfterGasTopUp(confirmed)
    }
  } catch (err) {
    console.error(`${tag} post-confirmation hook failed:`, err)
  }
}

// ─── Loop lifecycle ──────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function tick() {
  if (running) return
  running = true
  try {
    const batch = await findBroadcastedTransactions()
    if (batch.length === 0) return
    console.debug(`[tx-watcher] processing ${batch.length} pending transaction(s)`)
    for (const record of batch) {
      await processPendingTransaction(record)
    }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === "P2037") {
      console.warn(
        "[tx-watcher] DB saturated (P2037 TooManyConnections) — retrying next tick",
      )
    } else {
      console.error("[tx-watcher] tick failed:", err)
    }
  } finally {
    running = false
  }
}

export function startTransferWatcher(): () => void {
  if (timer) return stopTransferWatcher
  console.info(`[tx-watcher] starting (interval=${POLL_INTERVAL_MS}ms)`)
  void tick()
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  return stopTransferWatcher
}

export function stopTransferWatcher() {
  if (timer) {
    clearInterval(timer)
    timer = null
    console.info("[tx-watcher] stopped")
  }
}
