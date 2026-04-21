/**
 * Exchange provider configuration.
 *
 * Reads EXCHANGE_PROVIDER from env to determine the active exchange.
 * Validates that provider-specific credentials are present when selected.
 * Binance is the default; switching to KuCoin requires explicit env setup.
 */

export type ExchangeProviderName = "binance" | "kucoin"

export interface KuCoinConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
  apiPassphrase: string
  apiKeyVersion: string
  /** Polling interval for deposit confirmation (ms). */
  depositPollIntervalMs: number
  /** Timeout for deposit confirmation polling (ms). */
  depositPollTimeoutMs: number
  /** accountType sent with POST /api/v1/convert/order. */
  convertAccountType: string
  /** Whether to execute an optional account transfer when no swap occurs. */
  flexTransferEnabled: boolean
  /** Source account for KuCoin account transfer (default: TRADE). */
  flexTransferFrom: string
  /** Target account for KuCoin account transfer (default: MAIN). */
  flexTransferTo: string
  /** Retry count for inner transfer when convert balance is not yet available. */
  innerTransferRetryCount: number
  /** Delay between inner transfer retries (ms). */
  innerTransferRetryDelayMs: number
  /** Retry count for convert order when balance is not yet available. */
  convertRetryCount: number
  /** Delay between convert retries (ms). */
  convertRetryDelayMs: number
}

const VALID_PROVIDERS = new Set<ExchangeProviderName>(["binance", "kucoin"])

function requireEnv(name: string, providerName: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Environment variable ${name} is required when EXCHANGE_PROVIDER=${providerName}`
    )
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value || fallback
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`)
  }
  return Math.trunc(parsed)
}

export function getExchangeProviderName(): ExchangeProviderName {
  const raw = process.env.EXCHANGE_PROVIDER?.trim().toLowerCase()
  if (!raw) return "binance" // default
  if (!VALID_PROVIDERS.has(raw as ExchangeProviderName)) {
    throw new Error(
      `Invalid EXCHANGE_PROVIDER="${raw}". Supported values: ${[...VALID_PROVIDERS].join(", ")}`
    )
  }
  return raw as ExchangeProviderName
}

/**
 * Build and validate KuCoin configuration from env.
 * Only called when EXCHANGE_PROVIDER=kucoin.
 */
export function loadKuCoinConfig(): KuCoinConfig {
  return {
    baseUrl: optionalEnv("KUCOIN_BASE_URL", "https://api.kucoin.com"),
    apiKey: requireEnv("KUCOIN_API_KEY", "kucoin"),
    apiSecret: requireEnv("KUCOIN_API_SECRET", "kucoin"),
    apiPassphrase: requireEnv("KUCOIN_API_PASSPHRASE", "kucoin"),
    apiKeyVersion: optionalEnv("KUCOIN_API_KEY_VERSION", "2"),
    depositPollIntervalMs: positiveIntEnv("KUCOIN_DEPOSIT_POLL_INTERVAL_MS", 35_000),
    depositPollTimeoutMs: positiveIntEnv("KUCOIN_DEPOSIT_POLL_TIMEOUT_MS", 86_400_000),
    convertAccountType: optionalEnv("KUCOIN_CONVERT_ACCOUNT_TYPE", "BOTH"),
    flexTransferEnabled: optionalEnv("KUCOIN_FLEX_TRANSFER_ENABLED", "false") === "true",
    flexTransferFrom: optionalEnv("KUCOIN_FLEX_TRANSFER_FROM", "TRADE"),
    flexTransferTo: optionalEnv("KUCOIN_FLEX_TRANSFER_TO", "MAIN"),
    innerTransferRetryCount: positiveIntEnv("KUCOIN_INNER_TRANSFER_RETRY_COUNT", 6),
    innerTransferRetryDelayMs: positiveIntEnv("KUCOIN_INNER_TRANSFER_RETRY_DELAY_MS", 1500),
    convertRetryCount: positiveIntEnv("KUCOIN_CONVERT_RETRY_COUNT", 10),
    convertRetryDelayMs: positiveIntEnv("KUCOIN_CONVERT_RETRY_DELAY_MS", 5000),
  }
}
