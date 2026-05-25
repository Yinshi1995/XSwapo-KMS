/**
 * KuCoinWalletMonitor — polls ALL KuCoin-sourced wallets registered in the DB
 * for balance changes and emits `deposit.external` notifications with full
 * source context (chain, txId, fromAddress, isInner).
 *
 * Distinct from deposit-poller, which only watches addresses tied to active
 * ExchangeRequest records. This monitor covers:
 *   - Standalone top-ups to the KuCoin funding account
 *   - Internal KuCoin transfers
 *   - Any deposit that arrives outside of an open exchange request
 *
 * Balance snapshots are held in memory. On restart the first cycle re-establishes
 * the baseline without firing notifications.
 *
 * Env vars:
 *   KUCOIN_WALLET_MONITOR_INTERVAL_MS  (default 60 000)
 *   EXCHANGE_PROVIDER                   must be "kucoin" for monitor to activate
 */

import db from "../db/index"
import { emitNotification } from "./notifications/emit"
import { getExchangeProvider } from "./exchange"
import type { KuCoinExchangeAdapter } from "./exchange/kucoin/adapter"
import type { KuCoinDepositItem } from "./exchange/kucoin/types"
import { toDecimal, decimalGt, decimalSub } from "../lib/decimal"

const POLL_INTERVAL_MS = Number(process.env.KUCOIN_WALLET_MONITOR_INTERVAL_MS ?? 60_000)
// Re-read tracked currencies from DB every 5 minutes
const CURRENCY_REFRESH_INTERVAL_MS = 5 * 60 * 1000

// ─── State ───────────────────────────────────────────────────────────────────

interface Snapshot {
  balance: string     // last known balance (string decimal)
  lastCheckMs: number // epoch ms of last successful poll
}

const snapshots = new Map<string, Snapshot>()
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

// ─── Deposit matching ─────────────────────────────────────────────────────────

function findMatchingDeposits(
  deposits: KuCoinDepositItem[],
  deltaStr: string,
): KuCoinDepositItem[] {
  const delta = Number(deltaStr)
  return deposits.filter((d) => {
    if (d.status !== "SUCCESS") return false
    if (seenTxIds.has(d.walletTxId)) return false
    const amt = Number(d.amount)
    // Allow 1% tolerance for rounding / fee deduction
    return delta > 0 && Math.abs(amt - delta) / delta <= 0.01
  })
}

// ─── Per-currency poll ────────────────────────────────────────────────────────

async function pollCurrency(
  currency: string,
  adapter: KuCoinExchangeAdapter,
  now: number,
): Promise<void> {
  const balance = await adapter.getBalance(currency, "main")
  const snap = snapshots.get(currency)

  // First poll — establish baseline, do not notify
  if (!snap) {
    snapshots.set(currency, { balance, lastCheckMs: now })
    console.info(`[kucoin-monitor] ${currency} baseline established: ${balance}`)
    return
  }

  const delta = decimalSub(toDecimal(balance), toDecimal(snap.balance))

  // Update last-check time regardless of balance change
  snapshots.set(currency, { balance, lastCheckMs: now })

  if (!decimalGt(delta, 0)) return

  const deltaStr = delta.toFixed()
  console.info(
    `[kucoin-monitor] ${currency} balance increased: ${snap.balance} → ${balance} (+${deltaStr})`,
  )

  // Fetch deposit history to identify source
  let deposits: KuCoinDepositItem[] = []
  try {
    deposits = await adapter.getRecentDeposits(currency, snap.lastCheckMs)
  } catch (err) {
    console.warn(`[kucoin-monitor] failed to fetch deposit history for ${currency}:`, err)
  }

  const matched = findMatchingDeposits(deposits, deltaStr)

  if (matched.length > 0) {
    for (const dep of matched) {
      seenTxIds.add(dep.walletTxId)
      const summary = `+${dep.amount} ${currency} on KuCoin${dep.isInner ? " (internal transfer)" : ""}`
      await emitNotification("deposit.external", {
        correlationId: dep.walletTxId || crypto.randomUUID(),
        summary,
        payload: {
          currency,
          amount: dep.amount,
          chain: dep.chain,
          txHash: dep.walletTxId,       // "Tx" field in Telegram template
          fromAddress: dep.address || undefined,
          isInner: dep.isInner,
          memo: dep.memo || undefined,
          fee: dep.fee || undefined,
          balanceBefore: snap.balance,
          balanceAfter: balance,
        },
      })
      console.info(
        `[kucoin-monitor] deposit.external emitted: ${currency} +${dep.amount} txId=${dep.walletTxId} chain=${dep.chain}`,
      )
    }
  } else {
    // No matching deposit in history — could be API lag or internal ledger move
    // Still notify so operators are aware
    await emitNotification("deposit.external", {
      correlationId: crypto.randomUUID(),
      summary: `+${deltaStr} ${currency} on KuCoin (source not yet in deposit history)`,
      payload: {
        currency,
        amount: deltaStr,
        balanceBefore: snap.balance,
        balanceAfter: balance,
        sourceUnknown: true,
      },
    })
    console.warn(
      `[kucoin-monitor] ${currency} delta=+${deltaStr} but no matching deposit found — API lag?`,
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

    // Kick off immediately; subsequent cycles on interval
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
