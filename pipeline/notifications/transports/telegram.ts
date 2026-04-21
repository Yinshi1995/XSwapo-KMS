import type { NotificationEvent } from "../types"
import { formatTelegramMessage } from "../templates/telegram"

// ─── Telegram transport ──────────────────────────────────────────────
// Sends formatted HTML messages to all configured chat IDs.
// Retry policy: exponential backoff, respects 429 Retry-After header.
// Graceful degradation: individual chat failures are logged, never block pipeline.

const TELEGRAM_API_BASE = "https://api.telegram.org"
const MAX_MESSAGE_LENGTH = 4096

export interface TelegramTransportOptions {
  maxRetries: number
  retryDelayMs: number
}

export class TelegramTransport {
  private botToken: string
  private chatIds: string[]
  private options: TelegramTransportOptions

  constructor(
    botToken: string,
    chatIds: string[],
    options: TelegramTransportOptions
  ) {
    this.botToken = botToken
    this.chatIds = chatIds
    this.options = options
  }

  async send(event: NotificationEvent): Promise<void> {
    if (this.chatIds.length === 0) {
      console.warn(`[telegram] No chat IDs configured, skipping ${event.type} (${event.id})`)
      return
    }

    let message = formatTelegramMessage(event)

    // Truncate if exceeds Telegram limit
    if (message.length > MAX_MESSAGE_LENGTH) {
      const notice = "\n\n<i>⋯ Message truncated</i>"
      message = message.slice(0, MAX_MESSAGE_LENGTH - notice.length) + notice
    }

    const results = await Promise.allSettled(
      this.chatIds.map((chatId) => this.sendToChat(chatId, message, event.id))
    )

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        console.error(
          `[telegram] [${event.id}] Failed to deliver to chat ${this.chatIds[i]}:`,
          result.reason instanceof Error ? result.reason.message : result.reason
        )
      }
    }
  }

  private async sendToChat(chatId: string, text: string, eventId: string): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const url = `${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        })

        if (response.ok) return

        const body = await response.text()

        // Rate limited — wait for Retry-After
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After") || "5")
          console.warn(`[telegram] Rate limited for chat ${chatId}, waiting ${retryAfter}s`)
          await sleep(retryAfter * 1_000)
          continue
        }

        // Client error (bad chat ID, blocked, etc.) — don't retry
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Telegram API ${response.status}: ${body}`)
        }

        // Server error — retry
        lastError = new Error(`Telegram API ${response.status}: ${body}`)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }

      if (attempt < this.options.maxRetries) {
        const delay = this.options.retryDelayMs * Math.pow(2, attempt)
        console.warn(
          `[telegram] [${eventId}] Retry ${attempt + 1}/${this.options.maxRetries} for chat ${chatId} in ${delay}ms`
        )
        await sleep(delay)
      }
    }

    if (lastError) throw lastError
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
