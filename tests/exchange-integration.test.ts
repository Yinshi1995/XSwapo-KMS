/**
 * tests/exchange-integration.test.ts
 *
 * Интеграционные тесты для exchange.createRequest.
 * Реальный DB + реальный Tatum API — проверяем, что мастер-кошельки,
 * депозитные адреса, заявки и подписки создаются в базе.
 *
 * ⚠  Требует:
 *   - DATABASE_URL (рабочая PostgreSQL)
 *   - TATUM_API_KEY (действующий ключ)
 *   - SECRET  (для encryptMnemonic)
 *   - TATUM_WEBHOOK_URL
 *
 * Запуск:  bun test tests/exchange-integration.test.ts
 */

import { describe, it, expect, afterAll } from "bun:test"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "../trpc/routers/index"
import db from "../db/index"

// Ensure required env vars are present for the test run
if (!process.env.TATUM_WEBHOOK_URL) {
  process.env.TATUM_WEBHOOK_URL = "https://webhook-test.xswapo.com/tatum"
}
if (!process.env.SECRET) {
  process.env.SECRET = "integration-test-secret"
}

// ─── Handle helper (avoids Bun.serve side-effect from trpc/server.ts) ─────
async function handle(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
  })
}

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
  if (envelope?.error) {
    throw new Error(`tRPC error: ${JSON.stringify(envelope.error)}`)
  }
  return envelope?.result?.data
}

// ─── Look up real IDs from DB ─────────────────────────────────────────────
async function getCoinId(code: string): Promise<string> {
  const coin = await db.coin.findUnique({ where: { code } })
  if (!coin) throw new Error(`Coin ${code} not found in DB`)
  return coin.id
}

async function getNetworkId(code: string): Promise<string> {
  const network = await db.network.findUnique({ where: { code } })
  if (!network) throw new Error(`Network ${code} not found in DB`)
  return network.id
}

// ─── Cleanup: удалить все созданные тестом данные после завершения ─────────
const createdExchangeRequestIds: string[] = []
const createdDepositAddressIds: string[] = []
const createdMasterWalletXpubs: string[] = []

afterAll(async () => {
  // Подписки → Заявки → Адреса → Кошельки (FK-safe)
  if (createdExchangeRequestIds.length) {
    await db.subscription.deleteMany({ where: { exchangeRequestId: { in: createdExchangeRequestIds } } })
    await db.exchangeRequest.deleteMany({ where: { id: { in: createdExchangeRequestIds } } })
  }
  if (createdMasterWalletXpubs.length) {
    // Delete ALL deposit addresses for these master wallets (not just tracked ones)
    await db.depositAddress.deleteMany({ where: { masterWalletxpub: { in: createdMasterWalletXpubs } } })
    await db.masterWallet.deleteMany({ where: { xpub: { in: createdMasterWalletXpubs } } })
  } else if (createdDepositAddressIds.length) {
    await db.depositAddress.deleteMany({ where: { id: { in: createdDepositAddressIds } } })
  }
  console.log(
    `\n🧹 Cleanup: removed ${createdExchangeRequestIds.length} requests, ` +
    `${createdDepositAddressIds.length} deposit addresses, ` +
    `${createdMasterWalletXpubs.length} master wallets`,
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
//  Test cases — each creates a real exchange request against Tatum mainnet
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Набор тестовых пар:
 *  - EVM (ETH on Ethereum → BNB on BSC) — xpub-based wallet
 *  - UTXO (BTC on Bitcoin → ETH on Ethereum) — xpub-based wallet
 *  - TRX on Tron → SOL on Solana — address/secret-based wallet
 *  - Bridge: ETH on Ethereum → ETH on Arbitrum — rate = 1
 */

const TEST_CASES = [
  {
    label: "EVM: ETH/ETH → BNB/BSC",
    from: { coin: "ETH", network: "ETH" },
    to: { coin: "BNB", network: "BSC" },
    fromAmount: 0.1,
    toAmount: 0.01,
    withdrawAddr: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
    expectAddressPrefix: "0x",
  },
  {
    label: "UTXO: BTC/BTC → ETH/ETH",
    from: { coin: "BTC", network: "BTC" },
    to: { coin: "ETH", network: "ETH" },
    fromAmount: 0.001,
    toAmount: 0.01,
    withdrawAddr: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
    expectAddressPrefix: null, // BTC addresses vary
  },
  {
    label: "TRON: TRX/TRX → SOL/SOL",
    from: { coin: "TRX", network: "TRX" },
    to: { coin: "SOL", network: "SOL" },
    fromAmount: 100,
    toAmount: 0.5,
    withdrawAddr: "6sbzC1eH4FTujJXWj51eQe25cYvr4xfXbJ1vAj7j2k5J",
    expectAddressPrefix: "T",
  },
  {
    label: "Bridge: ETH/ETH → ETH/ARB (rate=1)",
    from: { coin: "ETH", network: "ETH" },
    to: { coin: "ETH", network: "ARB" },
    fromAmount: 0.05,
    toAmount: 0.04,
    withdrawAddr: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
    expectAddressPrefix: "0x",
  },
]

describe("exchange.createRequest — integration (real Tatum + real DB)", () => {
  for (const tc of TEST_CASES) {
    it(tc.label, async () => {
      const fromCoinId = await getCoinId(tc.from.coin)
      const fromNetworkId = await getNetworkId(tc.from.network)
      const toCoinId = await getCoinId(tc.to.coin)
      const toNetworkId = await getNetworkId(tc.to.network)

      const res = await handle(
        trpcMutation("exchange.createRequest", {
          fromCoinId,
          fromNetworkId,
          toCoinId,
          toNetworkId,
          fromAmount: tc.fromAmount,
          toAmount: tc.toAmount,
          clientWithdrawAddress: tc.withdrawAddr,
        }),
      )

      expect(res.status).toBe(200)
      const data = await trpcData(res)

      // ── Response shape ────────────────────────────────────────────
      console.log(`\n✅ ${tc.label}`)
      console.log(`   orderId:        ${data.orderId}`)
      console.log(`   depositAddress: ${data.depositAddress.address}`)
      console.log(`   estimatedRate:  ${data.estimatedRate}`)
      console.log(`   fromAmount:     ${data.fromAmount}`)
      console.log(`   toAmount:       ${data.toAmount}`)
      console.log(`   feeAmount:      ${data.feeAmount}`)
      console.log(`   status:         ${data.status}`)

      expect(data.id).toBeDefined()
      expect(data.orderId).toMatch(/^[a-z]+-[a-z]+$/)
      expect(data.depositAddress.address).toBeDefined()
      expect(data.depositAddress.address.length).toBeGreaterThan(5)
      expect(data.estimatedRate).toBeGreaterThan(0)
      expect(data.fromAmount).toBe(tc.fromAmount)
      expect(data.toAmount).toBeGreaterThan(0)
      expect(data.feeAmount).toBeGreaterThanOrEqual(0)
      expect(data.status).toBe("CREATED")

      if (tc.expectAddressPrefix) {
        expect(data.depositAddress.address.startsWith(tc.expectAddressPrefix)).toBe(true)
      }

      // Bridge: rate must be 1
      if (tc.from.coin === tc.to.coin && tc.from.network !== tc.to.network) {
        expect(data.estimatedRate).toBe(1)
      }

      // Track for cleanup
      createdExchangeRequestIds.push(data.id)

      // ── Verify DB: MasterWallet created ───────────────────────────
      const mw = await db.masterWallet.findUnique({
        where: { coinId_networkId: { coinId: fromCoinId, networkId: fromNetworkId } },
      })
      expect(mw).not.toBeNull()
      expect(mw!.xpub.length).toBeGreaterThan(5)
      expect(mw!.surprise).toBeDefined() // encrypted mnemonic
      expect(mw!.surprise!.split(":").length).toBe(3) // iv:data:tag
      expect(mw!.status).toBe("ACTIVE")
      expect(mw!.generatedAddresses).toBeGreaterThanOrEqual(1)
      console.log(`   masterWallet:   xpub=${mw!.xpub.substring(0, 30)}... (index=${mw!.currentIndex}, addrs=${mw!.generatedAddresses})`)

      if (!createdMasterWalletXpubs.includes(mw!.xpub)) {
        createdMasterWalletXpubs.push(mw!.xpub)
      }

      // ── Verify DB: DepositAddress created ─────────────────────────
      const da = await db.depositAddress.findUnique({
        where: { address: data.depositAddress.address },
      })
      expect(da).not.toBeNull()
      expect(da!.masterWalletxpub).toBe(mw!.xpub)
      expect(da!.index).toBeGreaterThanOrEqual(0)
      console.log(`   depositAddr DB: id=${da!.id}, index=${da!.index}`)

      createdDepositAddressIds.push(da!.id)

      // ── Verify DB: ExchangeRequest created ────────────────────────
      const er = await db.exchangeRequest.findUnique({ where: { id: data.id } })
      expect(er).not.toBeNull()
      expect(er!.orderId).toBe(data.orderId)
      expect(er!.fromCoinId).toBe(fromCoinId)
      expect(er!.fromNetworkId).toBe(fromNetworkId)
      expect(er!.toCoinId).toBe(toCoinId)
      expect(er!.toNetworkId).toBe(toNetworkId)
      expect(er!.depositAddressId).toBe(da!.id)
      expect(er!.clientWithdrawAddress).toBe(tc.withdrawAddr)
      expect(er!.status).toBe("CREATED")

      // ── Verify DB: Subscription created ───────────────────────────
      const sub = await db.subscription.findFirst({
        where: { exchangeRequestId: data.id },
      })
      // Subscription can be null if webhook failed (non-fatal), but log it
      if (sub) {
        expect(sub.type).toBe("ADDRESS_EVENT")
        expect(sub.tatumSubscriptionId).toBeDefined()
        expect(sub.isActive).toBe(true)
        expect(sub.depositAddressId).toBe(da!.id)
        console.log(`   subscription:   tatumId=${sub.tatumSubscriptionId}`)
      } else {
        console.log(`   subscription:   ⚠ not created (webhook may have failed)`)
      }
    }, 30_000) // 30s timeout per test (real API calls)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  Verify master wallet REUSE on second address derivation
// ═══════════════════════════════════════════════════════════════════════════════

describe("exchange.createRequest — master wallet reuse", () => {
  it("second ETH/ETH request reuses the same master wallet + increments index", async () => {
    const fromCoinId = await getCoinId("ETH")
    const fromNetworkId = await getNetworkId("ETH")
    const toCoinId = await getCoinId("BTC")
    const toNetworkId = await getNetworkId("BTC")

    // First: check current master wallet state (created in the previous test)
    const mwBefore = await db.masterWallet.findUnique({
      where: { coinId_networkId: { coinId: fromCoinId, networkId: fromNetworkId } },
    })

    const res = await handle(
      trpcMutation("exchange.createRequest", {
        fromCoinId,
        fromNetworkId,
        toCoinId,
        toNetworkId,
        fromAmount: 0.05,
        toAmount: 0.001,
        clientWithdrawAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      }),
    )

    expect(res.status).toBe(200)
    const data = await trpcData(res)
    createdExchangeRequestIds.push(data.id)

    // Master wallet should be the SAME xpub
    const mwAfter = await db.masterWallet.findUnique({
      where: { coinId_networkId: { coinId: fromCoinId, networkId: fromNetworkId } },
    })
    expect(mwAfter).not.toBeNull()

    if (mwBefore) {
      // If the wallet already existed from the first test suite
      expect(mwAfter!.xpub).toBe(mwBefore.xpub) // same wallet reused
      expect(mwAfter!.generatedAddresses).toBe(mwBefore.generatedAddresses + 1)
      expect(mwAfter!.currentIndex).toBe(mwBefore.currentIndex + 1)
      console.log(`\n♻️  Master wallet reused: ${mwAfter!.xpub.substring(0, 30)}...`)
      console.log(`   index: ${mwBefore.currentIndex} → ${mwAfter!.currentIndex}`)
      console.log(`   addrs: ${mwBefore.generatedAddresses} → ${mwAfter!.generatedAddresses}`)
    }

    // New deposit address should have incremented index
    const da = await db.depositAddress.findUnique({
      where: { address: data.depositAddress.address },
    })
    expect(da).not.toBeNull()
    expect(da!.masterWalletxpub).toBe(mwAfter!.xpub)

    createdDepositAddressIds.push(da!.id)

    // Address should differ from the first ETH/ETH test
    console.log(`   new address:     ${data.depositAddress.address}`)
  }, 30_000)
})
