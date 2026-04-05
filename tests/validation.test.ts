/**
 * tests/validation.test.ts — Edge cases, error handling, input validation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { generateWallet, deriveAddress, derivePrivateKey } from "../index"
import { requireFields } from "../server"
import { handle } from "../trpc/server"

const _origConsoleError = console.error
beforeAll(() => { console.error = () => {} })
afterAll(() => { console.error = _origConsoleError })

const BASE = "http://localhost:3001"

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

/** Extract the data from a tRPC JSON-envelope response */
async function trpcData(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.result?.data
}

// ═══════════════════════════════════════════════════════════════════════════════
// requireFields behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireFields", () => {
  it("throws for undefined required field", () => {
    expect(() => requireFields({}, ["chain"])).toThrow(/chain/)
  })

  it("throws for null required field", () => {
    expect(() => requireFields({ chain: null }, ["chain"])).toThrow(/chain/)
  })

  it("throws for empty string required field", () => {
    expect(() => requireFields({ chain: "" }, ["chain"])).toThrow(/chain/)
  })

  it("passes valid fields through", () => {
    const body = { chain: "ethereum", index: 0 }
    expect(requireFields(body, ["chain", "index"])).toBe(body)
  })

  it("accepts 0 as a valid value (not falsy rejection)", () => {
    const body = { index: 0 }
    expect(requireFields(body, ["index"])).toBe(body)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Input validation via server routes
// ═══════════════════════════════════════════════════════════════════════════════

describe("input validation via tRPC", () => {
  it("empty string value for chain → error", async () => {
    const res = await handle(trpcMutation("wallet.generate", { chain: "" }))
    expect(res.status).not.toBe(200)
  })

  it("null value for chain → error", async () => {
    const res = await handle(trpcMutation("wallet.generate", { chain: null }))
    expect(res.status).not.toBe(200)
  })

  it('index as string "0" should be accepted (coerced to number)', async () => {
    const genRes = await handle(trpcMutation("wallet.generate", { chain: "ethereum" }))
    const { xpub } = await trpcData(genRes)

    const res = await handle(trpcQuery("wallet.deriveAddress", { xpub, index: "0", chain: "ethereum" }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.address).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Error handling — descriptive messages
// ═══════════════════════════════════════════════════════════════════════════════

describe("error handling", () => {
  it("deriveAddress with invalid xpub throws", () => {
    expect(() => deriveAddress("not-a-valid-xpub", 0, "ethereum")).toThrow()
  })

  it("derivePrivateKey with invalid mnemonic throws", () => {
    expect(() => derivePrivateKey("invalid mnemonic words here", 0, "ethereum")).toThrow()
  })

  it("generateWallet with unknown chain falls through to EVM (no throw)", () => {
    const w = generateWallet("unknown-super-chain")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.split(" ").length).toBe(12) // EVM default uses 12 words
    expect(typeof w.xpub).toBe("string")
  })
})
