import { loadNotificationConfig, type NotificationConfig } from "./config"
import { sanitizePayload } from "./sanitize"
import { RedisNotificationStore } from "./transports/redis"
import { TelegramTransport } from "./transports/telegram"
import type { NotificationEvent, StoredNotification } from "./types"

// ─── Notification pipeline ───────────────────────────────────────────
//
// Singleton orchestrator. Lazily initializes Redis and Telegram
// transports on first use. All delivery is fire-and-forget: a
// failure in one transport never blocks the other.
//
// Usage:
//   import { pipeline } from "./pipeline"
//   await pipeline.process(event)

class NotificationPipeline {
  private config: NotificationConfig | null = null
  private redis: RedisNotificationStore | null = null
  private telegram: TelegramTransport | null = null
  private initialized = false
  private initializing: Promise<void> | null = null

  // ── Lifecycle ──────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Prevent concurrent initialization
    if (this.initializing) {
      await this.initializing
      return
    }

    this.initializing = this.doInitialize()
    await this.initializing
    this.initializing = null
  }

  private async doInitialize(): Promise<void> {
    try {
      this.config = loadNotificationConfig()

      this.redis = new RedisNotificationStore(
        this.config.redisUrl,
        this.config.redisTtlSeconds
      )
      await this.redis.connect()

      this.telegram = new TelegramTransport(
        this.config.telegramBotToken,
        this.config.telegramChatIds,
        {
          maxRetries: this.config.telegramMaxRetries,
          retryDelayMs: this.config.telegramRetryDelayMs,
        }
      )

      this.initialized = true
      console.info("[notifications] Pipeline initialized")
    } catch (error) {
      console.error("[notifications] Pipeline initialization failed:", error)
      throw error
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // ── Core processing ────────────────────────────────────────────────

  async process(event: NotificationEvent): Promise<void> {
    await this.ensureReady()

    // Sanitize before delivery
    const sanitizedEvent: NotificationEvent = {
      ...event,
      payload: sanitizePayload(event.payload),
    }

    // Structured log
    console.info(
      `[notifications] [${event.correlationId}] ${event.type} (${event.severity}) → ` +
      `redis=${event.routing.sendToRedis} telegram=${event.routing.sendToTelegram}`
    )

    // Deliver to both transports concurrently; isolate failures
    const promises: Promise<void>[] = []

    if (event.routing.sendToRedis && this.redis) {
      promises.push(
        this.redis.store(sanitizedEvent).catch((err) => {
          console.error(
            `[notifications] [${event.correlationId}] Redis delivery failed:`,
            err instanceof Error ? err.message : err
          )
        })
      )
    }

    if (event.routing.sendToTelegram && this.telegram) {
      promises.push(
        this.telegram.send(sanitizedEvent).catch((err) => {
          console.error(
            `[notifications] [${event.correlationId}] Telegram delivery failed:`,
            err instanceof Error ? err.message : err
          )
        })
      )
    }

    await Promise.all(promises)
  }

  // ── Admin API delegates ────────────────────────────────────────────

  async listNotifications(params: {
    offset?: number
    limit?: number
    severity?: string
    category?: string
    type?: string
  }): Promise<{ notifications: StoredNotification[]; total: number }> {
    await this.ensureReady()
    return this.redis!.list(params)
  }

  async getNotification(id: string): Promise<StoredNotification | null> {
    await this.ensureReady()
    return this.redis!.get(id)
  }

  async deleteNotification(id: string): Promise<boolean> {
    await this.ensureReady()
    return this.redis!.delete(id)
  }

  // ── Shutdown ───────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect()
    }
    this.initialized = false
    this.config = null
    this.redis = null
    this.telegram = null
    console.info("[notifications] Pipeline shut down")
  }
}

// Singleton export
export const pipeline = new NotificationPipeline()
