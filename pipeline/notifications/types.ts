// ─── Event severity levels ───────────────────────────────────────────

export type EventSeverity = "info" | "success" | "warning" | "error" | "critical"

// ─── Event categories ────────────────────────────────────────────────

export type EventCategory =
  | "deposit"
  | "withdrawal"
  | "swap"
  | "refund"
  | "gas"
  | "transfer"
  | "settlement"
  | "compliance"
  | "webhook"
  | "provider"
  | "payout"
  | "balance"
  | "system"
  | "admin"

// ─── Complete event type taxonomy ────────────────────────────────────

export type EventType =
  // Deposits
  | "deposit.created"
  | "deposit.confirmed"
  | "deposit.underpaid"
  | "deposit.overpaid"
  | "deposit.expired"
  // Withdrawals
  | "withdrawal.requested"
  | "withdrawal.approved"
  | "withdrawal.sent"
  | "withdrawal.failed"
  // Swaps
  | "swap.created"
  | "swap.completed"
  | "swap.failed"
  // Refunds
  | "refund.initiated"
  | "refund.completed"
  | "refund.partial"
  // Gas
  | "gas.topup.initiated"
  | "gas.topup.completed"
  | "gas.insufficient"
  // Transfers
  | "transfer.to_exchange"
  | "transfer.confirmed"
  // Settlement
  | "settlement.started"
  | "settlement.completed"
  | "settlement.failed"
  // Compliance
  | "compliance.flagged"
  // Webhook lifecycle
  | "webhook.received"
  | "webhook.invalid_signature"
  | "webhook.duplicate"
  | "webhook.validation_failed"
  // Provider health
  | "provider.degraded"
  | "provider.recovered"
  // Payouts
  | "payout.initiated"
  | "payout.completed"
  | "payout.delayed"
  | "payout.failed"
  // Balance
  | "balance.low"
  | "balance.critical"
  // System
  | "system.error"
  | "system.startup"
  | "system.shutdown"
  // Admin
  | "admin.action.required"

// ─── Routing flags ───────────────────────────────────────────────────

export interface RoutingFlags {
  sendToRedis: boolean
  sendToTelegram: boolean
}

// ─── Core notification event ─────────────────────────────────────────

export interface NotificationEvent {
  /** Internal UUID */
  id: string
  /** External/source event identifier */
  sourceEventId: string | null
  type: EventType
  severity: EventSeverity
  category: EventCategory
  timestamp: Date
  /** Request tracing identifier */
  correlationId: string
  /** Human-readable summary */
  summary: string
  /** Structured, sanitized payload */
  payload: Record<string, unknown>
  /** Original raw data reference */
  rawPayload: unknown | null
  routing: RoutingFlags
}

// ─── Redis stored notification ───────────────────────────────────────

export interface StoredNotification {
  id: string
  sourceEventId: string | null
  type: EventType
  severity: EventSeverity
  category: EventCategory
  timestamp: string
  correlationId: string
  summary: string
  payload: Record<string, unknown>
  createdAt: string
}

// ─── Admin API response types ────────────────────────────────────────

export interface NotificationListResponse {
  notifications: StoredNotification[]
  total: number
  offset: number
  limit: number
}

export interface NotificationDetailResponse {
  notification: StoredNotification
}
