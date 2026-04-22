import type { NotificationEvent, EventSeverity, EventType } from "../types"
import { maskAddress, maskTxHash } from "../sanitize"

// ─── Godmode deep-link ───────────────────────────────────────────────
// Admins navigate to the deposit-management modal via
//   https://godmode.xswapo.io/deposit-addresses?send=<onChainDepositAddress>
// Base URL is overridable via env for staging / local dev.

const GODMODE_BASE_URL = (
  process.env.GODMODE_BASE_URL?.trim() || "https://godmode.xswapo.io"
).replace(/\/+$/, "")

function godmodeDepositUrl(depositAddress: string): string {
  return `${GODMODE_BASE_URL}/deposit-addresses?send=${encodeURIComponent(depositAddress)}`
}

// ─── Severity presentation ───────────────────────────────────────────

const SEVERITY_BADGE: Record<EventSeverity, { icon: string; label: string }> = {
  info:     { icon: "ℹ",  label: "Info" },
  success:  { icon: "✓",  label: "Success" },
  warning:  { icon: "⚠",  label: "Warning" },
  error:    { icon: "✕",  label: "Error" },
  critical: { icon: "🚨", label: "CRITICAL" },
}

// ─── Event titles ────────────────────────────────────────────────────

const EVENT_TITLE: Record<EventType, string> = {
  "deposit.created":            "Deposit Created",
  "deposit.confirmed":          "Deposit Confirmed",
  "deposit.underpaid":          "Deposit Underpaid",
  "deposit.overpaid":           "Deposit Overpaid",
  "deposit.expired":            "Deposit Expired",
  "withdrawal.requested":       "Withdrawal Requested",
  "withdrawal.approved":        "Withdrawal Approved",
  "withdrawal.sent":            "Withdrawal Sent",
  "withdrawal.failed":          "Withdrawal Failed",
  "swap.created":               "Swap Initiated",
  "swap.completed":             "Swap Completed",
  "swap.failed":                "Swap Failed",
  "refund.initiated":           "Refund Initiated",
  "refund.completed":           "Refund Completed",
  "refund.partial":             "Partial Refund",
  "gas.topup.initiated":        "Gas Top-Up Initiated",
  "gas.topup.completed":        "Gas Top-Up Complete",
  "gas.insufficient":           "Insufficient Gas",
  "transfer.to_exchange":       "Transfer to Exchange",
  "transfer.confirmed":         "Transfer Confirmed",
  "settlement.started":         "Settlement Started",
  "settlement.completed":       "Settlement Completed",
  "settlement.failed":          "Settlement Failed",
  "compliance.flagged":         "Compliance Alert",
  "webhook.received":           "Webhook Received",
  "webhook.invalid_signature":  "Invalid Signature",
  "webhook.duplicate":          "Duplicate Webhook",
  "webhook.validation_failed":  "Validation Failed",
  "provider.degraded":          "Provider Degraded",
  "provider.recovered":         "Provider Recovered",
  "payout.initiated":           "Payout Initiated",
  "payout.completed":           "Payout Completed",
  "payout.delayed":             "Payout Delayed",
  "payout.failed":              "Payout Failed",
  "balance.low":                "Low Balance",
  "balance.critical":           "Critical Balance",
  "system.error":               "System Error",
  "system.startup":             "System Online",
  "system.shutdown":            "System Offline",
  "admin.action.required":      "Action Required",
}

// ─── Next-action hints per event type ────────────────────────────────

const ACTION_HINTS: Partial<Record<EventType, string[]>> = {
  "deposit.underpaid": [
    "Review exchange request and decide whether to accept or refund.",
  ],
  "deposit.overpaid": [
    "Overpaid amount will be refunded automatically.",
    "Verify refund transaction once broadcasted.",
  ],
  "withdrawal.failed": [
    "Check provider status and wallet balance.",
    "Retry withdrawal or escalate to ops.",
  ],
  "swap.failed": [
    "Verify exchange provider connectivity.",
    "Check trading pair availability and limits.",
  ],
  "settlement.failed": [
    "Inspect settlement logs for root cause.",
    "Manually complete or rollback the exchange request.",
  ],
  "compliance.flagged": [
    "Review transaction for AML/CFT compliance.",
    "Suspend further processing until cleared.",
  ],
  "webhook.invalid_signature": [
    "Review access logs immediately.",
    "Rotate webhook secrets if compromise suspected.",
  ],
  "gas.insufficient": [
    "Top up the gas wallet for the affected network.",
    "Pipeline is paused until gas is available.",
  ],
  "payout.failed": [
    "Verify destination address and network status.",
    "Check exchange withdrawal limits.",
  ],
  "payout.delayed": [
    "Monitor exchange withdrawal queue.",
    "Notify client if delay exceeds SLA.",
  ],
  "balance.low": [
    "Replenish gas wallet balance.",
  ],
  "balance.critical": [
    "Immediate action: transfer funds to gas wallet.",
    "Monitor ongoing transactions for failures.",
  ],
  "system.error": [
    "Check application logs for stack trace.",
    "Verify all external service connections.",
  ],
  "admin.action.required": [
    "Review the event details and take corrective action.",
  ],
  "provider.degraded": [
    "Monitor provider status page.",
    "Consider switching to backup provider.",
  ],
}

// ─── HTML helpers ────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function bold(text: string): string {
  return `<b>${esc(text)}</b>`
}

function code(text: string): string {
  return `<code>${esc(text)}</code>`
}

function italic(text: string): string {
  return `<i>${esc(text)}</i>`
}

function link(href: string, text: string): string {
  // `href` is a controlled URL built from escaped `depositAddressId`; we still
  // HTML-escape it as a defence-in-depth measure.
  return `<a href="${esc(href)}">${esc(text)}</a>`
}

// ─── Layout primitives ───────────────────────────────────────────────

const DIV = "━━━━━━━━━━━━━━━━━━━━━━━━"

function field(label: string, value: string): string {
  return `▸ ${esc(label)}  ${value}`
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

// ─── Financial data block builder ────────────────────────────────────

function buildFinancialBlock(p: Record<string, unknown>): string[] {
  const lines: string[] = []

  if (p.amount !== undefined && p.amount !== null) {
    const currency = p.currency ?? p.coin ?? ""
    lines.push(field("Amount", `${bold(String(p.amount))} ${esc(String(currency))}`))
  }

  if (p.acceptedAmount !== undefined && p.acceptedAmount !== null) {
    lines.push(field("Accepted", bold(String(p.acceptedAmount))))
  }

  if (p.refundAmount !== undefined && p.refundAmount !== null) {
    lines.push(field("Refund", bold(String(p.refundAmount))))
  }

  if (p.expectedAmount !== undefined && p.expectedAmount !== null) {
    lines.push(field("Expected", esc(String(p.expectedAmount))))
  }

  if (p.fromAmount !== undefined && p.toAmount !== undefined) {
    const fromCoin = p.fromCoin ?? ""
    const toCoin = p.toCoin ?? ""
    lines.push(field("Swap", `${esc(String(p.fromAmount))} ${esc(String(fromCoin))} → ${esc(String(p.toAmount))} ${esc(String(toCoin))}`))
  }

  if (p.network) {
    lines.push(field("Network", esc(String(p.network))))
  }

  if (p.chain) {
    lines.push(field("Chain", esc(String(p.chain))))
  }

  if (p.fromAddress) {
    lines.push(field("From", code(maskAddress(String(p.fromAddress)))))
  }

  if (p.toAddress) {
    lines.push(field("To", code(maskAddress(String(p.toAddress)))))
  }

  if (p.depositAddress) {
    // Deposit addresses are platform-managed (not client PII) and admins must
    // be able to read and act on them. Show the full value — unlike
    // `fromAddress` / `toAddress` above, which stay masked.
    lines.push(field("Deposit", code(String(p.depositAddress))))
  }

  if (p.txHash) {
    lines.push(field("Tx", code(maskTxHash(String(p.txHash)))))
  }

  if (p.blockNumber !== undefined && p.blockNumber !== null) {
    lines.push(field("Block", esc(String(p.blockNumber))))
  }

  return lines
}

// ─── Action block builder ────────────────────────────────────────────

function buildActionBlock(event: NotificationEvent): string[] {
  const hints = ACTION_HINTS[event.type]
  if (!hints || hints.length === 0) return []

  const lines: string[] = ["", `⚡ ${bold("Action Required")}`]
  for (const hint of hints) {
    lines.push(`   ${esc(hint)}`)
  }
  return lines
}

// ─── Admin quick-links block ─────────────────────────────────────────
//
// Renders deep-links to the godmode admin UI so an on-call operator can jump
// from Telegram straight to the deposit-management modal.

function buildAdminLinksBlock(p: Record<string, unknown>): string[] {
  const depositAddress = typeof p.depositAddress === "string"
    ? p.depositAddress.trim()
    : ""
  if (!depositAddress) return []

  return [
    "",
    `🔗 ${link(godmodeDepositUrl(depositAddress), "Open in Godmode")}`,
  ]
}

// ═══════════════════════════════════════════════════════════════════════
// ─── MAIN FORMATTER ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
//
// Design principles:
//   • Clean, premium financial aesthetic
//   • Measured emoji — no visual noise
//   • Monospace only for IDs, hashes, addresses
//   • Clear information hierarchy
//   • Consistent structure across all event types

export function formatTelegramMessage(event: NotificationEvent): string {
  const badge = SEVERITY_BADGE[event.severity]
  const title = EVENT_TITLE[event.type] ?? event.type
  const p = event.payload
  const lines: string[] = []

  // ── Header
  if (event.severity === "critical") {
    lines.push(`🚨 ${bold(title.toUpperCase())}`)
  } else {
    lines.push(`◆ ${bold(title)}`)
  }

  lines.push("")
  lines.push(DIV)
  lines.push(`Status  ${badge.icon}  ${esc(badge.label)}`)
  lines.push(DIV)

  // ── Summary
  lines.push("")
  lines.push(esc(event.summary))

  // ── Financial data
  const financial = buildFinancialBlock(p)
  if (financial.length > 0) {
    lines.push("")
    lines.push(...financial)
  }

  // ── Metadata
  lines.push("")

  if (p.exchangeRequestId) {
    lines.push(field("Request", code(String(p.exchangeRequestId))))
  }

  if (p.classification) {
    lines.push(field("Classification", esc(String(p.classification))))
  }

  if (p.status) {
    lines.push(field("Status", esc(String(p.status))))
  }

  if (p.source) {
    lines.push(field("Source", esc(String(p.source))))
  }

  if (p.reason) {
    lines.push(field("Reason", esc(String(p.reason))))
  }

  if (p.error) {
    lines.push(field("Error", esc(String(p.error))))
  }

  lines.push(field("Time", esc(formatTimestamp(event.timestamp))))
  lines.push(field("Correlation", code(event.correlationId)))

  if (event.sourceEventId) {
    lines.push(field("Source ID", code(event.sourceEventId)))
  }

  // ── Actions
  const actions = buildActionBlock(event)
  if (actions.length > 0) {
    lines.push(...actions)
  }

  // ── Admin quick-links (Godmode)
  const adminLinks = buildAdminLinksBlock(p)
  if (adminLinks.length > 0) {
    lines.push(...adminLinks)
  }

  // ── Footer
  lines.push("")
  lines.push(DIV)
  lines.push(italic("xswapo · webhook monitor"))

  return lines.join("\n")
}
