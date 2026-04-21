// ─── Sensitive data sanitization ─────────────────────────────────────
// Prevents PII, keys, secrets, and full wallet addresses from leaking
// into logs, Redis payloads, and Telegram messages.

const SENSITIVE_FIELDS = new Set([
  "surprise",
  "mnemonic",
  "privateKey",
  "private_key",
  "secretKey",
  "secret_key",
  "password",
  "apiKey",
  "api_key",
  "apiSecret",
  "api_secret",
  "token",
  "accessToken",
  "refreshToken",
  "seed",
  "passphrase",
])

// ─── Payload sanitizer ───────────────────────────────────────────────

export function sanitizePayload(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = "***REDACTED***"
      continue
    }

    if (typeof value === "string") {
      result[key] = maskIfSecret(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? sanitizePayload(item as Record<string, unknown>)
          : item
      )
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizePayload(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }

  return result
}

// ─── String-level masking ────────────────────────────────────────────

function maskIfSecret(value: string): string {
  // Mask hex strings that look like private keys (64 hex chars, with or without 0x)
  if (/^(0x)?[a-fA-F0-9]{64}$/.test(value)) {
    return value.slice(0, 6) + "···" + value.slice(-4)
  }
  return value
}

// ─── Address masking for display ─────────────────────────────────────

export function maskAddress(address: string | null | undefined): string {
  if (!address) return "—"
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// ─── Transaction hash masking for display ────────────────────────────

export function maskTxHash(hash: string | null | undefined): string {
  if (!hash) return "—"
  if (hash.length <= 16) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}
