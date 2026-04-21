import { Decimal } from "@prisma/client/runtime/client"

import {
  ExchangeRequestStatus,
  TransactionType,
} from "../db/index"
import {
  decimalLt,
  toDecimal,
} from "../lib/decimal"

// ─── Status sets ─────────────────────────────────────────────────────

export const FINAL_EXCHANGE_REQUEST_STATUSES = new Set<ExchangeRequestStatus>([
  ExchangeRequestStatus.COMPLETED,
  ExchangeRequestStatus.REFUNDED,
  ExchangeRequestStatus.CANCELLED,
  ExchangeRequestStatus.FAILED,
])

export const ACCEPTABLE_DEPOSIT_STATUSES = new Set<ExchangeRequestStatus>([
  ExchangeRequestStatus.CREATED,
  ExchangeRequestStatus.WAITING_DEPOSIT,
])

export const KNOWN_INTERNAL_TRANSACTION_TYPES = new Set<TransactionType>([
  TransactionType.CLIENT_REFUND,
  TransactionType.TRANSFER_TO_BINANCE,
  TransactionType.CLIENT_PAYOUT,
  TransactionType.GAS_TOPUP,
])

export const STATUS_RANK: Record<ExchangeRequestStatus, number> = {
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

// ─── Decimal constants ───────────────────────────────────────────────

export const ZERO_DECIMAL = toDecimal("0")
export const WEI_BASE = toDecimal("1000000000000000000")
export const GWEI_BASE = toDecimal("1000000000")

// ─── Env-derived gas configuration ──────────────────────────────────

function readDecimalEnv(name: string): Decimal | null {
  const value = process.env[name]?.trim()

  if (!value) {
    return null
  }

  try {
    return toDecimal(value)
  } catch {
    throw new Error(`Environment variable ${name} must be a valid decimal value`)
  }
}

function getGasFeeMultiplier(): Decimal {
  const configured = readDecimalEnv("GAS_FEE_MULTIPLIER")

  if (!configured) {
    return toDecimal("1.25")
  }

  if (decimalLt(configured, 1)) {
    throw new Error("Environment variable GAS_FEE_MULTIPLIER must be greater than or equal to 1")
  }

  return configured
}

function getGasMinReserve(): Decimal {
  const configured = readDecimalEnv("GAS_MIN_RESERVE")

  if (!configured) {
    return toDecimal("0.0003")
  }

  if (decimalLt(configured, ZERO_DECIMAL)) {
    throw new Error("Environment variable GAS_MIN_RESERVE must be greater than or equal to 0")
  }

  return configured
}

function getGasTopUpTargetBalanceOverride(): Decimal | null {
  const configured = readDecimalEnv("GAS_TOPUP_TARGET_BALANCE")

  if (!configured) {
    return null
  }

  if (decimalLt(configured, ZERO_DECIMAL)) {
    throw new Error(
      "Environment variable GAS_TOPUP_TARGET_BALANCE must be greater than or equal to 0"
    )
  }

  return configured
}

export const GAS_FEE_MULTIPLIER = getGasFeeMultiplier()
export const GAS_MIN_RESERVE = getGasMinReserve()
export const GAS_TOPUP_TARGET_BALANCE_OVERRIDE = getGasTopUpTargetBalanceOverride()
