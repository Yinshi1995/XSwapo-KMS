import type { Prisma } from "../db/index"
import { toDecimal } from "../lib/decimal"

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type UnknownRecord = Record<string, unknown>

export interface NormalizedTatumWebhookPayload {
  chain: string | null
  type: string | null
  address: string | null
  amount: string | null
  asset: string | null
  currency: string | null
  contractAddress: string | null
  subscriptionType: string | null
  txId: string | null
  counterAddress: string | null
  blockNumber: number | null
  rawPayload: Prisma.InputJsonValue
}

export interface WebhookValidationResult {
  ok: boolean
  errors: string[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }

  return null
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])
    )
  }

  return String(value)
}

export function normalizeWebhookPayload(rawPayload: unknown): NormalizedTatumWebhookPayload {
  const payload = isRecord(rawPayload) ? rawPayload : {}

  return {
    chain: normalizeString(payload.chain),
    type: normalizeString(payload.type),
    address: normalizeString(payload.address),
    amount: normalizeString(payload.amount),
    asset: normalizeString(payload.asset),
    currency: normalizeString(payload.currency),
    contractAddress: normalizeString(payload.contractAddress),
    subscriptionType: normalizeString(payload.subscriptionType),
    txId: normalizeString(payload.txId),
    counterAddress: normalizeString(payload.counterAddress),
    blockNumber: normalizeNumber(payload.blockNumber),
    rawPayload: toJsonValue(rawPayload) as Prisma.InputJsonValue,
  }
}

export function validateWebhookPayload(
  payload: NormalizedTatumWebhookPayload
): WebhookValidationResult {
  const errors: string[] = []

  if (!payload.address) {
    errors.push("address is required")
  }

  if (!payload.amount) {
    errors.push("amount is required")
  } else {
    try {
      toDecimal(payload.amount)
    } catch {
      errors.push("amount must be a valid decimal string")
    }
  }

  if (!payload.txId) {
    errors.push("txId is required")
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}