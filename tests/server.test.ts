/**
 * tests/server.test.ts — tRPC endpoint tests with mocked fetch
 *
 * We import the handle function directly and pass Request objects.
 * Network-calling tests mock global fetch.
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { handle } from "../trpc/server"

// Suppress console.error from catch blocks during tests
const _origConsoleError = console.error
beforeAll(() => { console.error = () => {} })
afterAll(() => { console.error = _origConsoleError })

const BASE = "http://localhost:3001"

// ─── tRPC helpers ─────────────────────────────────────────────────────────────

/** Call a tRPC mutation (POST with JSON body) */
function trpcMutation(procedure: string, input: unknown): Request {
  return new Request(`${BASE}/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

/** Call a tRPC query (GET with ?input= query param) */
function trpcQuery(procedure: string, input: unknown): Request {
  const encoded = encodeURIComponent(JSON.stringify(input))
  return new Request(`${BASE}/trpc/${procedure}?input=${encoded}`, { method: "GET" })
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`, { method: "GET" })
}

/** Extract the data from a tRPC JSON-envelope response */
async function trpcData(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.result?.data
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /health
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await handle(get("/health"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })

  it("returns chains array with at least 6 items", async () => {
    const res = await handle(get("/health"))
    const body = await res.json()
    expect(Array.isArray(body.chains)).toBe(true)
    expect(body.chains.length).toBeGreaterThanOrEqual(6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// wallet.generate (mutation)
// ═══════════════════════════════════════════════════════════════════════════════

describe("wallet.generate", () => {
  it("ethereum → 200 with mnemonic and xpub", async () => {
    const res = await handle(trpcMutation("wallet.generate", { chain: "ethereum" }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(typeof data.mnemonic).toBe("string")
    expect(data.mnemonic.length).toBeGreaterThan(0)
    expect(typeof data.xpub).toBe("string")
    expect(data.xpub.length).toBeGreaterThan(0)
  })

  it("bitcoin → 200 with mnemonic and xpub", async () => {
    const res = await handle(trpcMutation("wallet.generate", { chain: "bitcoin" }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(typeof data.mnemonic).toBe("string")
    expect(typeof data.xpub).toBe("string")
  })

  it("missing chain field → error", async () => {
    const res = await handle(trpcMutation("wallet.generate", {}))
    expect(res.status).not.toBe(200)
  })

  it("empty chain → error", async () => {
    const res = await handle(trpcMutation("wallet.generate", { chain: "" }))
    expect(res.status).not.toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// wallet.deriveAddress (query)
// ═══════════════════════════════════════════════════════════════════════════════

describe("wallet.deriveAddress", () => {
  it("valid xpub + index 0 + ethereum → 200 with 0x address", async () => {
    // First generate a wallet to get a valid xpub
    const genRes = await handle(trpcMutation("wallet.generate", { chain: "ethereum" }))
    const { xpub } = await trpcData(genRes)

    const res = await handle(trpcQuery("wallet.deriveAddress", { xpub, index: 0, chain: "ethereum" }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.address.startsWith("0x")).toBe(true)
  })

  it("valid xpub + index 0 + tron → 200 with T address", async () => {
    const genRes = await handle(trpcMutation("wallet.generate", { chain: "tron" }))
    const { xpub } = await trpcData(genRes)

    const res = await handle(trpcQuery("wallet.deriveAddress", { xpub, index: 0, chain: "tron" }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.address.startsWith("T")).toBe(true)
  })

  it("missing xpub → error", async () => {
    const res = await handle(trpcQuery("wallet.deriveAddress", { index: 0, chain: "ethereum" }))
    expect(res.status).not.toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// balance.native (query, mocked fetch)
// ═══════════════════════════════════════════════════════════════════════════════

describe("balance.native (mocked)", () => {
  const origFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it("returns balance 2.0 for mocked eth_getBalance response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        result: "0x1BC16D674EC80000", // 2 ETH in wei
        id: 1,
      }), { headers: { "Content-Type": "application/json" } })
    ) as typeof fetch

    const res = await handle(trpcQuery("balance.native", {
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
      chain: "ethereum",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.balance).toBe("2.0")
    expect(data.raw).toBe("2000000000000000000")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// tx.status (query, mocked fetch)
// ═══════════════════════════════════════════════════════════════════════════════

describe("tx.status (mocked)", () => {
  const origFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  it("returns 'confirmed' when receipt has status 0x1", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        result: {
          status: "0x1",
          blockNumber: "0x10",
          gasUsed: "0x5208",
        },
        id: 1,
      }), { headers: { "Content-Type": "application/json" } })
    ) as typeof fetch

    const res = await handle(trpcQuery("tx.status", {
      txId: "0xabc123",
      chain: "ethereum",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("confirmed")
  })

  it("returns 'pending' when receipt is null", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({
        jsonrpc: "2.0",
        result: null,
        id: 1,
      }), { headers: { "Content-Type": "application/json" } })
    ) as typeof fetch

    const res = await handle(trpcQuery("tx.status", {
      txId: "0xdef456",
      chain: "ethereum",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("pending")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Unknown route
// ═══════════════════════════════════════════════════════════════════════════════

describe("unknown routes", () => {
  it("GET /unknown → 404 with error field", async () => {
    const res = await handle(get("/unknown"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})
