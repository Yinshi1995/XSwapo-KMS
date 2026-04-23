/**
 * pipeline/index.ts — orchestrator for the in-process deposit/settlement
 * pipeline that used to live in the standalone `webhook` service.
 *
 * Boots three long-running workers when `startPipeline()` is called:
 *   1. Notification pipeline (Redis + Telegram transports, lazy)
 *   2. Deposit poller (scans ExchangeRequest addresses every N seconds)
 *   3. Transfer watcher (confirms outgoing sweeps/refunds/gas-topups)
 *
 * All boots are best-effort: missing REDIS_URL or TELEGRAM_BOT_TOKEN is
 * logged but does not prevent the kms server from starting.
 */

import { depositPoller } from "./deposit-poller"
import { emitNotification } from "./notifications/emit"
import { pipeline as notificationPipeline } from "./notifications/pipeline"
import { startTransferWatcher, stopTransferWatcher } from "./transfer-watcher"

let started = false

export async function startPipeline(): Promise<void> {
  if (started) return
  started = true

  let notificationsReady = false
  try {
    await notificationPipeline.initialize()
    notificationsReady = true
  } catch (err) {
    console.warn(
      "[pipeline] notification pipeline failed to initialize — continuing without it:",
      err instanceof Error ? err.message : err,
    )
  }

  depositPoller.start()
  startTransferWatcher()

  console.info("[pipeline] started (deposit poller + transfer watcher + notifications)")

  // Fire-and-forget startup event so operators see a heartbeat in Telegram
  // every time the pipeline comes online. Routes to Telegram only (see
  // notifications/taxonomy.ts → system.startup).
  if (notificationsReady) {
    await emitNotification("system.startup", {
      correlationId: `startup:${Date.now()}`,
      summary: `KMS pipeline online (deposit poller + transfer watcher)`,
      payload: {
        service: "kms",
        pollIntervalMs: Number(process.env.DEPOSIT_POLL_INTERVAL_MS ?? 30_000),
        depositTimeoutHours: Number(process.env.DEPOSIT_TIMEOUT_HOURS ?? 1),
        txWatcherIntervalMs: Number(process.env.TRANSFER_WATCHER_INTERVAL_MS ?? 30_000),
        appEnv: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      },
    })
  }
}

export async function stopPipeline(): Promise<void> {
  if (!started) return
  started = false

  depositPoller.stop()
  stopTransferWatcher()

  try {
    await notificationPipeline.shutdown()
  } catch (err) {
    console.warn(
      "[pipeline] notification pipeline shutdown error:",
      err instanceof Error ? err.message : err,
    )
  }

  console.info("[pipeline] stopped")
}

export { depositPoller } from "./deposit-poller"
export { startTransferWatcher, stopTransferWatcher } from "./transfer-watcher"
export { pipeline as notificationPipeline } from "./notifications/pipeline"
export { emitNotification } from "./notifications/emit"
export { handleAdminNotificationsRequest } from "./notifications/admin"
