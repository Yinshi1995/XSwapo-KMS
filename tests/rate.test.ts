/**
 * tests/rate.test.ts — unit tests for rate.getCryptoRate & rate.getCryptoRatio
 *
 * Mocks globalThis.fetch to avoid real Tatum API calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { handle } from "../trpc/server"

// Suppress console.error during tests
const _origConsoleError = console.error
beforeAll(() => { console.error = () => {} })
afterAll(() => { console.error = _origConsoleError })

const BASE = "http://localhost:3001"

// ─── helpers ──────────────────────────────────────────────────────────────────

function trpcQuery(procedure: string, input: unknown): Request {
  const encoded = encodeURIComponent(JSON.stringify(input))
  return new Request(`${BASE}/trpc/${procedure}?input=${encoded}`, { method: "GET" })
}

async function trpcData(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.result?.data
}

async function trpcError(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.error
}

// ─── fetch mock helpers ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = handler as typeof fetch
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const ETH_USD = {
  value: "3412.55000000",
  symbol: "ETH",
  basePair: "USD",
  timestamp: 1743868320000,
  source: "CoinGecko",
}

const BTC_USD = {
  value: "108600.00000000",
  symbol: "BTC",
  basePair: "USD",
  timestamp: 1743868320000,
  source: "CoinGecko",
}

const BTC_EUR = {
  value: "99500.00000000",
  symbol: "BTC",
  basePair: "EUR",
  timestamp: 1743868320000,
  source: "CoinGecko",
}

// ═══════════════════════════════════════════════════════════════════════════════
// rate.getCryptoRate
// ═══════════════════════════════════════════════════════════════════════════════

describe("rate.getCryptoRate", () => {
  beforeEach(() => {
    process.env.TATUM_API_KEY = "test-key"
  })

  afterEach(() => {
    restoreFetch()
  })

  it("returns parsed rate for ETH/USD", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "ETH" }))
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data.symbol).toBe("ETH")
    expect(data.basePair).toBe("USD")
    expect(data.value).toBe(3412.55)
    expect(data.source).toBe("CoinGecko")
    expect(typeof data.timestamp).toBe("string")
  })

  it("defaults basePair to USD when not provided", async () => {
    let capturedUrl = ""
    mockFetch((url) => {
      capturedUrl = url as string
      return Response.json(ETH_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "ETH" }))
    expect(res.status).toBe(200)
    expect(capturedUrl).toContain("basePair=USD")
  })

  it("passes custom basePair (BTC/EUR)", async () => {
    let capturedUrl = ""
    mockFetch((url) => {
      capturedUrl = url as string
      return Response.json(BTC_EUR)
    })

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "BTC", basePair: "EUR" }))
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data.basePair).toBe("EUR")
    expect(data.value).toBe(99500)
    expect(capturedUrl).toContain("basePair=EUR")
  })

  it("uppercases symbol and basePair", async () => {
    let capturedUrl = ""
    mockFetch((url) => {
      capturedUrl = url as string
      return Response.json(ETH_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "eth", basePair: "usd" }))
    expect(res.status).toBe(200)
    expect(capturedUrl).toContain("symbol=ETH")
    expect(capturedUrl).toContain("basePair=USD")
  })

  it("returns timestamp as ISO string", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "ETH" }))
    const data = await trpcData(res)
    // Should be a valid ISO date
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp)
  })

  it("sends x-api-key header", async () => {
    let capturedHeaders: Record<string, string> = {}
    mockFetch((_url, init) => {
      const h = init?.headers as Record<string, string> | undefined
      if (h) capturedHeaders = h
      return Response.json(ETH_USD)
    })

    await handle(trpcQuery("rate.getCryptoRate", { symbol: "ETH" }))
    expect(capturedHeaders["x-api-key"]).toBe("test-key")
  })

  it("throws on Tatum 400 error", async () => {
    mockFetch(() => new Response("Bad Request", { status: 400 }))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "INVALIDXYZ" }))
    expect(res.status).toBe(500)

    const err = await trpcError(res)
    expect(err).toBeDefined()
  })

  it("throws on Tatum 500 error", async () => {
    mockFetch(() => new Response("Internal Server Error", { status: 500 }))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "ETH" }))
    expect(res.status).toBe(500)
  })

  it("rejects empty symbol", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "" }))
    expect(res.status).not.toBe(200)
  })

  it("rejects symbol longer than 10 chars", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRate", { symbol: "ABCDEFGHIJK" }))
    expect(res.status).not.toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// rate.getCryptoRatio
// ═══════════════════════════════════════════════════════════════════════════════

describe("rate.getCryptoRatio", () => {
  beforeEach(() => {
    process.env.TATUM_API_KEY = "test-key"
  })

  afterEach(() => {
    restoreFetch()
  })

  it("returns correct ratio for ETH/BTC", async () => {
    let callCount = 0
    mockFetch((url) => {
      callCount++
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data.from).toBe("ETH")
    expect(data.to).toBe("BTC")
    expect(data.fromPriceUsd).toBe(3412.55)
    expect(data.toPriceUsd).toBe(108600)
    expect(data.ratio).toBe(parseFloat((3412.55 / 108600).toFixed(8)))
    expect(callCount).toBe(2)
  })

  it("ratio equals fromPriceUsd / toPriceUsd", async () => {
    mockFetch((url) => {
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    const data = await trpcData(res)

    const expected = parseFloat((data.fromPriceUsd / data.toPriceUsd).toFixed(8))
    expect(data.ratio).toBe(expected)
  })

  it("makes two parallel GET requests to single-rate endpoint", async () => {
    const capturedUrls: string[] = []
    mockFetch((url) => {
      capturedUrls.push(url as string)
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    expect(capturedUrls.length).toBe(2)
    expect(capturedUrls.some((u) => u.includes("symbol=ETH"))).toBe(true)
    expect(capturedUrls.some((u) => u.includes("symbol=BTC"))).toBe(true)
  })

  it("uppercases from and to", async () => {
    const capturedUrls: string[] = []
    mockFetch((url) => {
      capturedUrls.push(url as string)
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    await handle(trpcQuery("rate.getCryptoRatio", { from: "eth", to: "btc" }))
    expect(capturedUrls.some((u) => u.includes("symbol=ETH"))).toBe(true)
    expect(capturedUrls.some((u) => u.includes("symbol=BTC"))).toBe(true)
  })

  it("returns ISO timestamp", async () => {
    mockFetch((url) => {
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    const data = await trpcData(res)
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp)
  })

  it("throws when Tatum returns error", async () => {
    mockFetch(() => new Response("Service Unavailable", { status: 503 }))

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    expect(res.status).toBe(500)
  })

  it("rejects empty from", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "", to: "BTC" }))
    expect(res.status).not.toBe(200)
  })

  it("rejects empty to", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "" }))
    expect(res.status).not.toBe(200)
  })

  it("returns estimatedReceive when amount is provided", async () => {
    mockFetch((url) => {
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC", amount: 2.5 }))
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data.amount).toBe(2.5)
    expect(data.estimatedReceive).toBe(parseFloat((2.5 * data.ratio).toFixed(8)))
  })

  it("defaults amount to 1 and returns estimatedReceive equal to ratio", async () => {
    mockFetch((url) => {
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC" }))
    const data = await trpcData(res)
    expect(data.amount).toBe(1)
    expect(data.estimatedReceive).toBe(data.ratio)
  })

  it("rejects negative amount", async () => {
    mockFetch(() => Response.json(ETH_USD))

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC", amount: -1 }))
    expect(res.status).not.toBe(200)
  })

  it("coerces string amount to number", async () => {
    mockFetch((url) => {
      if ((url as string).includes("symbol=ETH")) return Response.json(ETH_USD)
      return Response.json(BTC_USD)
    })

    const res = await handle(trpcQuery("rate.getCryptoRatio", { from: "ETH", to: "BTC", amount: "5" }))
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data.amount).toBe(5)
    expect(typeof data.estimatedReceive).toBe("number")
  })
})
