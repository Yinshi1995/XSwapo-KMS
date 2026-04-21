// ─── Notification service configuration ──────────────────────────────

export interface NotificationConfig {
  redisUrl: string
  telegramBotToken: string
  telegramChatIds: string[]
  appEnv: string
  redisTtlSeconds: number
  telegramMaxRetries: number
  telegramRetryDelayMs: number
}

// ─── Telegram chat ID parsing ────────────────────────────────────────
// IDs are separated by SPACE (not comma) per requirement.
// Supports negative group IDs (e.g. -1001234567890).

export function parseTelegramChatIds(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return []
  }

  return raw
    .trim()
    .split(/\s+/)
    .filter((id) => /^-?\d+$/.test(id))
}

// ─── Config loader ───────────────────────────────────────────────────

export function loadNotificationConfig(): NotificationConfig {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for notification service")
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for notification service")
  }

  const telegramChatIds = parseTelegramChatIds(process.env.TELEGRAM_CHAT_IDS)
  if (telegramChatIds.length === 0) {
    console.warn("[notifications] TELEGRAM_CHAT_IDS is empty — Telegram delivery disabled")
  }

  return {
    redisUrl,
    telegramBotToken,
    telegramChatIds,
    appEnv: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    redisTtlSeconds: 86_400,
    telegramMaxRetries: 3,
    telegramRetryDelayMs: 1_000,
  }
}
