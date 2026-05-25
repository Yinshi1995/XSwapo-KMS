/**
 * KuCoinWalletMonitor — polls KuCoin deposit history for all tracked currencies
 * and emits `deposit.external` notifications for each new incoming transaction.
 *
 * Detection strategy: transaction-based (not balance-based).
 * Polls GET /api/v1/deposits?currency=X&status=SUCCESS&startAt=T on each cycle.
 * Any deposit with an unseen walletTxId triggers a notification.
 *
 * Advantages over balance-diff approach:
 *   - Catches multiple deposits in one interval independently
 *   - Not confused by concurrent withdrawals cancelling out the delta
 *   - Exact per-deposit amount, chain, fromAddress, txHash
 *
 * Env vars:
 *   KUCOIN_WALLET_MONITOR_INTERVAL_MS  (default 60 000)
 *   EXCHANGE_PROVIDER                   must be "kucoin" for monitor to activate
 */

import db from "../db/index"
import { emitNotification } from "./notifications/emit"
import { getExchangeProvider } from "./exchange"
import type { KuCoinExchangeAdapter } from "./exchange/kucoin/adapter"

const POLL_INTERVAL_MS = Number(process.env.KUCOIN_WALLET_MONITOR_INTERVAL_MS ?? 60_000)
const CURRENCY_REFRESH_INTERVAL_MS = 5 * 60 * 1000

// ─── State ────────────────────────────────────────────────────────────────────

/** epoch ms of last successful deposit check per currency */
const lastCheckMs = new Map<string, number>()

/** walletTxIds we have already notified about (survives within one process lifetime) */
const seenTxIds = new Set<string>()

let cachedCurrencies: string[] = []
let lastCurrencyRefreshMs = 0

// ─── Currency discovery ───────────────────────────────────────────────────────

async function getTrackedCurrencies(): Promise<string[]> {
  const now = Date.now()
  if (cachedCurrencies.length > 0 && now - lastCurrencyRefreshMs < CURRENCY_REFRESH_INTERVAL_MS) {
    return cachedCurrencies
  }

  // MasterWallet xpub format for KuCoin: "kucoin:{CURRENCY}:{chainCode}"
  const wallets = await db.masterWallet.findMany({
    where: { xpub: { startsWith: "kucoin:" } },
    select: { xpub: true },
  })

  const currencies = new Set<string>()
  for (const w of wallets) {
    const parts = w.xpub.split(":")
    if (parts.length >= 2 && parts[1]) {
      currencies.add(parts[1].toUpperCase())
    }
  }

  cachedCurrencies = [...currencies]
  lastCurrencyRefreshMs = now

  if (cachedCurrencies.length > 0) {
    console.info(`[kucoin-monitor] tracking currencies: ${cachedCurrencies.join(", ")}`)
  } else {
    console.info("[kucoin-monitor] no KuCoin-sourced wallets found in DB")
  }

  return cachedCurrencies
}

// ─── Per-currency poll ────────────────────────────────────────────────────────

async function pollCurrency(
  currency: string,
  adapter: KuCoinExchangeAdapter,
  now: number,
): Promise<void> {
  const since = lastCheckMs.get(currency)

  if (since === undefined) {
    // First poll — record current time as cursor, fetch nothing
    // (avoids replaying old history on startup)
    lastCheckMs.set(currency, now)
    console.info(`[kucoin-monitor] ${currency} cursor initialised at ${new Date(now).toISOString()}`)
    return
  }

  const deposits = await adapter.getRecentDeposits(currency, since)

  // Advance cursor regardless of results
  lastCheckMs.set(currency, now)

  const fresh = deposits.filter(
    (d) => d.status === "SUCCESS" && d.walletTxId && !seenTxIds.has(d.walletTxId),
  )

  if (fresh.length === 0) return

  console.info(`[kucoin-monitor] ${currency}: ${fresh.length} new deposit(s)`)

  for (const dep of fresh) {
    seenTxIds.add(dep.walletTxId)

    await emitNotification("deposit.external", {
      correlationId: dep.walletTxId || crypto.randomUUID(),
      summary: `+${dep.amount} ${currency} on KuCoin${dep.isInner ? " (internal transfer)" : ""}`,
      payload: {
        currency,
        amount: dep.amount,
        chain: dep.chain,
        txHash: dep.walletTxId,
        fromAddress: dep.address || undefined,
        isInner: dep.isInner,
        memo: dep.memo || undefined,
        fee: dep.fee || undefined,
      },
    })

    console.info(
      `[kucoin-monitor] deposit.external: ${currency} +${dep.amount} chain=${dep.chain} txHash=${dep.walletTxId}`,
    )
  }
}

// ─── Poll cycle ───────────────────────────────────────────────────────────────

async function runCycle(adapter: KuCoinExchangeAdapter): Promise<void> {
  const currencies = await getTrackedCurrencies()
  if (currencies.length === 0) return

  const now = Date.now()
  await Promise.allSettled(
    currencies.map((c) =>
      pollCurrency(c, adapter, now).catch((err) =>
        console.error(`[kucoin-monitor] error polling ${c}:`, err),
      ),
    ),
  )
}

// ─── Public class ─────────────────────────────────────────────────────────────

export class KuCoinWalletMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  start(): void {
    const provider = getExchangeProvider()
    if (provider.name !== "kucoin") {
      console.info(
        `[kucoin-monitor] exchange provider is "${provider.name}" — wallet monitor disabled`,
      )
      return
    }

    if (this.intervalId !== null) return

    const adapter = provider as KuCoinExchangeAdapter
    console.info(`[kucoin-monitor] starting, interval=${POLL_INTERVAL_MS}ms`)

    this.tick(adapter)
    this.intervalId = setInterval(() => this.tick(adapter), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.info("[kucoin-monitor] stopped")
    }
  }

  private tick(adapter: KuCoinExchangeAdapter): void {
    if (this.isRunning) {
      console.warn("[kucoin-monitor] skipping cycle: previous cycle still running")
      return
    }
    this.isRunning = true
    runCycle(adapter)
      .catch((err) => console.error("[kucoin-monitor] cycle error:", err))
      .finally(() => {
        this.isRunning = false
      })
  }
}

export const kuCoinWalletMonitor = new KuCoinWalletMonitor()
