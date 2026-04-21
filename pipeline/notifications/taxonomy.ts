import type { EventType, EventSeverity, EventCategory, RoutingFlags } from "./types"

// ─── Routing presets ─────────────────────────────────────────────────

const BOTH: RoutingFlags = { sendToRedis: true, sendToTelegram: true }
const REDIS_ONLY: RoutingFlags = { sendToRedis: true, sendToTelegram: false }
const TELEGRAM_ONLY: RoutingFlags = { sendToRedis: false, sendToTelegram: true }

// ─── Event definition ────────────────────────────────────────────────

export interface EventDefinition {
  severity: EventSeverity
  category: EventCategory
  routing: RoutingFlags
}

// ─── Taxonomy map ────────────────────────────────────────────────────
// Each event type gets a default severity, category, and routing.
// Routing can be overridden per-emit via routingOverride.

export const EVENT_DEFINITIONS: Record<EventType, EventDefinition> = {
  // ── Deposits ──
  "deposit.created":              { severity: "info",     category: "deposit",     routing: REDIS_ONLY },
  "deposit.confirmed":            { severity: "success",  category: "deposit",     routing: BOTH },
  "deposit.underpaid":            { severity: "warning",  category: "deposit",     routing: BOTH },
  "deposit.overpaid":             { severity: "warning",  category: "deposit",     routing: BOTH },
  "deposit.expired":              { severity: "warning",  category: "deposit",     routing: BOTH },

  // ── Withdrawals ──
  "withdrawal.requested":         { severity: "info",     category: "withdrawal",  routing: REDIS_ONLY },
  "withdrawal.approved":          { severity: "info",     category: "withdrawal",  routing: REDIS_ONLY },
  "withdrawal.sent":              { severity: "success",  category: "withdrawal",  routing: BOTH },
  "withdrawal.failed":            { severity: "error",    category: "withdrawal",  routing: BOTH },

  // ── Swaps ──
  "swap.created":                 { severity: "info",     category: "swap",        routing: REDIS_ONLY },
  "swap.completed":               { severity: "success",  category: "swap",        routing: BOTH },
  "swap.failed":                  { severity: "error",    category: "swap",        routing: BOTH },

  // ── Refunds ──
  "refund.initiated":             { severity: "info",     category: "refund",      routing: BOTH },
  "refund.completed":             { severity: "success",  category: "refund",      routing: BOTH },
  "refund.partial":               { severity: "warning",  category: "refund",      routing: BOTH },

  // ── Gas ──
  "gas.topup.initiated":          { severity: "info",     category: "gas",         routing: REDIS_ONLY },
  "gas.topup.completed":          { severity: "success",  category: "gas",         routing: REDIS_ONLY },
  "gas.insufficient":             { severity: "warning",  category: "gas",         routing: BOTH },

  // ── Transfers ──
  "transfer.to_exchange":         { severity: "info",     category: "transfer",    routing: REDIS_ONLY },
  "transfer.confirmed":           { severity: "success",  category: "transfer",    routing: REDIS_ONLY },

  // ── Settlement ──
  "settlement.started":           { severity: "info",     category: "settlement",  routing: REDIS_ONLY },
  "settlement.completed":         { severity: "success",  category: "settlement",  routing: BOTH },
  "settlement.failed":            { severity: "error",    category: "settlement",  routing: BOTH },

  // ── Compliance ──
  "compliance.flagged":           { severity: "critical", category: "compliance",  routing: BOTH },

  // ── Webhook lifecycle ──
  "webhook.received":             { severity: "info",     category: "webhook",     routing: REDIS_ONLY },
  "webhook.invalid_signature":    { severity: "critical", category: "webhook",     routing: BOTH },
  "webhook.duplicate":            { severity: "info",     category: "webhook",     routing: REDIS_ONLY },
  "webhook.validation_failed":    { severity: "warning",  category: "webhook",     routing: BOTH },

  // ── Provider health ──
  "provider.degraded":            { severity: "warning",  category: "provider",    routing: BOTH },
  "provider.recovered":           { severity: "success",  category: "provider",    routing: BOTH },

  // ── Payouts ──
  "payout.initiated":             { severity: "info",     category: "payout",      routing: REDIS_ONLY },
  "payout.completed":             { severity: "success",  category: "payout",      routing: BOTH },
  "payout.delayed":               { severity: "warning",  category: "payout",      routing: BOTH },
  "payout.failed":                { severity: "error",    category: "payout",      routing: BOTH },

  // ── Balance ──
  "balance.low":                  { severity: "warning",  category: "balance",     routing: BOTH },
  "balance.critical":             { severity: "critical", category: "balance",     routing: BOTH },

  // ── System ──
  "system.error":                 { severity: "error",    category: "system",      routing: BOTH },
  "system.startup":               { severity: "info",     category: "system",      routing: TELEGRAM_ONLY },
  "system.shutdown":              { severity: "info",     category: "system",      routing: TELEGRAM_ONLY },

  // ── Admin ──
  "admin.action.required":        { severity: "critical", category: "admin",       routing: BOTH },
}

export function getEventDefinition(type: EventType): EventDefinition {
  return EVENT_DEFINITIONS[type]
}
