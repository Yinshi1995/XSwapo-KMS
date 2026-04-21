/**
 * KuCoin request signing module.
 *
 * All private KuCoin REST endpoints require the following auth headers:
 *   KC-API-KEY, KC-API-SIGN, KC-API-TIMESTAMP, KC-API-PASSPHRASE, KC-API-KEY-VERSION
 *
 * Signing rules (official docs):
 *   prehash = timestamp + method + endpointPathWithQuery + body
 *   KC-API-SIGN       = Base64(HMAC_SHA256(prehash, apiSecret))
 *   KC-API-PASSPHRASE = Base64(HMAC_SHA256(passphrase, apiSecret))
 *
 * For GET/DELETE the body component is an empty string.
 * For POST/PUT the body is the serialized JSON string.
 */

import crypto from "crypto"

export interface KuCoinSignedHeaders {
  "KC-API-KEY": string
  "KC-API-SIGN": string
  "KC-API-TIMESTAMP": string
  "KC-API-PASSPHRASE": string
  "KC-API-KEY-VERSION": string
  "Content-Type": string
  [key: string]: string
}

export interface KuCoinSignParams {
  apiKey: string
  apiSecret: string
  apiPassphrase: string
  apiKeyVersion: string
  method: string
  /** Path with query string, e.g. "/api/v1/deposits?currency=BTC&status=SUCCESS" */
  endpoint: string
  /** Serialized body for POST/PUT, empty string for GET/DELETE. */
  body: string
  /** Unix timestamp in milliseconds as string. If omitted, Date.now() is used. */
  timestamp?: string
}

function hmacSha256Base64(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64")
}

/**
 * Build the full set of authenticated headers for a KuCoin private REST request.
 */
export function signKuCoinRequest(params: KuCoinSignParams): KuCoinSignedHeaders {
  const timestamp = params.timestamp ?? Date.now().toString()
  const prehash = `${timestamp}${params.method.toUpperCase()}${params.endpoint}${params.body}`

  return {
    "KC-API-KEY": params.apiKey,
    "KC-API-SIGN": hmacSha256Base64(prehash, params.apiSecret),
    "KC-API-TIMESTAMP": timestamp,
    "KC-API-PASSPHRASE": hmacSha256Base64(params.apiPassphrase, params.apiSecret),
    "KC-API-KEY-VERSION": params.apiKeyVersion,
    "Content-Type": "application/json",
  }
}
