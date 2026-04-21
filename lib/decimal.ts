/**
 * lib/decimal.ts — Decimal arithmetic + financial helpers.
 *
 * Pure-TypeScript replacement for the previous Rust/WASM `financial-core`
 * module. Uses Prisma's bundled Decimal implementation (decimal.js under the
 * hood) which provides 20 significant-digit precision with half-away-from-zero
 * rounding — matching the behaviour of the old `rust_decimal`-based WASM.
 *
 * All boundary conversions accept Decimal | string | number and return either
 * Decimal instances (for arithmetic) or primitive values (for comparisons,
 * classification, and string formatting).
 */

import { Decimal } from "@prisma/client/runtime/client"
import { ExchangeRequestStatus } from "../db/index"

export type DecimalValue = Decimal | string | number

// ─── Conversion helpers ──────────────────────────────────────────────

export function toDecimal(value: DecimalValue): Decimal {
  if (value instanceof Decimal) return value
  return new Decimal(value)
}

function toStr(value: DecimalValue): string {
  if (value instanceof Decimal) return value.toFixed()
  return String(value)
}

// ─── Comparisons ─────────────────────────────────────────────────────

export function decimalEq(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).equals(toDecimal(b))
}

export function decimalGt(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).greaterThan(toDecimal(b))
}

export function decimalGte(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).greaterThanOrEqualTo(toDecimal(b))
}

export function decimalLt(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).lessThan(toDecimal(b))
}

export function decimalLte(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).lessThanOrEqualTo(toDecimal(b))
}

// ─── Arithmetic ──────────────────────────────────────────────────────

export function decimalAdd(a: DecimalValue, b: DecimalValue): Decimal {
  return toDecimal(a).plus(toDecimal(b))
}

export function decimalSub(a: DecimalValue, b: DecimalValue): Decimal {
  return toDecimal(a).minus(toDecimal(b))
}

export function decimalMul(a: DecimalValue, b: DecimalValue): Decimal {
  return toDecimal(a).times(toDecimal(b))
}

export function decimalDiv(a: DecimalValue, b: DecimalValue): Decimal {
  const divisor = toDecimal(b)
  if (divisor.isZero()) {
    throw new Error("Division by zero")
  }
  return toDecimal(a).dividedBy(divisor)
}

export function decimalMin(a: DecimalValue, b: DecimalValue): Decimal {
  const da = toDecimal(a)
  const db = toDecimal(b)
  return da.lessThanOrEqualTo(db) ? da : db
}

export function decimalMax(a: DecimalValue, b: DecimalValue): Decimal {
  const da = toDecimal(a)
  const db = toDecimal(b)
  return da.greaterThanOrEqualTo(db) ? da : db
}

/**
 * Truncate a decimal toward zero to at most `dp` fractional digits.
 * Used when forwarding amounts to exchange APIs that reject excessive
 * precision (Binance/KuCoin typically cap at 8).
 */
export function truncateDp(value: DecimalValue, dp: number): Decimal {
  // Decimal.prototype.toDecimalPlaces(dp, rounding) — rounding=1 is ROUND_DOWN
  return toDecimal(value).toDecimalPlaces(dp, 1 /* ROUND_DOWN */)
}

// ─── Amount classification (deposit vs expected) ─────────────────────

export interface AmountClassificationResult {
  kind: "exact" | "overpaid" | "underpaid"
  acceptedAmount: Decimal
  refundAmount: Decimal
  nextStatus: ExchangeRequestStatus
}

/**
 * Classify a received deposit amount against the expected amount.
 *
 *   received > expected  → overpaid: accept expected, refund the difference
 *   received < expected  → underpaid: accept 0, refund everything received
 *   received === expected → exact: accept expected, refund 0
 */
export function classifyAmount(
  expectedAmount: DecimalValue,
  receivedAmount: DecimalValue,
): AmountClassificationResult {
  const expected = toDecimal(expectedAmount)
  const received = toDecimal(receivedAmount)
  const zero = new Decimal(0)

  if (received.greaterThan(expected)) {
    return {
      kind: "overpaid",
      acceptedAmount: expected,
      refundAmount: received.minus(expected),
      nextStatus: ExchangeRequestStatus.OVERPAID,
    }
  }

  if (received.lessThan(expected)) {
    return {
      kind: "underpaid",
      acceptedAmount: zero,
      refundAmount: received,
      nextStatus: ExchangeRequestStatus.UNDERPAID,
    }
  }

  return {
    kind: "exact",
    acceptedAmount: expected,
    refundAmount: zero,
    nextStatus: ExchangeRequestStatus.DEPOSIT_DETECTED,
  }
}

// ─── Payout helpers ──────────────────────────────────────────────────

/**
 * Compute the net payout amount = toAmount − feeAmount.
 * Throws if fee exceeds toAmount to prevent negative payouts.
 */
export function getRequestedPayoutAmount(
  toAmount: DecimalValue,
  feeAmount: DecimalValue,
): Decimal {
  const to = toDecimal(toAmount)
  const fee = toDecimal(feeAmount)
  const net = to.minus(fee)

  if (net.lessThan(0)) {
    throw new Error(
      `feeAmount greater than toAmount: fee=${fee.toFixed()} toAmount=${to.toFixed()}`,
    )
  }

  return net
}

// ─── Exchange request status FSM ─────────────────────────────────────

const STATUS_RANK: Record<ExchangeRequestStatus, number> = {
  [ExchangeRequestStatus.CREATED]: 0,
  [ExchangeRequestStatus.WAITING_DEPOSIT]: 1,
  [ExchangeRequestStatus.DEPOSIT_DETECTED]: 2,
  [ExchangeRequestStatus.UNDERPAID]: 3,
  [ExchangeRequestStatus.OVERPAID]: 4,
  [ExchangeRequestStatus.REFUND_PENDING]: 5,
  [ExchangeRequestStatus.PARTIALLY_REFUNDED]: 6,
  [ExchangeRequestStatus.REFUNDED]: 7,
  [ExchangeRequestStatus.PROCESSING]: 8,
  [ExchangeRequestStatus.COMPLETED]: 9,
  [ExchangeRequestStatus.CANCELLED]: 10,
  [ExchangeRequestStatus.FAILED]: 11,
}

const FINAL_STATUSES = new Set<ExchangeRequestStatus>([
  ExchangeRequestStatus.COMPLETED,
  ExchangeRequestStatus.REFUNDED,
  ExchangeRequestStatus.CANCELLED,
  ExchangeRequestStatus.FAILED,
])

/**
 * Monotonically advance the ExchangeRequest status. Never moves backward;
 * never transitions out of a final (terminal) status.
 */
export function advanceExchangeRequestStatus(
  currentStatus: ExchangeRequestStatus,
  nextStatus: ExchangeRequestStatus,
): ExchangeRequestStatus {
  if (FINAL_STATUSES.has(currentStatus)) {
    return currentStatus
  }

  const currentRank = STATUS_RANK[currentStatus]
  const nextRank = STATUS_RANK[nextStatus]

  if (currentRank === undefined) {
    throw new Error(`Unknown current status: ${currentStatus}`)
  }
  if (nextRank === undefined) {
    throw new Error(`Unknown next status: ${nextStatus}`)
  }

  return nextRank < currentRank ? currentStatus : nextStatus
}

// ─── Gas requirement ─────────────────────────────────────────────────

export interface GasRequirementResult {
  gasLimit: Decimal
  gasPrice: Decimal
  estimatedFeeWei: Decimal
  estimatedFeeNative: Decimal
  bufferedFee: Decimal
  requiredNative: Decimal
  isNativeTransfer: boolean
}

const WEI_BASE = new Decimal("1000000000000000000")

/**
 * Build a gas requirement structure from a gas-limit/gas-price estimate.
 *
 *   estimatedFeeWei    = gasLimit × gasPrice
 *   estimatedFeeNative = estimatedFeeWei / 1e18
 *   bufferedFee        = max(estimatedFeeNative × gasFeeMultiplier, gasMinReserve)
 *   requiredNative     = isNative ? amount + bufferedFee : bufferedFee
 */
export function buildGasRequirementFromEstimate(
  estimate: { gasLimit: DecimalValue; gasPrice: DecimalValue },
  amount: DecimalValue,
  isNativeTransfer: boolean,
  gasFeeMultiplier: DecimalValue,
  gasMinReserve: DecimalValue,
): GasRequirementResult {
  const gl = toDecimal(estimate.gasLimit)
  const gp = toDecimal(estimate.gasPrice)
  const amt = toDecimal(amount)
  const multiplier = toDecimal(gasFeeMultiplier)
  const minReserve = toDecimal(gasMinReserve)

  const estimatedFeeWei = gl.times(gp)
  const estimatedFeeNative = estimatedFeeWei.dividedBy(WEI_BASE)
  const mulFee = estimatedFeeNative.times(multiplier)
  const bufferedFee = mulFee.greaterThanOrEqualTo(minReserve) ? mulFee : minReserve

  const requiredNative = isNativeTransfer ? amt.plus(bufferedFee) : bufferedFee

  return {
    gasLimit: gl,
    gasPrice: gp,
    estimatedFeeWei,
    estimatedFeeNative,
    bufferedFee,
    requiredNative,
    isNativeTransfer,
  }
}

// ─── Binance settlement ──────────────────────────────────────────────

export interface BinanceTradeFill {
  qty: DecimalValue
  quoteQty: DecimalValue
  commission: DecimalValue
  commissionAsset: string
}

/**
 * Calculate the net target-asset amount from Binance trade fills.
 *
 *   gross      = Σ(BUY ? qty : quoteQty)
 *   commission = Σ(commission WHERE commissionAsset === targetAsset)
 *   net        = gross − commission      (must be > 0)
 */
export function calculateNetTargetFromTrades(
  trades: BinanceTradeFill[],
  orderSide: "BUY" | "SELL" | string,
  sourceAsset: string,
  targetAsset: string,
): string {
  const source = sourceAsset.trim().toUpperCase()
  const target = targetAsset.trim().toUpperCase()

  if (!source || !target) {
    throw new Error("Binance trade settlement requires sourceAsset and targetAsset")
  }

  if (orderSide !== "BUY" && orderSide !== "SELL") {
    throw new Error(
      `Binance trade settlement requires BUY or SELL order side, received ${orderSide}`,
    )
  }

  if (trades.length === 0) {
    throw new Error(
      `Binance trade settlement returned no fills for ${source}/${target} ${orderSide} order`,
    )
  }

  let grossTarget = new Decimal(0)
  let commissionTarget = new Decimal(0)

  for (const trade of trades) {
    const qty = toDecimal(trade.qty)
    const quoteQty = toDecimal(trade.quoteQty)
    const commission = toDecimal(trade.commission)
    const commissionAsset = trade.commissionAsset.trim().toUpperCase()

    grossTarget = grossTarget.plus(orderSide === "BUY" ? qty : quoteQty)

    if (commissionAsset === target) {
      commissionTarget = commissionTarget.plus(commission)
    }
  }

  const netTarget = grossTarget.minus(commissionTarget)
  if (netTarget.lessThanOrEqualTo(0)) {
    throw new Error(
      `Calculated Binance net target amount for ${target} is invalid: ${netTarget.toFixed()}`,
    )
  }

  return netTarget.toFixed()
}
