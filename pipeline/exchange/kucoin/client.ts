/**
 * KuCoin authenticated HTTP client.
 *
 * Wraps fetch() with KuCoin signing logic and response envelope handling.
 * All KuCoin REST responses return { code, data, msg }; code "200000" = success.
 *
 * This module handles:
 * - Request signing via the signer module
 * - Base URL + path construction
 * - Error wrapping into KuCoinApiError
 * - Response envelope unwrapping
 */

import crypto from "crypto"

import type { KuCoinConfig } from "../config"
import { signKuCoinRequest } from "./signer"
import type { KuCoinResponse } from "./types"

export class KuCoinApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly kucoinMessage: string,
    public readonly httpStatus: number,
    public readonly method: string,
    public readonly path: string,
  ) {
    super(`KuCoin API error ${code}: ${kucoinMessage} (${method} ${path}, HTTP ${httpStatus})`)
    this.name = "KuCoinApiError"
  }
}

export interface KuCoinRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  params?: Record<string, string | number | boolean | undefined>
  body?: Record<string, unknown>
  signal?: AbortSignal
}

export class KuCoinClient {
  constructor(private readonly config: KuCoinConfig) {}

  /**
   * Execute a signed request to KuCoin API.
   * Returns unwrapped `data` from the { code, data } envelope.
   */
  async request<T>(path: string, options: KuCoinRequestOptions = {}): Promise<T> {
    const { method = "GET", params, body, signal } = options
    const requestId = crypto.randomUUID()

    // Build URL with query params
    const url = new URL(path, this.config.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue
        url.searchParams.set(key, String(value))
      }
    }

    // Endpoint = path + query (without domain) — this is what gets signed
    const endpoint = url.pathname + url.search

    // Body for POST/PUT; empty string for GET/DELETE
    const bodyString =
      method === "POST" || method === "PUT"
        ? JSON.stringify(body ?? {})
        : ""

    const headers = signKuCoinRequest({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      apiPassphrase: this.config.apiPassphrase,
      apiKeyVersion: this.config.apiKeyVersion,
      method,
      endpoint,
      body: bodyString,
    })

    const safeLogParams = params
      ? Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined),
        )
      : undefined

    console.info(
      `[kucoin:${requestId}] ${method} ${path}`,
      safeLogParams ? JSON.stringify(safeLogParams) : "",
    )

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal,
    }

    if (bodyString && (method === "POST" || method === "PUT")) {
      fetchOptions.body = bodyString
    }

    const res = await fetch(url.toString(), fetchOptions)

    // Even for non-2xx, KuCoin usually returns a JSON envelope
    const text = await res.text().catch(() => "")

    if (!res.ok && !text) {
      console.error(
        `[kucoin:${requestId}] HTTP ${res.status} ${res.statusText} (no body)`,
      )
      throw new KuCoinApiError(
        String(res.status),
        res.statusText || "No response body",
        res.status,
        method,
        path,
      )
    }

    let parsed: KuCoinResponse<T>
    try {
      parsed = JSON.parse(text) as KuCoinResponse<T>
    } catch {
      console.error(
        `[kucoin:${requestId}] Failed to parse response JSON: ${text.slice(0, 500)}`,
      )
      throw new KuCoinApiError(
        String(res.status),
        `Unparseable response body: ${text.slice(0, 200)}`,
        res.status,
        method,
        path,
      )
    }

    if (parsed.code !== "200000") {
      console.error(
        `[kucoin:${requestId}] API error code=${parsed.code} msg=${parsed.msg ?? ""}`,
      )
      throw new KuCoinApiError(
        parsed.code,
        parsed.msg ?? "Unknown KuCoin error",
        res.status,
        method,
        path,
      )
    }

    console.info(`[kucoin:${requestId}] OK ${res.status}`)
    return parsed.data
  }
}
