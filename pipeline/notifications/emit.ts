import { pipeline } from "./pipeline"
import { getEventDefinition } from "./taxonomy"
import type { EventType, NotificationEvent } from "./types"

// ─── Emit options ────────────────────────────────────────────────────

export interface EmitOptions {
  /** External event ID from source system (e.g. Tatum txId) */
  sourceEventId?: string
  /** Request / correlation ID for tracing */
  correlationId: string
  /** Human-readable summary of the event */
  summary: string
  /** Structured payload (will be sanitized before storage/delivery) */
  payload?: Record<string, unknown>
  /** Raw payload from the source (stored by reference, never sent to Telegram) */
  rawPayload?: unknown
  /** Override default routing for this specific event */
  routingOverride?: {
    sendToRedis?: boolean
    sendToTelegram?: boolean
  }
}

// ─── Public emit function ────────────────────────────────────────────
//
// This is the primary API for the notification service.
//
//   import { emitNotification } from "../notifications/emit"
//
//   await emitNotification("deposit.confirmed", {
//     correlationId: requestId,
//     summary: "Deposit of 12.5 USDT confirmed on BSC",
//     payload: { amount: "12.5", currency: "USDT", network: "BSC", ... },
//   })
//
// Error containment: emitNotification NEVER throws. Any failure is
// logged and swallowed so notification delivery cannot crash the
// main processing pipeline.

export async function emitNotification(
  type: EventType,
  options: EmitOptions
): Promise<void> {
  try {
    const definition = getEventDefinition(type)

    const event: NotificationEvent = {
      id: crypto.randomUUID(),
      sourceEventId: options.sourceEventId ?? null,
      type,
      severity: definition.severity,
      category: definition.category,
      timestamp: new Date(),
      correlationId: options.correlationId,
      summary: options.summary,
      payload: options.payload ?? {},
      rawPayload: options.rawPayload ?? null,
      routing: {
        sendToRedis:
          options.routingOverride?.sendToRedis ?? definition.routing.sendToRedis,
        sendToTelegram:
          options.routingOverride?.sendToTelegram ?? definition.routing.sendToTelegram,
      },
    }

    await pipeline.process(event)
  } catch (error) {
    // Never let notification failures propagate to callers
    console.error(
      `[notifications] [${options.correlationId}] Failed to emit ${type}:`,
      error instanceof Error ? error.message : error
    )
  }
}
