/**
 * tests/spotRate.test.ts — Unit tests for spot rate calculation (mocked Tatum)
 */

import { describe, it, expect, mock, afterEach } from "bun:test"
import { getSpotRate } from "../lib/spotRate"

// We need TATUM_API_KEY to be set for the underlying tatumClient
process.env.TATUM_API_KEY = "test-key"

const origFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = origFetch
})

/** Create a mocked fetch that returns different rates per symbol */
function mockTatumRates(rates: Record<string, string>) {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    const symbolMatch = url.match(/symbol=([^&]+)/)
    const symbol = symbolMatch ? decodeURIComponent(symbolMatch[1]) : ""
    const value = rates[symbol]
    if (!value) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    }
    return new Response(
      JSON.stringify({ value, symbol, basePair: "USD", timestamp: Date.now(), source: "mock" }),
      { headers: { "Content-Type": "application/json" } },
    )
  }) as typeof fetch
}

describe("getSpotRate", () => {
  it("computes correct ratio for BTC→ETH", async () => {
    mockTatumRates({ BTC: "60000", ETH: "3000" })
    const rate = await getSpotRate("BTC", "ETH")
    expect(rate).toBe(20) // 60000 / 3000
  })

  it("computes ratio with 8 decimal precision", async () => {
    mockTatumRates({ BTC: "60000", USDT: "0.9998" })
    const rate = await getSpotRate("BTC", "USDT")
    expect(rate).toBe(parseFloat((60000 / 0.9998).toFixed(8)))
  })

  it("returns 1 when both coins have the same price", async () => {
    mockTatumRates({ USDT: "1.0001", USDC: "1.0001" })
    const rate = await getSpotRate("USDT", "USDC")
    expect(rate).toBe(1)
  })

  it("throws when fromCoin price is zero", async () => {
    mockTatumRates({ BTC: "0", ETH: "3000" })
    await expect(getSpotRate("BTC", "ETH")).rejects.toThrow("missing price data")
  })

  it("throws when toCoin price is zero", async () => {
    mockTatumRates({ BTC: "60000", ETH: "0" })
    await expect(getSpotRate("BTC", "ETH")).rejects.toThrow("missing price data")
  })

  it("throws when Tatum returns a 404 for the coin", async () => {
    mockTatumRates({ BTC: "60000" }) // ETH not in map → 404
    await expect(getSpotRate("BTC", "ETH")).rejects.toThrow()
  })
})
