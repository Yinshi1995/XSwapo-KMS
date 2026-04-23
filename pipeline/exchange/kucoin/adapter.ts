/**
 * KuCoin exchange provider adapter.
 *
 * Implements ExchangeProvider using the KuCoin REST API via the
 * authenticated KuCoinClient.
 *
 * Settlement flow:
 *   1. Poll deposit history until KuCoin credits the deposit (status=SUCCESS)
 *   2. Get convert quote  (GET  /api/v1/convert/quote)       — permission: Spot
 *   3. Execute convert     (POST /api/v1/convert/order)       — permission: Spot
 *   4. Move converted funds from TRADE to MAIN (POST /api/v2/accounts/inner-transfer) — permission: Transfer
 *   5. Check withdrawal quotas (GET /api/v1/withdrawals/quotas)
 *   6. Withdraw            (POST /api/v3/withdrawals)         — permission: Withdrawal
 *
 * ⚠ Deposit address endpoint:
 *   GET uses the UTA endpoint (GET /api/ua/v1/asset/deposit/address) which supports
 *   the required `chain` filter parameter (e.g. ?currency=BNB&chain=bsc).
 *   POST (create) still uses the Classic POST /api/v1/deposit-addresses.
 *
 * ⚠ KuCoin network chain mapping:
 *   KuCoin uses lowercase chain identifiers (e.g. "bsc", "eth", "trx").
 *   resolveChainForCurrency() dynamically resolves the correct chainId
 *   by querying GET /api/v3/currencies/{currency} and matching against
 *   the candidate chain code from the database (Network.kucoinChainCode).
 */

import crypto from "crypto"

import type { KuCoinConfig } from "../config"
import type {
  ExchangeDepositAddress,
  ExchangeProvider,
  ExchangeSettlementParams,
  ExchangeSettlementResult,
} from "../types"
import { KuCoinApiError, KuCoinClient } from "./client"
import { truncateDp } from "../../../lib/decimal"
import type {
  KuCoinAccount,
  KuCoinConvertOrderResult,
  KuCoinConvertQuote,
  KuCoinCreatedDepositAddress,
  KuCoinCurrency,
  KuCoinCurrencyChain,
  KuCoinDepositAddress,
  KuCoinDepositItem,
  KuCoinDepositList,
  KuCoinInnerTransferResult,
  KuCoinMarketStats,
  KuCoinWithdrawalQuotas,
  KuCoinWithdrawResult,
} from "./types"

/** TTL for the in-memory currency-chain cache (10 minutes). */
const CHAIN_CACHE_TTL_MS = 10 * 60 * 1000

const KUCOIN_CLIENT_REFERENCE_MAX_LENGTH = 40

function buildKuCoinClientReference(prefix: string, key: string): string {
  const normalizedPrefix = prefix.trim()
  const normalizedKey = key.trim()
  const direct = `${normalizedPrefix}-${normalizedKey}`

  if (direct.length <= KUCOIN_CLIENT_REFERENCE_MAX_LENGTH) {
    return direct
  }

  const hash = crypto.createHash("sha256").update(normalizedKey).digest("hex").slice(0, 16)
  const visibleKeyLength = Math.max(
    KUCOIN_CLIENT_REFERENCE_MAX_LENGTH - normalizedPrefix.length - hash.length - 2,
    0,
  )
  const shortened = visibleKeyLength > 0
    ? `${normalizedPrefix}-${normalizedKey.slice(0, visibleKeyLength)}-${hash}`
    : `${normalizedPrefix}-${hash}`

  console.info(
    `[kucoin] Shortened external client reference for prefix=${normalizedPrefix}: originalLength=${direct.length} shortened=${shortened}`,
  )

  return shortened
}

function normalizeKuCoinAmount(amount: string): string {
  // KuCoin inner-transfer / withdrawal APIs reject amounts with >8 decimal places.
  // Truncate (floor) to 8dp via Rust so we never send more than available balance.
  return truncateDp(amount, 8).toFixed()
}

function isKuCoinNoBalanceError(error: unknown): error is KuCoinApiError {
  return error instanceof KuCoinApiError
    && error.code === "230003"
    && error.kucoinMessage.toLowerCase().includes("no balance")
}

/** KuCoin 300000 "repeated requests" means the clientOid was already accepted — treat as success. */
function isKuCoinRepeatedRequestError(error: unknown): error is KuCoinApiError {
  return error instanceof KuCoinApiError && error.code === "300000"
}

/** KuCoin 102421 "Insufficient account balance" — deposit credited but balance not yet available. */
function isKuCoinInsufficientBalanceError(error: unknown): error is KuCoinApiError {
  return error instanceof KuCoinApiError && error.code === "102421"
}

/** KuCoin 115008 — funds locked after internal transfer, retry until unlocked. */
function isKuCoinWithdrawalLockedError(error: unknown): error is KuCoinApiError {
  return error instanceof KuCoinApiError && error.code === "115008"
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError")
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export class KuCoinExchangeAdapter implements ExchangeProvider {
  readonly name = "kucoin" as const
  private readonly client: KuCoinClient
  /** Per-currency cache: currency → { chains, expiresAt } */
  private readonly currencyChainCache = new Map<string, { chains: KuCoinCurrencyChain[]; expiresAt: number }>()

  constructor(private readonly config: KuCoinConfig) {
    this.client = new KuCoinClient(config)
  }

  // ─── Chain resolution ──────────────────────────────────────────────

  /**
   * Fetch available chains for a currency from KuCoin (with in-memory cache).
   */
  private async getCurrencyChains(
    currency: string,
    signal?: AbortSignal,
  ): Promise<KuCoinCurrencyChain[]> {
    const key = currency.toUpperCase()
    const cached = this.currencyChainCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.chains
    }

    const info = await this.client.request<KuCoinCurrency>(
      `/api/v3/currencies/${key}`,
      { method: "GET", signal },
    )

    const chains = info.chains ?? []
    this.currencyChainCache.set(key, {
      chains,
      expiresAt: Date.now() + CHAIN_CACHE_TTL_MS,
    })

    return chains
  }

  /**
   * Resolve the correct KuCoin `chainId` for a (currency, candidateChain) pair.
   *
   * Queries `GET /api/v3/currencies/{currency}` to get chains available on KuCoin,
   * then matches the candidate (typically `Network.kucoinChainCode` from our DB)
   * against the returned `chainId` / `chainName` values.
   *
   * If the KuCoin API call fails, falls back to the candidate as-is (lowercase).
   * This ensures the flow is not blocked by transient KuCoin outages when our DB
   * already has the correct chain code.
   *
   * Matching order:
   *   1. Exact match on `chainId`
   *   2. Exact match on `chainName`
   *   3. Single-chain currency — use the only available option
   *   4. No match → fall back to candidate with a warning
   */
  private async resolveChainForCurrency(
    currency: string,
    candidateChain: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const candidate = candidateChain.toLowerCase()

    let chains: KuCoinCurrencyChain[]
    try {
      chains = await this.getCurrencyChains(currency, signal)
    } catch (error) {
      console.warn(
        `[kucoin] Failed to fetch chains for ${currency}, falling back to candidate "${candidate}":`,
        error instanceof Error ? error.message : error,
      )
      return candidate
    }

    if (chains.length === 0) {
      console.warn(
        `[kucoin] Currency ${currency} returned 0 chains, falling back to candidate "${candidate}"`,
      )
      return candidate
    }

    // 1. Exact match on chainId
    const byId = chains.find(c => c.chainId.toLowerCase() === candidate)
    if (byId) return byId.chainId

    // 2. Match on chainName (case-insensitive)
    const byName = chains.find(c => c.chainName.toLowerCase() === candidate)
    if (byName) return byName.chainId

    // 3. Single-chain currency — use the only option
    if (chains.length === 1) {
      console.warn(
        `[kucoin] Chain "${candidateChain}" not found for ${currency}, ` +
        `using only available chain "${chains[0].chainId}" (${chains[0].chainName})`,
      )
      return chains[0].chainId
    }

    // 4. No match — fall back to candidate (our DB value is more likely correct
    //    than crashing the whole flow)
    const available = chains
      .map(c => `${c.chainId} (${c.chainName})`)
      .join(", ")
    console.warn(
      `[kucoin] Chain "${candidateChain}" not matched for ${currency}. ` +
      `Available: ${available}. Falling back to "${candidate}".`,
    )
    return candidate
  }

  // ─── ExchangeProvider.getDepositAddress ────────────────────────────

  async getDepositAddress(
    coin: string,
    network: string,
    signal?: AbortSignal,
  ): Promise<ExchangeDepositAddress> {
    const currency = coin.toUpperCase()
    const chain = await this.resolveChainForCurrency(currency, network, signal)

    // Try to get an existing deposit address (UTA endpoint, supports chain filter)
    const addresses = await this.client.request<KuCoinDepositAddress[]>(
      "/api/ua/v1/asset/deposit/address",
      { method: "GET", params: { currency, chain }, signal },
    )

    const existing = addresses.find(
      (a) => a.chain?.toLowerCase() === chain.toLowerCase() ||
             a.chainId?.toLowerCase() === chain.toLowerCase(),
    )
    if (existing) {
      return {
        address: existing.address,
        memo: existing.memo || undefined,
      }
    }

    // No address found — create one
    console.info(
      `[kucoin] No existing deposit address for ${currency}/${chain}, creating one`,
    )
    const created = await this.client.request<KuCoinCreatedDepositAddress>(
      "/api/v1/deposit-addresses",
      {
        method: "POST",
        body: { currency, chain },
        signal,
      },
    )

    return {
      address: created.address,
      memo: created.memo || undefined,
    }
  }

  // ─── Internal: gas cost conversion ─────────────────────────────────

  /**
   * Get the last-traded price of nativeCoin denominated in tokenCoin.
   * Example: nativeCoin=ETH, tokenCoin=USDT → returns "2000.00"
   *
   * Tries the symbol pair in both orders. Returns null on any failure so the
   * caller can decide whether to proceed without a gas deduction.
   */
  private async getNativePriceInToken(
    nativeCoin: string,
    tokenCoin: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const native = nativeCoin.toUpperCase()
    const token = tokenCoin.toUpperCase()

    if (native === token) return "1"

    // Try native-token first (e.g. ETH-USDT), then token-native as fallback
    for (const [from, to, inverse] of [[native, token, false], [token, native, true]] as const) {
      const symbol = `${from}-${to}`
      try {
        const stats = await this.client.request<KuCoinMarketStats>(
          "/api/v1/market/stats",
          { method: "GET", params: { symbol }, signal },
        )
        if (!stats.last || Number(stats.last) <= 0) continue
        if (inverse) {
          // token-native price → invert to get native-token price
          return (1 / Number(stats.last)).toFixed(8)
        }
        return stats.last
      } catch {
        // try next orientation
      }
    }

    return null
  }

  /**
   * Compute the effective exchange amount, deducting token-sweep gas cost.
   *
   * For token (non-native) sweeps the KMS pays gas from our gas wallet. We
   * keep the gas equivalent in our KuCoin account as reimbursement instead
   * of exchanging it for the client.
   *
   * Returns the adjusted depositAmount string, or the original if no gas
   * cost is available / price lookup fails.
   */
  private async computeExchangeAmount(
    depositAmount: string,
    depositCoin: string,
    gasCostNative: string | undefined,
    nativeCoin: string | undefined,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!gasCostNative || !nativeCoin || Number(gasCostNative) <= 0) {
      return depositAmount
    }

    const price = await this.getNativePriceInToken(nativeCoin, depositCoin, signal)
    if (!price) {
      console.warn(
        `[kucoin] Could not fetch ${nativeCoin}/${depositCoin} price for gas deduction; ` +
        `proceeding with full depositAmount=${depositAmount}`,
      )
      return depositAmount
    }

    const gasCostInToken = Number(gasCostNative) * Number(price)
    const exchangeAmount = Number(depositAmount) - gasCostInToken

    if (exchangeAmount <= 0) {
      console.warn(
        `[kucoin] Gas cost (${gasCostNative} ${nativeCoin} ≈ ${gasCostInToken.toFixed(8)} ${depositCoin}) ` +
        `exceeds depositAmount=${depositAmount}; proceeding without deduction`,
      )
      return depositAmount
    }

    const adjusted = normalizeKuCoinAmount(exchangeAmount.toFixed(8))
    console.info(
      `[kucoin] Gas deduction: depositAmount=${depositAmount} ${depositCoin} ` +
      `— gasCost=${gasCostNative} ${nativeCoin} ≈ ${gasCostInToken.toFixed(8)} ${depositCoin} ` +
      `→ exchangeAmount=${adjusted}`,
    )
    return adjusted
  }

  // ─── ExchangeProvider.executeSettlement ─────────────────────────────

  async executeSettlement(
    params: ExchangeSettlementParams,
  ): Promise<ExchangeSettlementResult> {
    const { signal } = params
    const chain = await this.resolveChainForCurrency(params.depositCoin.toUpperCase(), params.depositNetwork, signal)
    const withdrawChain = await this.resolveChainForCurrency(params.withdrawCoin.toUpperCase(), params.withdrawNetwork, signal)

    // 1. Wait for deposit to be credited on KuCoin.
    // depositItem.amount is what KuCoin actually credited (may differ from
    // params.depositAmount due to network fees deducted by KuCoin).
    const depositItem = await this.waitForDeposit(
      params.depositCoin.toUpperCase(),
      chain,
      params.depositAmount,
      params.depositTxId,
      params.depositStartTime,
      signal,
    )

    // 1b. Wait until the credited amount is actually available for operations.
    await this.waitForBalance(
      params.depositCoin.toUpperCase(),
      depositItem.amount,
      signal,
    )

    // 1c. For token sweeps: deduct gas cost from exchange amount so we keep
    //     the gas equivalent in KuCoin as reimbursement for our gas wallet spend.
    //     Native coin sweeps: gas was already deducted from depositAmount by KMS.
    const exchangeAmount = normalizeKuCoinAmount(
      await this.computeExchangeAmount(
        depositItem.amount,
        params.depositCoin.toUpperCase(),
        params.depositGasCostNative,
        params.depositNetworkNativeCoin?.toUpperCase(),
        signal,
      ),
    )

    let withdrawAmount = normalizeKuCoinAmount(params.withdrawAmount)
    let convertOrderId: string | undefined

    // 2. Convert if needed
    if (params.needsSwap) {
      const maxConvertAttempts = Math.max(1, this.config.convertRetryCount)
      let lastQuote: KuCoinConvertQuote | undefined

      for (let attempt = 1; attempt <= maxConvertAttempts; attempt += 1) {
        try {
          const quote = await this.getConvertQuote(
            params.sourceCoin.toUpperCase(),
            params.targetCoin.toUpperCase(),
            exchangeAmount,
            signal,
          )
          lastQuote = quote

          const clientOrderId = buildKuCoinClientReference(
            "conv",
            params.withdrawOrderId,
          )
          const order = await this.executeConvertOrder(
            quote.quoteId,
            clientOrderId,
            signal,
          )
          convertOrderId = order.orderId
          break
        } catch (error) {
          if (isKuCoinInsufficientBalanceError(error) && attempt < maxConvertAttempts) {
            console.info(
              `[kucoin] Convert balance not ready yet; retrying in ${this.config.convertRetryDelayMs}ms (attempt ${attempt}/${maxConvertAttempts})`,
            )
            await sleep(this.config.convertRetryDelayMs, signal)
            continue
          }
          throw error
        }
      }

      if (!convertOrderId || !lastQuote) {
        throw new Error(`KuCoin convert exhausted retries for ${params.sourceCoin} → ${params.targetCoin}`)
      }

      // Use the actual converted amount as the withdraw amount — the market rate
      // at settlement time may differ slightly from what was promised to the client.
      withdrawAmount = normalizeKuCoinAmount(lastQuote.toCurrencySize)

      // KuCoin convert credits the trade account; wait for the actual converted
      // amount to land there before moving funds.
      await this.waitForBalance(
        params.targetCoin.toUpperCase(),
        withdrawAmount,
        signal,
        "trade",
      )

      // Move funds from trade to main before withdrawal.
      await this.transferBetweenAccounts(
        params.targetCoin.toUpperCase(),
        withdrawAmount,
        buildKuCoinClientReference("it", params.withdrawOrderId),
        signal,
      )
    } else {
      if (Number(exchangeAmount) < Number(withdrawAmount)) {
        throw new Error(
          `KuCoin effective exchange amount ${exchangeAmount} (deposit=${params.depositAmount} minus gas) ` +
          `is below requested withdraw amount ${withdrawAmount}`,
        )
      }

      // Preserve the legacy optional transfer for non-swap settlements.
      if (this.config.flexTransferEnabled) {
        await this.transferBetweenAccounts(
          params.withdrawCoin.toUpperCase(),
          withdrawAmount,
          buildKuCoinClientReference("it", params.withdrawOrderId),
          signal,
          true,
        )
      }
    }

    // 4. Pre-flight: check withdrawal quotas
    const quotas = await this.getWithdrawalQuotas(
      params.withdrawCoin.toUpperCase(),
      withdrawChain,
      signal,
    )
    this.validateWithdrawal(quotas, withdrawAmount, params.withdrawCoin)

    // 5. Withdraw to client address.
    // Retry on 115008 — KuCoin temporarily locks funds after an internal transfer.
    const withdrawParams = {
      currency: params.withdrawCoin.toUpperCase(),
      toAddress: params.withdrawAddress,
      amount: withdrawAmount,
      withdrawType: "ADDRESS" as const,
      chain: withdrawChain,
      remark: `xswapo-${params.withdrawOrderId}`,
    }

    let withdrawal: KuCoinWithdrawResult | undefined
    const withdrawPollInterval = this.config.depositPollIntervalMs
    const withdrawTimeout = this.config.depositPollTimeoutMs
    const withdrawStart = Date.now()

    while (!withdrawal) {
      try {
        withdrawal = await this.withdraw(withdrawParams, signal)
      } catch (error) {
        if (isKuCoinWithdrawalLockedError(error)) {
          if (Date.now() - withdrawStart >= withdrawTimeout) {
            throw new Error(`Timed out waiting for withdrawal lock to be released: ${(error as KuCoinApiError).kucoinMessage}`)
          }
          console.info(`[kucoin] Withdrawal locked (115008), retrying in ${withdrawPollInterval}ms...`)
          await sleep(withdrawPollInterval, signal)
          continue
        }
        throw error
      }
    }

    console.info(
      `[kucoin] Settlement completed: withdrawalId=${withdrawal.withdrawalId} amount=${withdrawAmount}`,
    )

    return {
      withdrawalId: withdrawal.withdrawalId,
      withdrawAmount,
      orderInfo: convertOrderId
        ? { orderId: convertOrderId }
        : undefined,
    }
  }

  // ─── Public: deposit checking for external polling ──────────────────

  /**
   * Check for deposits matching the given criteria (non-blocking).
   * Returns the deposit if found, null otherwise.
   * Used by deposit-poller for KUCOIN-sourced networks.
   * 
   * @deprecated Use findMatchingDeposit for exchange-managed deposits (no address filtering)
   */
  async checkDeposit(
    currency: string,
    network: string,
    address: string,
    minAmount?: string,
    startAt?: number,
    signal?: AbortSignal,
  ): Promise<{ amount: string; txId?: string; status: string } | null> {
    const chain = await this.resolveChainForCurrency(currency.toUpperCase(), network, signal)

    const deposits = await this.client.request<KuCoinDepositList>(
      "/api/v1/deposits",
      {
        method: "GET",
        params: {
          currency: currency.toUpperCase(),
          status: "SUCCESS",
          ...(startAt ? { startAt } : {}),
        },
        signal,
      },
    )

    for (const item of deposits.items) {
      if (item.currency.toUpperCase() !== currency.toUpperCase()) continue
      if (item.chain.toLowerCase() !== chain.toLowerCase()) continue
      if (item.address.toLowerCase() !== address.toLowerCase()) continue

      // If minAmount specified, check it matches approximately
      if (minAmount) {
        const minNum = Number(minAmount)
        const itemNum = Number(item.amount)
        // Allow 1% tolerance for network fees
        if (itemNum < minNum * 0.99) continue
      }

      return {
        amount: item.amount,
        txId: item.walletTxId,
        status: item.status,
      }
    }

    return null
  }

  /**
   * Find a matching deposit for exchange-managed networks (like XMR).
   * Does NOT filter by address — matches by currency, chain, amount, and time.
   * The caller must check if the returned txId was already processed.
   */
  async findMatchingDeposit(
    currency: string,
    network: string,
    expectedAmount: string,
    createdAfter: number,
    signal?: AbortSignal,
  ): Promise<{ amount: string; txId?: string; status: string } | null> {
    const chain = await this.resolveChainForCurrency(currency.toUpperCase(), network, signal)

    const deposits = await this.client.request<KuCoinDepositList>(
      "/api/v1/deposits",
      {
        method: "GET",
        params: {
          currency: currency.toUpperCase(),
          status: "SUCCESS",
          startAt: createdAfter,
        },
        signal,
      },
    )

    const expectedNum = Number(expectedAmount)

    for (const item of deposits.items) {
      if (item.currency.toUpperCase() !== currency.toUpperCase()) continue
      if (item.chain.toLowerCase() !== chain.toLowerCase()) continue

      // Check amount matches within 5% tolerance (for network fees)
      const itemNum = Number(item.amount)
      const tolerance = expectedNum * 0.05
      if (Math.abs(itemNum - expectedNum) > tolerance) continue

      // Check deposit was created after the request
      if (item.createdAt < createdAfter) continue

      return {
        amount: item.amount,
        txId: item.walletTxId,
        status: item.status,
      }
    }

    return null
  }

  // ─── Internal: deposit polling ──────────────────────────────────────

  private async waitForDeposit(
    currency: string,
    chain: string,
    amount: string,
    txId?: string,
    startAt?: number,
    signal?: AbortSignal,
  ): Promise<KuCoinDepositItem> {
    const pollInterval = this.config.depositPollIntervalMs
    const timeout = this.config.depositPollTimeoutMs
    const start = Date.now()

    console.info(
      `[kucoin] Waiting for deposit: ${currency}/${chain} amount=${amount} txId=${txId ?? "N/A"}`,
    )

    while (Date.now() - start <= timeout) {
      if (signal?.aborted) throw abortError()

      const deposits = await this.client.request<KuCoinDepositList>(
        "/api/v1/deposits",
        {
          method: "GET",
          params: {
            currency,
            status: "SUCCESS",
            ...(startAt ? { startAt } : {}),
          },
          signal,
        },
      )

      const match = this.findMatchingDeposit(
        deposits.items,
        currency,
        chain,
        amount,
        txId,
      )
      if (match) {
        console.info(
          `[kucoin] Deposit confirmed: walletTxId=${match.walletTxId} amount=${match.amount}`,
        )
        return match
      }

      await sleep(pollInterval, signal)
    }

    throw new Error(
      `Timed out waiting for KuCoin deposit: ${currency}/${chain} amount=${amount}`,
    )
  }

  private findMatchingDeposit(
    items: KuCoinDepositItem[],
    currency: string,
    chain: string,
    amount: string,
    txId?: string,
  ): KuCoinDepositItem | null {
    const normalizedTxId = txId?.trim().toLowerCase()

    for (const item of items) {
      if (item.currency.toUpperCase() !== currency.toUpperCase()) continue
      if (item.chain.toLowerCase() !== chain.toLowerCase()) continue

      // Primary match by on-chain tx hash
      if (normalizedTxId && item.walletTxId) {
        // KuCoin walletTxId may include "@internal" suffix for inner transfers
        const itemTxId = item.walletTxId.split("@")[0].toLowerCase()
        if (itemTxId === normalizedTxId) return item
      }

      // Fallback: match by amount if no txId available
      if (!normalizedTxId && item.amount === amount) return item
    }

    return null
  }

  // ─── Internal: balance polling ──────────────────────────────────────

  /**
   * Poll /api/v1/accounts until the main account has available balance for the currency.
   * Prevents racing into convert/transfer before KuCoin credits the balance.
   */
  private async waitForBalance(
    currency: string,
    minAmount: string,
    signal?: AbortSignal,
    accountType: string = "main",
  ): Promise<void> {
    const pollInterval = this.config.depositPollIntervalMs
    const timeout = this.config.depositPollTimeoutMs
    const start = Date.now()
    const minNum = Number(minAmount)

    console.info(
      `[kucoin] Waiting for available balance: ${currency} >= ${minAmount} (${accountType})`,
    )

    while (Date.now() - start <= timeout) {
      if (signal?.aborted) throw abortError()

      const accounts = await this.client.request<KuCoinAccount[]>(
        "/api/v1/accounts",
        {
          method: "GET",
          params: { currency, type: accountType },
          signal,
        },
      )

      const account = accounts.find((a) => a.type === accountType)
      if (account && Number(account.available) >= minNum) {
        console.info(
          `[kucoin] Balance available: ${currency} ${accountType} available=${account.available}`,
        )
        return
      }

      console.info(
        `[kucoin] Balance not ready: ${currency} ${accountType} available=${account?.available ?? "0"}, waiting ${pollInterval}ms...`,
      )

      await sleep(pollInterval, signal)
    }

    throw new Error(
      `Timed out waiting for KuCoin balance: ${currency} >= ${minAmount} (${accountType})`,
    )
  }

  // ─── Internal: convert ──────────────────────────────────────────────

  private async getConvertQuote(
    fromCurrency: string,
    toCurrency: string,
    fromCurrencySize: string,
    signal?: AbortSignal,
  ): Promise<KuCoinConvertQuote> {
    console.info(
      `[kucoin] Getting convert quote: ${fromCurrency} → ${toCurrency}, size=${fromCurrencySize}`,
    )

    const quote = await this.client.request<KuCoinConvertQuote>(
      "/api/v1/convert/quote",
      {
        method: "GET",
        params: { fromCurrency, toCurrency, fromCurrencySize },
        signal,
      },
    )

    console.info(
      `[kucoin] Quote received: quoteId=${quote.quoteId} price=${quote.price} toCurrencySize=${quote.toCurrencySize} expiry=${quote.validUntill}`,
    )

    // Ensure quote hasn't already expired
    if (quote.validUntill && Date.now() > quote.validUntill) {
      throw new Error(
        `KuCoin convert quote ${quote.quoteId} expired before execution (expiry=${quote.validUntill})`,
      )
    }

    return quote
  }

  private async executeConvertOrder(
    quoteId: string,
    clientOrderId: string,
    signal?: AbortSignal,
  ): Promise<KuCoinConvertOrderResult> {
    console.info(
      `[kucoin] Executing convert order: quoteId=${quoteId} clientOrderId=${clientOrderId}`,
    )

    const body = {
      clientOrderId,
      quoteId,
      accountType: this.config.convertAccountType,
    }

    const result = await this.client.request<KuCoinConvertOrderResult>(
      "/api/v1/convert/order",
      { method: "POST", body, signal },
    )

    if (result.orderStatus === "FAIL") {
      throw new Error(
        `KuCoin convert order failed: orderId=${result.orderId} quoteId=${quoteId}`,
      )
    }

    if (result.orderStatus === "PROCESSING") {
      // KuCoin convert is typically synchronous. If PROCESSING is returned,
      // it may complete shortly. For now we treat PROCESSING as an error
      // since there is no documented polling endpoint for convert orders.
      // TODO: verify whether GET /api/v1/convert/order/{orderId} exists.
      throw new Error(
        `KuCoin convert order still processing: orderId=${result.orderId} quoteId=${quoteId}. ` +
        `This may require manual intervention or retry.`,
      )
    }

    console.info(
      `[kucoin] Convert order SUCCESS: orderId=${result.orderId}`,
    )

    return result
  }

  // ─── Internal: account transfer ─────────────────────────────────────

  private async transferBetweenAccounts(
    currency: string,
    amount: string,
    clientOid: string,
    signal?: AbortSignal,
    allowFailure = false,
  ): Promise<void> {
    const maxAttempts = Math.max(1, this.config.innerTransferRetryCount)

    console.info(
      `[kucoin] Inner transfer: ${currency} ${amount} TRADING → MAIN`,
    )

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.client.request<KuCoinInnerTransferResult>(
          "/api/v3/accounts/universal-transfer",
          {
            method: "POST",
            body: {
              clientOid,
              type: "INTERNAL",
              currency,
              amount,
              fromAccountType: "TRADE",
              toAccountType: "MAIN",
            },
            signal,
          },
        )

        console.info(
          `[kucoin] Inner transfer completed for ${currency} on attempt ${attempt}/${maxAttempts}`,
        )
        return
      } catch (error) {
        // 300000 "repeated requests" means this clientOid was already accepted — idempotent success.
        if (isKuCoinRepeatedRequestError(error)) {
          console.info(
            `[kucoin] Inner transfer already completed (repeated clientOid) for ${currency} on attempt ${attempt}/${maxAttempts}`,
          )
          return
        }

        if (isKuCoinNoBalanceError(error) && attempt < maxAttempts) {
          console.info(
            `[kucoin] Inner transfer balance not ready yet for ${currency}; retrying in ${this.config.innerTransferRetryDelayMs}ms (attempt ${attempt}/${maxAttempts})`,
          )
          await sleep(this.config.innerTransferRetryDelayMs, signal)
          continue
        }

        if (allowFailure && error instanceof KuCoinApiError) {
          console.info(
            `[kucoin] Inner transfer failed (non-fatal): code=${error.code} msg=${error.kucoinMessage}`,
          )
          return
        }

        throw error
      }
    }

    throw new Error(`KuCoin inner transfer exhausted retries for ${currency}`)
  }

  // ─── Internal: withdrawal ───────────────────────────────────────────

  private async getWithdrawalQuotas(
    currency: string,
    chain: string,
    signal?: AbortSignal,
  ): Promise<KuCoinWithdrawalQuotas> {
    return this.client.request<KuCoinWithdrawalQuotas>(
      "/api/v1/withdrawals/quotas",
      { method: "GET", params: { currency, chain }, signal },
    )
  }

  private validateWithdrawal(
    quotas: KuCoinWithdrawalQuotas,
    amount: string,
    coin: string,
  ): void {
    if (!quotas.isWithdrawEnabled) {
      throw new Error(
        `KuCoin withdrawal is disabled for ${coin} on chain ${quotas.chain}`,
      )
    }

    const withdrawMin = Number(quotas.withdrawMinSize)
    const amountNum = Number(amount)

    if (Number.isFinite(withdrawMin) && Number.isFinite(amountNum) && amountNum < withdrawMin) {
      throw new Error(
        `KuCoin withdrawal amount ${amount} is below minimum ${quotas.withdrawMinSize} for ${coin}`,
      )
    }
  }

  private async withdraw(
    params: {
      currency: string
      toAddress: string
      amount: string
      withdrawType: "ADDRESS"
      chain: string
      memo?: string
      remark?: string
    },
    signal?: AbortSignal,
  ): Promise<KuCoinWithdrawResult> {
    console.info(
      `[kucoin] Withdrawing: ${params.currency} ${params.amount} → ${params.toAddress} (chain=${params.chain})`,
    )

    return this.client.request<KuCoinWithdrawResult>(
      "/api/v3/withdrawals",
      {
        method: "POST",
        body: params,
        signal,
      },
    )
  }
}
