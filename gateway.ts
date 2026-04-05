/**
 * gateway.ts — Tatum RPC Gateway helper
 *
 * All Tatum RPC URLs follow the same pattern: https://{slug}.gateway.tatum.io
 * The gateway base URL and API key are read from environment variables.
 */

export const TATUM_API_KEY = process.env.TATUM_API_KEY!
export const TATUM_GATEWAY = process.env.TATUM_GATEWAY ?? "https://{slug}.gateway.tatum.io"
export const TATUM_DATA_API = process.env.TATUM_DATA_API ?? "https://api.tatum.io/v4"
export const TATUM_REST_API = process.env.TATUM_REST_API ?? "https://api.tatum.io/v3"

/** Build a Tatum RPC URL for a given chain slug, e.g. "ethereum-mainnet" */
export function gatewayUrl(slug: string): string {
  return TATUM_GATEWAY.replace("{slug}", slug)
}

/** Common headers for every Tatum request */
export function tatumHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY, ...extra }
}
