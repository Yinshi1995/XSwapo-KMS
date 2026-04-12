/**
 * tests/exchange.test.ts — Tests for exchange.createRequest mutation
 *
 * Mocks: global fetch (Tatum API), Prisma client (db)
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "../trpc/routers/index"

/** Local handle that avoids importing trpc/server.ts (which calls Bun.serve) */
async function handle(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
  })
}

// Pre-generated test wallets (valid xpubs for mock data)
let testBtcWallet: { mnemonic: string; xpub: string }
let testEvmWallet: { mnemonic: string; xpub: string }

// Suppress console.error from catch blocks during tests
const _origConsoleError = console.error
beforeAll(() => {
  console.error = () => {}
  process.env.SECRET = "test-secret"
  process.env.SALT_ROUNDS = "4"
  process.env.TATUM_API_KEY = "test-key"
  process.env.TATUM_WEBHOOK_URL = "https://webhook.example.com/tatum"
  testBtcWallet = generateWallet("BTC")
  testEvmWallet = generateWallet("ETH")
})
afterAll(() => {
  console.error = _origConsoleError
})

const BASE = "http://localhost:3001"

function trpcMutation(procedure: string, input: unknown): Request {
  return new Request(`${BASE}/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

async function trpcData(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.result?.data
}

async function trpcError(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.error
}

// ═══════════════════════════════════════════════════════════════════════════════
// Input validation tests (no DB needed — Zod rejects before handler runs)
// ═══════════════════════════════════════════════════════════════════════════════

describe("exchange.createRequest — input validation", () => {
  it("rejects missing required fields", async () => {
    const res = await handle(trpcMutation("exchange.createRequest", {}))
    expect(res.status).not.toBe(200)
  })

  it("rejects empty fromCoinId", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "",
        fromNetworkId: "net1",
        toCoinId: "coin2",
        toNetworkId: "net2",
        fromAmount: 1,
        toAmount: 1,
        clientWithdrawAddress: "0x123",
      }),
    )
    expect(res.status).not.toBe(200)
  })

  it("rejects negative fromAmount", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin1",
        fromNetworkId: "net1",
        toCoinId: "coin2",
        toNetworkId: "net2",
        fromAmount: -5,
        toAmount: 1,
        clientWithdrawAddress: "0x123",
      }),
    )
    expect(res.status).not.toBe(200)
  })

  it("rejects zero toAmount", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin1",
        fromNetworkId: "net1",
        toCoinId: "coin2",
        toNetworkId: "net2",
        fromAmount: 1,
        toAmount: 0,
        clientWithdrawAddress: "0x123",
      }),
    )
    expect(res.status).not.toBe(200)
  })

  it("rejects missing clientWithdrawAddress", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin1",
        fromNetworkId: "net1",
        toCoinId: "coin2",
        toNetworkId: "net2",
        fromAmount: 1,
        toAmount: 1,
      }),
    )
    expect(res.status).not.toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Business logic tests (mocked DB + mocked fetch)
// ═══════════════════════════════════════════════════════════════════════════════

// To test business logic, we mock the db module and global fetch.
// We use Bun's module mocking — but for integration-style tests we import
// the handle() that uses the real appRouter, and mock at the boundary.

import db from "../db/index"
import { generateWallet } from "../index"

describe("exchange.createRequest — Step 0: same coin+network rejection", () => {
  it("rejects when source == destination", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-btc",
        toNetworkId: "net-btc",
        fromAmount: 1,
        toAmount: 0.5,
        clientWithdrawAddress: "0xabc",
      }),
    )
    expect(res.status).not.toBe(200)
    const err = await trpcError(res)
    expect(err.message).toContain("Source and destination must differ")
  })
})

describe("exchange.createRequest — Step 1: mapping validation", () => {
  const origFindFirst = db.coinNetworkMapping.findFirst

  afterEach(() => {
    db.coinNetworkMapping.findFirst = origFindFirst
  })

  it("rejects when source mapping not found", async () => {
    db.coinNetworkMapping.findFirst = mock(async () => null) as any

    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-eth",
        toNetworkId: "net-eth",
        fromAmount: 1,
        toAmount: 0.5,
        clientWithdrawAddress: "0xabc",
      }),
    )
    expect(res.status).not.toBe(200)
    const err = await trpcError(res)
    expect(err.message).toContain("not available")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Full happy-path integration test (all mocked)
// ═══════════════════════════════════════════════════════════════════════════════

describe("exchange.createRequest — full happy path (mocked)", () => {
  const origFetch = globalThis.fetch
  const savedMethods: Record<string, any> = {}

  beforeEach(() => {
    // Save originals
    savedMethods.mappingFindFirst = db.coinNetworkMapping.findFirst
    savedMethods.masterWalletFindUnique = db.masterWallet.findUnique
    savedMethods.depositAddressCreate = db.depositAddress.create
    savedMethods.masterWalletUpdate = db.masterWallet.update
    savedMethods.masterWalletCreate = db.masterWallet.create
    savedMethods.coinFindUniqueOrThrow = db.coin.findUniqueOrThrow
    savedMethods.exchangeRequestFindUnique = db.exchangeRequest.findUnique
    savedMethods.exchangeRequestCreate = db.exchangeRequest.create
    savedMethods.subscriptionCreate = db.subscription.create
    savedMethods.$transaction = db.$transaction

    // ── Mock coin-network mapping (Step 1) ────────────────────────
    let callCount = 0
    db.coinNetworkMapping.findFirst = mock(async (args: any) => {
      callCount++
      if (callCount === 1) {
        // Source mapping
        return {
          id: "mapping-src",
          coinId: "coin-btc",
          networkId: "net-btc",
          tatumChainCode: null,
          network: {
            id: "net-btc",
            chain: "bitcoin",
            tatumWalletSlug: "bitcoin",
          },
          coin: { id: "coin-btc", code: "BTC" },
        }
      }
      // Dest mapping
      return {
        id: "mapping-dst",
        coinId: "coin-eth",
        networkId: "net-eth",
        network: {
          id: "net-eth",
          chain: "ethereum",
        },
        coin: { id: "coin-eth", code: "ETH" },
      }
    }) as any

    // ── Mock MasterWallet (Step 3) — not found first time ─────────
    db.masterWallet.findUnique = mock(async () => null) as any
    db.masterWallet.create = mock(async (args: any) => ({
      xpub: args.data.xpub,
      coinId: args.data.coinId,
      networkId: args.data.networkId,
      surprise: args.data.surprise,
      status: "ACTIVE",
      currentIndex: 0,
      generatedAddresses: 0,
    })) as any

    // ── Mock $transaction (Step 5) ────────────────────────────────
    db.$transaction = mock(async (ops: any[]) => {
      const results = await Promise.all(ops)
      return results
    }) as any
    db.depositAddress.create = mock(async (args: any) => ({
      id: "deposit-addr-1",
      address: args.data.address,
      index: args.data.index,
      masterWalletxpub: args.data.masterWalletxpub,
    })) as any
    db.masterWallet.update = mock(async () => ({})) as any

    // ── Mock Coin lookup (Step 6) ─────────────────────────────────
    db.coin.findUniqueOrThrow = mock(async (args: any) => {
      if (args.where.id === "coin-btc") {
        return {
          id: "coin-btc",
          code: "BTC",
          minDepositAmount: 0.0001,
          maxDepositAmount: null,
          floatFeePercent: 0.5,
          minimumFee: 0.0001,
        }
      }
      return {
        id: "coin-eth",
        code: "ETH",
        minDepositAmount: 0.01,
        maxDepositAmount: null,
        floatFeePercent: 0.5,
        minimumFee: 0.001,
      }
    }) as any

    // ── Mock ExchangeRequest (Step 7) ─────────────────────────────
    db.exchangeRequest.findUnique = mock(async () => null) as any // no collision
    db.exchangeRequest.create = mock(async (args: any) => ({
      id: "exreq-1",
      orderId: args.data.orderId,
      fromCoinId: args.data.fromCoinId,
      fromNetworkId: args.data.fromNetworkId,
      toCoinId: args.data.toCoinId,
      toNetworkId: args.data.toNetworkId,
      fromAmount: args.data.fromAmount,
      toAmount: args.data.toAmount,
      clientWithdrawAddress: args.data.clientWithdrawAddress,
      estimatedRate: args.data.estimatedRate,
      feeAmount: args.data.feeAmount,
      depositAddressId: args.data.depositAddressId,
      status: "CREATED",
    })) as any

    // ── Mock Subscription (Step 8) ────────────────────────────────
    db.subscription.create = mock(async () => ({
      id: "sub-1",
      tatumSubscriptionId: "tatum-sub-123",
    })) as any

    // ── Mock GasWallet (Step 5a) ──────────────────────────────────
    db.gasWallet.findFirst = mock(async () => null) as any
    db.gasWallet.create = mock(async (args: any) => ({
      id: "gas-wallet-1",
      networkId: args.data.networkId,
      address: args.data.address,
      xpub: args.data.xpub,
      isPrimary: true,
    })) as any

    // ── Mock global fetch (Tatum v4 API calls only) ────────────────
    // Wallet generation & address derivation are now local (no Tatum v3)
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()

      // Tatum v4 price rate
      if (url.includes("/v4/data/rate/symbol")) {
        const symbolMatch = url.match(/symbol=([^&]+)/)
        const symbol = symbolMatch ? decodeURIComponent(symbolMatch[1]) : ""
        const prices: Record<string, string> = { BTC: "60000", ETH: "3000" }
        return new Response(
          JSON.stringify({
            value: prices[symbol] || "0",
            symbol,
            basePair: "USD",
            timestamp: Date.now(),
            source: "mock",
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      }

      // Tatum v4 subscription
      if (url.includes("/v4/subscription")) {
        return new Response(
          JSON.stringify({ id: "tatum-sub-123" }),
          { headers: { "Content-Type": "application/json" } },
        )
      }

      return new Response("not found", { status: 404 })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    db.coinNetworkMapping.findFirst = savedMethods.mappingFindFirst
    db.masterWallet.findUnique = savedMethods.masterWalletFindUnique
    db.masterWallet.create = savedMethods.masterWalletCreate
    db.masterWallet.update = savedMethods.masterWalletUpdate
    db.depositAddress.create = savedMethods.depositAddressCreate
    db.coin.findUniqueOrThrow = savedMethods.coinFindUniqueOrThrow
    db.exchangeRequest.findUnique = savedMethods.exchangeRequestFindUnique
    db.exchangeRequest.create = savedMethods.exchangeRequestCreate
    db.subscription.create = savedMethods.subscriptionCreate
    db.gasWallet.findFirst = savedMethods.gasWalletFindFirst
    db.gasWallet.create = savedMethods.gasWalletCreate
    db.$transaction = savedMethods.$transaction
  })

  it("returns 200 with expected response shape", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-eth",
        toNetworkId: "net-eth",
        fromAmount: 1,
        toAmount: 10,
        clientWithdrawAddress: "0xRecipientAddress",
      }),
    )
    expect(res.status).toBe(200)

    const data = await trpcData(res)
    expect(data).toBeDefined()
    expect(data.id).toBe("exreq-1")
    expect(typeof data.orderId).toBe("string")
    expect(data.orderId).toMatch(/^[a-z]+-[a-z]+$/)
    expect(data.depositAddress.address).toBeTruthy()
    expect(typeof data.depositAddress.address).toBe("string")
    expect(data.status).toBe("CREATED")
    expect(typeof data.estimatedRate).toBe("number")
    expect(data.estimatedRate).toBe(20) // BTC 60000 / ETH 3000
    expect(typeof data.feeAmount).toBe("number")
    expect(data.feeAmount).toBeGreaterThan(0)
    expect(data.fromAmount).toBe(1)
    expect(data.toAmount).toBeGreaterThan(0)
  })

  it("calculates correct rate and fees", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-eth",
        toNetworkId: "net-eth",
        fromAmount: 1,
        toAmount: 10,
        clientWithdrawAddress: "0xRecipientAddress",
      }),
    )
    expect(res.status).toBe(200)
    const data = await trpcData(res)

    // Rate should be 60000 / 3000 = 20
    expect(data.estimatedRate).toBe(20)

    // grossToAmount = 1 * 20 = 20 ETH
    // fee = max(20 * 0.5%, 0.001) = max(0.1, 0.001) = 0.1
    // toAmount = 20 - 0.1 = 19.9
    expect(data.feeAmount).toBe(0.1)
    expect(data.toAmount).toBe(19.9)
  })

  it("creates master wallet when none exists", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-eth",
        toNetworkId: "net-eth",
        fromAmount: 1,
        toAmount: 10,
        clientWithdrawAddress: "0xRecipientAddress",
      }),
    )
    expect(res.status).toBe(200)
    expect(db.masterWallet.create).toHaveBeenCalled()
  })

  it("reuses existing master wallet", async () => {
    // Override: wallet already exists (use a real xpub so deriveAddress works)
    db.masterWallet.findUnique = mock(async () => ({
      xpub: testBtcWallet.xpub,
      coinId: "coin-btc",
      networkId: "net-btc",
      surprise: "encrypted",
      status: "ACTIVE",
      currentIndex: 2,
      generatedAddresses: 3,
    })) as any

    // Adjust deposit address mock for the existing xpub
    db.depositAddress.create = mock(async (args: any) => ({
      id: "deposit-addr-2",
      address: args.data.address,
      index: args.data.index,
      masterWalletxpub: args.data.masterWalletxpub,
    })) as any

    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-btc",
        fromNetworkId: "net-btc",
        toCoinId: "coin-eth",
        toNetworkId: "net-eth",
        fromAmount: 1,
        toAmount: 10,
        clientWithdrawAddress: "0xRecipientAddress",
      }),
    )
    expect(res.status).toBe(200)
    expect(db.masterWallet.create).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Bridge mode test (same coin, different network → rate = 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe("exchange.createRequest — bridge mode", () => {
  const origFetch = globalThis.fetch
  const savedMethods: Record<string, any> = {}

  beforeEach(() => {
    savedMethods.mappingFindFirst = db.coinNetworkMapping.findFirst
    savedMethods.masterWalletFindUnique = db.masterWallet.findUnique
    savedMethods.masterWalletCreate = db.masterWallet.create
    savedMethods.masterWalletUpdate = db.masterWallet.update
    savedMethods.depositAddressCreate = db.depositAddress.create
    savedMethods.coinFindUniqueOrThrow = db.coin.findUniqueOrThrow
    savedMethods.exchangeRequestFindUnique = db.exchangeRequest.findUnique
    savedMethods.exchangeRequestCreate = db.exchangeRequest.create
    savedMethods.subscriptionCreate = db.subscription.create
    savedMethods.gasWalletFindFirst = db.gasWallet.findFirst
    savedMethods.gasWalletCreate = db.gasWallet.create
    savedMethods.$transaction = db.$transaction

    let callCount = 0
    db.coinNetworkMapping.findFirst = mock(async () => {
      callCount++
      if (callCount === 1) {
        return {
          id: "mapping-usdt-eth",
          coinId: "coin-usdt",
          networkId: "net-eth",
          tatumChainCode: null,
          network: { id: "net-eth", chain: "ethereum", tatumWalletSlug: "ethereum" },
          coin: { id: "coin-usdt", code: "USDT" },
        }
      }
      return {
        id: "mapping-usdt-tron",
        coinId: "coin-usdt",
        networkId: "net-tron",
        network: { id: "net-tron", chain: "tron" },
        coin: { id: "coin-usdt", code: "USDT" },
      }
    }) as any

    db.masterWallet.findUnique = mock(async () => ({
      xpub: testEvmWallet.xpub,
      coinId: "coin-usdt",
      networkId: "net-eth",
      status: "ACTIVE",
      currentIndex: 0,
      generatedAddresses: 0,
    })) as any
    db.masterWallet.create = mock(async () => ({})) as any
    db.masterWallet.update = mock(async () => ({})) as any
    db.$transaction = mock(async (ops: any[]) => Promise.all(ops)) as any
    db.depositAddress.create = mock(async (args: any) => ({
      id: "dep-usdt-1",
      address: args.data.address,
      index: args.data.index,
      masterWalletxpub: args.data.masterWalletxpub,
    })) as any
    db.coin.findUniqueOrThrow = mock(async () => ({
      id: "coin-usdt",
      code: "USDT",
      minDepositAmount: 10,
      maxDepositAmount: null,
      floatFeePercent: 0.3,
      minimumFee: 1,
    })) as any
    db.exchangeRequest.findUnique = mock(async () => null) as any
    db.exchangeRequest.create = mock(async (args: any) => ({
      id: "exreq-bridge-1",
      orderId: args.data.orderId,
      fromAmount: args.data.fromAmount,
      toAmount: args.data.toAmount,
      estimatedRate: args.data.estimatedRate,
      feeAmount: args.data.feeAmount,
      status: "CREATED",
    })) as any
    db.subscription.create = mock(async () => ({})) as any

    // ── Mock GasWallet (Step 5a) ──────────────────────────────────
    db.gasWallet.findFirst = mock(async () => null) as any
    db.gasWallet.create = mock(async (args: any) => ({
      id: "gas-wallet-bridge",
      networkId: args.data.networkId,
      address: args.data.address,
      xpub: args.data.xpub,
      isPrimary: true,
    })) as any

    // Only mock Tatum v4 subscription — wallet/address derivation is local now
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("/v4/subscription")) {
        return new Response(JSON.stringify({ id: "sub-bridge-1" }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    Object.entries(savedMethods).forEach(([key, val]) => {
      const parts = key.split(".")
      if (parts.length === 1) (db as any)[key] = val
    })
    db.coinNetworkMapping.findFirst = savedMethods.mappingFindFirst
    db.masterWallet.findUnique = savedMethods.masterWalletFindUnique
    db.masterWallet.create = savedMethods.masterWalletCreate
    db.masterWallet.update = savedMethods.masterWalletUpdate
    db.depositAddress.create = savedMethods.depositAddressCreate
    db.coin.findUniqueOrThrow = savedMethods.coinFindUniqueOrThrow
    db.exchangeRequest.findUnique = savedMethods.exchangeRequestFindUnique
    db.exchangeRequest.create = savedMethods.exchangeRequestCreate
    db.subscription.create = savedMethods.subscriptionCreate
    db.gasWallet.findFirst = savedMethods.gasWalletFindFirst
    db.gasWallet.create = savedMethods.gasWalletCreate
    db.$transaction = savedMethods.$transaction
  })

  it("uses rate=1 for same coin on different networks", async () => {
    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId: "coin-usdt",
        fromNetworkId: "net-eth",
        toCoinId: "coin-usdt",
        toNetworkId: "net-tron",
        fromAmount: 100,
        toAmount: 99,
        clientWithdrawAddress: "TUsdt...",
      }),
    )
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.estimatedRate).toBe(1)
    // grossToAmount = 100 * 1 = 100
    // fee = max(100 * 0.3%, 1) = max(0.3, 1) = 1
    // toAmount = 100 - 1 = 99
    expect(data.feeAmount).toBe(1)
    expect(data.toAmount).toBe(99)
  })
})
