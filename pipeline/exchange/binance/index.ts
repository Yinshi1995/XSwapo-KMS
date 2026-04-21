import crypto from "crypto"

import { toDecimal } from "../../../lib/decimal"
import {
  calculateNetTargetFromTrades as wasmCalculateNetTarget,
} from "../../../lib/decimal"
import type {
  BinanceCapitalConfigCoin,
  BinanceDepositAddressResponse,
  BinanceDepositHistoryItem,
  BinanceDepositHistoryParams,
  BinanceExchangeMarketOrderPlan,
  BinanceMarketOrderParams,
  BinanceMyTradeItem,
  BinanceOrderLookupParams,
  BinanceOrderResponse,
  BinanceSignedRequestOptions,
  BinanceTickerResponse,
  BinanceWithdrawHistoryItem,
  BinanceWithdrawHistoryParams,
  BinanceWithdrawParams,
  ExecuteBinanceSwapAndWithdrawParams,
  ExecuteBinanceSwapAndWithdrawResult,
  FindBinanceWithdrawalByOrderIdParams,
  WaitForBinanceDepositParams,
  WaitForBinanceOrderParams,
} from "./types"

export type * from "./types"

const BINANCE_API_BASE = Bun.env.BINANCE_BASE_URL || "https://api.binance.com"
const BINANCE_API_KEY = Bun.env.BINANCE_API_KEY
const BINANCE_API_SECRET = Bun.env.BINANCE_API_SECRET?.trim()
const BINANCE_RECV_WINDOW = Bun.env.BINANCE_RECV_WINDOW?.trim()

const BINANCE_DEPOSIT_POLL_INTERVAL_MS = Number(Bun.env.BINANCE_DEPOSIT_POLL_INTERVAL_MS || "5000")
const BINANCE_DEPOSIT_POLL_TIMEOUT_MS = Number(Bun.env.BINANCE_DEPOSIT_POLL_TIMEOUT_MS || "900000")
const BINANCE_ORDER_POLL_INTERVAL_MS = Number(Bun.env.BINANCE_ORDER_POLL_INTERVAL_MS || "3000")
const BINANCE_ORDER_POLL_TIMEOUT_MS = Number(Bun.env.BINANCE_ORDER_POLL_TIMEOUT_MS || "120000")

function serializeBinanceParams(
  params: Array<[string, string | number | boolean | undefined | null]>
): Record<string, string> {
  return Object.fromEntries(
    params
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  )
}

function getBinanceSignedCredentials(): { apiKey: string; apiSecret: string } {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be configured for signed Binance endpoints")
  }

  return {
    apiKey: BINANCE_API_KEY,
    apiSecret: BINANCE_API_SECRET,
  }
}

function normalizeUppercase(value: string | undefined): string | undefined {
  return value?.trim().toUpperCase()
}

function normalizeComparableValue(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase()
}

function toFinitePositiveInterval(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError")
}

function formatBinanceDecimal(value: ReturnType<typeof toDecimal>): string {
  return value.toFixed()
}

export function parseBinanceDateTime(value?: string): Date | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(trimmed)
  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute, second] = match
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  )

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw abortError()
  }

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

function deriveTradeAssetsFromOrder(
  order: BinanceOrderResponse,
  withdrawCoin: string
): { sourceAsset: string; targetAsset: string } {
  const symbol = normalizeUppercase(order.symbol)
  const targetAsset = normalizeUppercase(withdrawCoin)

  if (!symbol || !targetAsset) {
    throw new Error("Binance trade settlement requires order symbol and withdraw coin")
  }

  if (order.side === "BUY" && symbol.startsWith(targetAsset)) {
    const sourceAsset = symbol.slice(targetAsset.length)
    if (sourceAsset) {
      return { sourceAsset, targetAsset }
    }
  }

  if (order.side === "SELL" && symbol.endsWith(targetAsset)) {
    const sourceAsset = symbol.slice(0, symbol.length - targetAsset.length)
    if (sourceAsset) {
      return { sourceAsset, targetAsset }
    }
  }

  throw new Error(
    `Unable to derive Binance trade settlement assets for ${order.side} order ${symbol} and withdraw coin ${targetAsset}`
  )
}

export function calculateNetTargetFromTrades(
  trades: BinanceMyTradeItem[],
  orderSide: string,
  sourceAsset: string,
  targetAsset: string
): string {
  const normalizedSource = normalizeUppercase(sourceAsset)
  const normalizedTarget = normalizeUppercase(targetAsset)

  if (!normalizedSource || !normalizedTarget) {
    throw new Error("Binance trade settlement requires sourceAsset and targetAsset")
  }

  if (orderSide !== "BUY" && orderSide !== "SELL") {
    throw new Error(
      `Binance trade settlement requires BUY or SELL order side, received ${orderSide}`
    )
  }

  if (!trades.length) {
    throw new Error(
      `Binance trade settlement returned no fills for ${normalizedSource}/${normalizedTarget} ${orderSide} order`
    )
  }

  let result: string
  try {
    result = wasmCalculateNetTarget(
      trades.map((t) => ({
        qty: t.qty,
        quoteQty: t.quoteQty,
        commission: t.commission,
        commissionAsset: t.commissionAsset,
      })),
      orderSide,
      sourceAsset,
      targetAsset,
    )
  } catch {
    throw new Error(
      `Calculated Binance net target amount for ${normalizedTarget} is invalid`
    )
  }

  return result
}

function findMatchingDeposit(
  items: BinanceDepositHistoryItem[],
  params: WaitForBinanceDepositParams
): BinanceDepositHistoryItem | null {
  const txId = normalizeComparableValue(params.txId)
  const network = normalizeUppercase(params.network)
  const address = normalizeComparableValue(params.address)
  const amount = params.amount?.trim()

  for (const item of items) {
    if (txId && normalizeComparableValue(item.txId) !== txId) {
      continue
    }

    if (network && normalizeUppercase(item.network) !== network) {
      continue
    }

    if (address && normalizeComparableValue(item.address) !== address) {
      continue
    }

    if (amount && item.amount !== amount) {
      continue
    }

    return item
  }

  return null
}

function buildSignedQuery(
  params: Array<[string, string | number | boolean | undefined | null]> = [],
  apiSecret: string
): URLSearchParams {
  const searchParams = new URLSearchParams()

  for (const [key, value] of params) {
    if (value === undefined || value === null) continue
    searchParams.append(key, String(value))
  }

  searchParams.append("timestamp", Date.now().toString())
  if (BINANCE_RECV_WINDOW) {
    searchParams.append("recvWindow", BINANCE_RECV_WINDOW)
  }

  const canonical = Array.from(searchParams.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("&")

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(canonical)
    .digest("hex")

  searchParams.append("signature", signature)
  return searchParams
}

async function callBinanceSigned<T>(
  path: string,
  options: BinanceSignedRequestOptions = {}
): Promise<T> {
  const { apiKey, apiSecret } = getBinanceSignedCredentials()

  const { method = "GET", params = [], signal } = options
  const url = new URL(path, BINANCE_API_BASE)
  const requestId = crypto.randomUUID()
  const requestParams = serializeBinanceParams(params)

  console.info(
    `[binance:${requestId}] Signed API request: ${method} ${path} ${JSON.stringify(requestParams)}`
  )

  url.search = buildSignedQuery(params, apiSecret).toString()

  const res = await fetch(url.toString(), {
    method,
    signal,
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "")
    console.error(
      `[binance:${requestId}] Signed API error response: ${res.status} ${res.statusText} ${bodyText || "<empty body>"}; request=${JSON.stringify({ method, path, params: requestParams })}`
    )
    throw new Error(
      `Binance signed API error ${res.status} ${res.statusText}: ${bodyText || "<empty body>"}`
    )
  }

  console.info(`[binance:${requestId}] Signed API response: ${res.status} ${res.statusText}`)

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

async function fetchTicker(symbol: string, signal?: AbortSignal): Promise<number> {
  const url = `${BINANCE_API_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
  const res = await fetch(url, { signal })

  if (!res.ok) {
    throw new Error(`Binance ticker error for ${symbol}: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as BinanceTickerResponse
  const price = Number(data.price)
  if (!Number.isFinite(price)) {
    throw new Error(`Invalid price from Binance for ${symbol}: ${data.price}`)
  }
  return price
}

async function doesBinanceSymbolExist(symbol: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetchTicker(symbol, signal)
    return true
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    return false
  }
}

/**
 * Get spot rate base/quote from Binance public API.
 * Tries BASEQUOTE first; if not found, tries QUOTEBASE and inverts the rate.
 */
export async function getBinanceSpotRate(
  baseAsset: string,
  quoteAsset: string,
  signal?: AbortSignal
): Promise<number> {
  const directSymbol = `${baseAsset}${quoteAsset}`.toUpperCase()
  const reversedSymbol = `${quoteAsset}${baseAsset}`.toUpperCase()

  try {
    return await fetchTicker(directSymbol, signal)
  } catch (e) {
    // Try reversed pair and invert
    const reversedPrice = await fetchTicker(reversedSymbol, signal)
    if (!Number.isFinite(reversedPrice) || reversedPrice === 0) {
      throw new Error(`Invalid reversed price for ${reversedSymbol}`)
    }
    return 1 / reversedPrice
  }
}

export async function buildBinanceMarketOrderForExchange(
  sourceAsset: string,
  targetAsset: string,
  sourceAmount: string,
  signal?: AbortSignal
): Promise<BinanceExchangeMarketOrderPlan> {
  const normalizedSource = sourceAsset.trim().toUpperCase()
  const normalizedTarget = targetAsset.trim().toUpperCase()

  if (!normalizedSource || !normalizedTarget) {
    throw new Error("Binance market order plan requires sourceAsset and targetAsset")
  }

  if (normalizedSource === normalizedTarget) {
    throw new Error("Binance market order plan requires different sourceAsset and targetAsset")
  }

  const buySymbol = `${normalizedTarget}${normalizedSource}`
  if (await doesBinanceSymbolExist(buySymbol, signal)) {
    return {
      symbol: buySymbol,
      side: "BUY",
      quoteOrderQty: sourceAmount,
      sourceAsset: normalizedSource,
      targetAsset: normalizedTarget,
    }
  }

  const sellSymbol = `${normalizedSource}${normalizedTarget}`
  if (await doesBinanceSymbolExist(sellSymbol, signal)) {
    return {
      symbol: sellSymbol,
      side: "SELL",
      quantity: sourceAmount,
      sourceAsset: normalizedSource,
      targetAsset: normalizedTarget,
    }
  }

  throw new Error(
    `Unable to build Binance market order plan for ${normalizedSource} -> ${normalizedTarget}`
  )
}

/**
 * Sync source for Binance network metadata.
 *
 * Recommended flow for this project:
 * 1. Background job calls this method on a schedule.
 * 2. Result is mapped into local Prisma models `Network` and `CoinNetworkMapping`.
 * 3. Exchange processing validates deposit/withdraw availability from the local DB,
 *    not from Binance in real time.
 */
export async function getBinanceCapitalConfigs(
  signal?: AbortSignal
): Promise<BinanceCapitalConfigCoin[]> {
  return callBinanceSigned<BinanceCapitalConfigCoin[]>("/sapi/v1/capital/config/getall", {
    method: "GET",
    signal,
  })
}

/**
 * Step 10-11: obtain Binance deposit address for a concrete asset + network,
 * for example USDT on BSC.
 */
export async function getBinanceDepositAddress(
  coin: string,
  network: string,
  signal?: AbortSignal
): Promise<BinanceDepositAddressResponse> {
  return callBinanceSigned<BinanceDepositAddressResponse>("/sapi/v1/capital/deposit/address", {
    method: "GET",
    signal,
    params: [
      ["coin", coin.toUpperCase()],
      ["network", network.toUpperCase()],
    ],
  })
}

/**
 * Step 13: poll Binance deposit history until the transfer reaches `status = 1`.
 */
export async function getBinanceDepositHistory(
  params: BinanceDepositHistoryParams,
  signal?: AbortSignal
): Promise<BinanceDepositHistoryItem[]> {
  return callBinanceSigned<BinanceDepositHistoryItem[]>("/sapi/v1/capital/deposit/hisrec", {
    method: "GET",
    signal,
    params: [
      ["coin", params.coin.toUpperCase()],
      ["status", params.status],
      ["startTime", params.startTime],
      ["endTime", params.endTime],
      ["offset", params.offset],
      ["limit", params.limit],
      ["txId", params.txId],
    ],
  })
}

export async function waitForBinanceDepositSuccess(
  params: WaitForBinanceDepositParams,
  signal?: AbortSignal
): Promise<BinanceDepositHistoryItem> {
  const pollIntervalMs = toFinitePositiveInterval(
    params.pollIntervalMs ?? BINANCE_DEPOSIT_POLL_INTERVAL_MS,
    BINANCE_DEPOSIT_POLL_INTERVAL_MS
  )
  const timeoutMs = toFinitePositiveInterval(
    params.timeoutMs ?? BINANCE_DEPOSIT_POLL_TIMEOUT_MS,
    BINANCE_DEPOSIT_POLL_TIMEOUT_MS
  )
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    if (signal?.aborted) {
      throw abortError()
    }

    const items = await getBinanceDepositHistory(params, signal)
    const matchingDeposit = findMatchingDeposit(items, params)

    if (matchingDeposit) {
      if (matchingDeposit.status === 1) {
        return matchingDeposit
      }

      if (matchingDeposit.status === 2 || matchingDeposit.status === 7) {
        throw new Error(
          `Binance deposit ${matchingDeposit.txId || matchingDeposit.id} reached terminal status ${matchingDeposit.status}`
        )
      }
    }

    await sleep(pollIntervalMs, signal)
  }

  throw new Error(
    `Timed out waiting for Binance deposit success for coin ${params.coin.toUpperCase()}`
  )
}

/**
 * Step 14: place a MARKET order after the deposit is credited.
 * Binance requires one of `quoteOrderQty` or `quantity`.
 */
export async function createBinanceMarketOrder(
  params: BinanceMarketOrderParams,
  signal?: AbortSignal
): Promise<BinanceOrderResponse> {
  if (!params.quoteOrderQty && !params.quantity) {
    throw new Error("Binance market order requires quoteOrderQty or quantity")
  }

  return callBinanceSigned<BinanceOrderResponse>("/api/v3/order", {
    method: "POST",
    signal,
    params: [
      ["symbol", params.symbol.toUpperCase()],
      ["side", params.side],
      ["type", "MARKET"],
      ["quoteOrderQty", params.quoteOrderQty],
      ["quantity", params.quantity],
      ["newClientOrderId", params.newClientOrderId],
      ["newOrderRespType", params.newOrderRespType ?? "FULL"],
    ],
  })
}

export async function getBinanceOrder(
  params: BinanceOrderLookupParams,
  signal?: AbortSignal
): Promise<BinanceOrderResponse> {
  if (!params.orderId && !params.origClientOrderId) {
    throw new Error("Binance order lookup requires orderId or origClientOrderId")
  }

  return callBinanceSigned<BinanceOrderResponse>("/api/v3/order", {
    method: "GET",
    signal,
    params: [
      ["symbol", params.symbol.toUpperCase()],
      ["orderId", params.orderId],
      ["origClientOrderId", params.origClientOrderId],
    ],
  })
}

export async function getBinanceMyTrades(
  symbol: string,
  orderId: number,
  signal?: AbortSignal
): Promise<BinanceMyTradeItem[]> {
  return callBinanceSigned<BinanceMyTradeItem[]>("/api/v3/myTrades", {
    method: "GET",
    signal,
    params: [
      ["symbol", symbol.toUpperCase()],
      ["orderId", orderId],
    ],
  })
}

export async function waitForBinanceOrderFill(
  params: WaitForBinanceOrderParams,
  signal?: AbortSignal
): Promise<BinanceOrderResponse> {
  const pollIntervalMs = toFinitePositiveInterval(
    params.pollIntervalMs ?? BINANCE_ORDER_POLL_INTERVAL_MS,
    BINANCE_ORDER_POLL_INTERVAL_MS
  )
  const timeoutMs = toFinitePositiveInterval(
    params.timeoutMs ?? BINANCE_ORDER_POLL_TIMEOUT_MS,
    BINANCE_ORDER_POLL_TIMEOUT_MS
  )
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    if (signal?.aborted) {
      throw abortError()
    }

    const order = await getBinanceOrder(params, signal)
    if (order.status === "FILLED") {
      return order
    }

    if (["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(order.status)) {
      throw new Error(`Binance order ${order.orderId} reached terminal status ${order.status}`)
    }

    await sleep(pollIntervalMs, signal)
  }

  throw new Error(`Timed out waiting for Binance order fill for ${params.symbol.toUpperCase()}`)
}

/**
 * Step 15: withdraw converted funds from Binance to the client wallet.
 */
export async function applyBinanceWithdraw(
  params: BinanceWithdrawParams,
  signal?: AbortSignal
): Promise<{ id: string; msg?: string; success?: boolean }> {
  return callBinanceSigned<{ id: string; msg?: string; success?: boolean }>(
    "/sapi/v1/capital/withdraw/apply",
    {
      method: "POST",
      signal,
      params: [
        ["coin", params.coin.toUpperCase()],
        ["network", params.network.toUpperCase()],
        ["address", params.address],
        ["amount", params.amount],
        ["withdrawOrderId", params.withdrawOrderId],
        ["addressTag", params.addressTag],
        ["walletType", params.walletType],
        ["transactionFeeFlag", params.transactionFeeFlag],
        ["name", params.name],
      ],
    }
  )
}

/**
 * Step 16: check withdrawal history until Binance reports the final status.
 */
export async function getBinanceWithdrawHistory(
  params: BinanceWithdrawHistoryParams = {},
  signal?: AbortSignal
): Promise<BinanceWithdrawHistoryItem[]> {
  return callBinanceSigned<BinanceWithdrawHistoryItem[]>("/sapi/v1/capital/withdraw/history", {
    method: "GET",
    signal,
    params: [
      ["coin", params.coin?.toUpperCase()],
      ["status", params.status],
      ["offset", params.offset],
      ["limit", params.limit],
      ["startTime", params.startTime],
      ["endTime", params.endTime],
      ["withdrawOrderId", params.withdrawOrderId],
    ],
  })
}

export async function findBinanceWithdrawalByOrderId(
  params: FindBinanceWithdrawalByOrderIdParams,
  signal?: AbortSignal
): Promise<BinanceWithdrawHistoryItem | null> {
  const withdrawOrderId = params.withdrawOrderId.trim()
  const coin = params.coin.trim().toUpperCase()
  const network = normalizeUppercase(params.network)
  const address = normalizeComparableValue(params.address)
  const items = await getBinanceWithdrawHistory(
    {
      coin,
      withdrawOrderId,
    },
    signal
  )

  // withdrawOrderId is the primary cross-system correlation key because we submit it on apply
  // and Binance echoes the exact same value back in withdraw history.
  return items.find((item) => {
    if (item.withdrawOrderId !== withdrawOrderId) return false
    if (normalizeUppercase(item.coin) !== coin) return false
    if (network && normalizeUppercase(item.network) !== network) return false
    if (address && normalizeComparableValue(item.address) !== address) return false
    return true
  }) ?? null
}

export async function executeBinanceSwapAndWithdraw(
  params: ExecuteBinanceSwapAndWithdrawParams
): Promise<ExecuteBinanceSwapAndWithdrawResult> {
  const { signal } = params

  const deposit = await waitForBinanceDepositSuccess(params.deposit, signal)

  const initialOrder = params.order
    ? await createBinanceMarketOrder(
        {
          ...params.order,
          newOrderRespType: params.order.newOrderRespType ?? "FULL",
        },
        signal
      )
    : undefined

  const order = !initialOrder
    ? undefined
    : initialOrder.status === "FILLED"
      ? initialOrder
      : await waitForBinanceOrderFill(
          {
            symbol: params.order!.symbol,
            orderId: initialOrder.orderId,
          },
          signal
        )

  const settlementAssets = order
    ? deriveTradeAssetsFromOrder(order, params.withdraw.coin)
    : undefined
  const withdrawAmount = params.withdraw.amount
    ?? (!order || !settlementAssets
      ? deposit.amount
      : calculateNetTargetFromTrades(
          await getBinanceMyTrades(order.symbol, order.orderId, signal),
          order.side,
          settlementAssets.sourceAsset,
          settlementAssets.targetAsset
        ))
  const withdrawal = await applyBinanceWithdraw(
    {
      coin: params.withdraw.coin,
      network: params.withdraw.network,
      address: params.withdraw.clientWithdrawAddress,
      amount: withdrawAmount,
      withdrawOrderId: params.withdraw.withdrawOrderId,
      addressTag: params.withdraw.addressTag,
      walletType: params.withdraw.walletType,
      transactionFeeFlag: params.withdraw.transactionFeeFlag,
      name: params.withdraw.name,
    },
    signal
  )

  return {
    deposit,
    order,
    withdrawal,
    withdrawAmount,
  }
}
