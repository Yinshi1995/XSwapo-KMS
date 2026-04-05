/**
 * trpc/routers/exchange.ts — exchange.createRequest
 *
 * Полный флоу создания заявки на обмен:
 *  0. Валидация входных данных
 *  1. Проверка coin-network маппингов (source deposit + destination withdraw)
 *  2. Определение chain-кодов для Tatum
 *  3. Получение или создание MasterWallet (Tatum v3)
 *  4. Деривация депозитного адреса (Tatum v3)
 *  5. Сохранение DepositAddress + обновление MasterWallet
 *  6. Серверный расчёт курса (Binance)
 *  7. Создание ExchangeRequest
 *  8. Создание Tatum Subscription (webhook)
 *  9. Возврат ответа клиенту
 */

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { router, publicProcedure } from "../init"
import db from "../../db/index"
import { TATUM_REST_API, TATUM_DATA_API, tatumHeaders } from "../../gateway"
import { encryptMnemonic } from "../../lib/crypto"
import { getSpotRate } from "../../lib/spotRate"
import { generateOrderId } from "../../lib/orderId"

// ─── Input schema ────────────────────────────────────────────────────────────

const CreateExchangeRequestInput = z.object({
  fromCoinId: z.string().min(1),
  fromNetworkId: z.string().min(1),
  toCoinId: z.string().min(1),
  toNetworkId: z.string().min(1),
  fromAmount: z.coerce.number().positive("fromAmount must be > 0"),
  toAmount: z.coerce.number().positive("toAmount must be > 0"),
  clientWithdrawAddress: z.string().min(1),
  feeAmount: z.coerce.number().nonnegative().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fail(message: string, code: TRPCError["code"] = "BAD_REQUEST"): never {
  throw new TRPCError({ code, message })
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const exchangeRouter = router({
  createRequest: publicProcedure
    .input(CreateExchangeRequestInput)
    .mutation(async ({ input }) => {
      // ── Step 0: Extra validation ──────────────────────────────────────
      if (input.fromCoinId === input.toCoinId && input.fromNetworkId === input.toNetworkId) {
        fail("Source and destination must differ by network or coin")
      }

      // ── Step 1: Check coin-network mappings ───────────────────────────
      const [sourceMapping, destMapping] = await Promise.all([
        db.coinNetworkMapping.findFirst({
          where: {
            coinId: input.fromCoinId,
            networkId: input.fromNetworkId,
            isActive: true,
            depositEnabled: true,
            coin: { status: "ACTIVE" },
            network: { status: "ACTIVE", isDepositEnabled: true },
          },
          include: { network: true, coin: true },
        }),
        db.coinNetworkMapping.findFirst({
          where: {
            coinId: input.toCoinId,
            networkId: input.toNetworkId,
            isActive: true,
            withdrawEnabled: true,
            coin: { status: "ACTIVE" },
            network: { status: "ACTIVE", isWithdrawEnabled: true },
          },
          include: { coin: true },
        }),
      ])

      if (!sourceMapping) fail("Selected source coin-network pair is not available for deposits")
      if (!destMapping) fail("Selected destination coin-network pair is not available for payouts")

      const sourceNetwork = sourceMapping.network

      // ── Step 2: Determine Tatum chain codes ───────────────────────────
      const baseChainCode = sourceMapping.tatumChainCode || sourceNetwork.chain
      const walletSlug = sourceNetwork.tatumWalletSlug || baseChainCode.toLowerCase()
      const subscriptionChain = sourceNetwork.chain

      // ── Step 3: Get or create MasterWallet ────────────────────────────
      let masterWallet = await db.masterWallet.findUnique({
        where: { coinId_networkId: { coinId: input.fromCoinId, networkId: input.fromNetworkId } },
      })

      if (!masterWallet) {
        // Generate via Tatum v3
        const walletRes = await fetch(`${TATUM_REST_API}/${walletSlug}/wallet`, {
          method: "GET",
          headers: tatumHeaders(),
        })

        if (!walletRes.ok) {
          const body = await walletRes.text()
          fail(`Tatum wallet generation failed (${walletRes.status}): ${body}`, "INTERNAL_SERVER_ERROR")
        }

        const walletData = (await walletRes.json()) as { xpub?: string; mnemonic?: string; address?: string; secret?: string }

        // Some chains (ed25519) return address+secret instead of xpub+mnemonic
        const xpub = walletData.xpub || walletData.address
        const mnemonic = walletData.mnemonic || walletData.secret

        if (!xpub || !mnemonic) {
          fail("Failed to generate master wallet from Tatum: missing xpub/mnemonic", "INTERNAL_SERVER_ERROR")
        }

        const surprise = encryptMnemonic(mnemonic)

        masterWallet = await db.masterWallet.create({
          data: {
            coinId: input.fromCoinId,
            networkId: input.fromNetworkId,
            xpub,
            surprise,
            status: "ACTIVE",
            currentIndex: 0,
            generatedAddresses: 0,
          },
        })
      }

      // ── Step 4: Derive deposit address ────────────────────────────────
      const nextIndex = masterWallet.generatedAddresses > 0
        ? masterWallet.currentIndex + 1
        : 0

      const addrRes = await fetch(
        `${TATUM_REST_API}/${walletSlug}/address/${encodeURIComponent(masterWallet.xpub)}/${nextIndex}`,
        { method: "GET", headers: tatumHeaders() },
      )

      if (!addrRes.ok) {
        const body = await addrRes.text()
        fail(`Tatum address derivation failed (${addrRes.status}): ${body}`, "INTERNAL_SERVER_ERROR")
      }

      const addrData = (await addrRes.json()) as { address?: string }
      if (!addrData.address) {
        fail("Failed to derive deposit address from master wallet XPUB", "INTERNAL_SERVER_ERROR")
      }

      // ── Step 5: Save DepositAddress + update MasterWallet ─────────────
      const [depositAddress] = await db.$transaction([
        db.depositAddress.create({
          data: {
            address: addrData.address,
            index: nextIndex,
            masterWalletxpub: masterWallet.xpub,
          },
        }),
        db.masterWallet.update({
          where: { xpub: masterWallet.xpub },
          data: {
            currentIndex: nextIndex,
            generatedAddresses: { increment: 1 },
          },
        }),
      ])

      // ── Step 6: Server-side rate calculation ──────────────────────────
      const [fromCoin, toCoin] = await Promise.all([
        db.coin.findUniqueOrThrow({ where: { id: input.fromCoinId } }),
        db.coin.findUniqueOrThrow({ where: { id: input.toCoinId } }),
      ])

      // Check deposit limits
      const fromAmount = input.fromAmount
      const minDeposit = Number(fromCoin.minDepositAmount)
      const maxDeposit = fromCoin.maxDepositAmount ? Number(fromCoin.maxDepositAmount) : null

      if (minDeposit > 0 && fromAmount < minDeposit) {
        fail(`Minimum deposit amount is ${minDeposit} ${fromCoin.code}`)
      }
      if (maxDeposit !== null && fromAmount > maxDeposit) {
        fail(`Maximum deposit amount is ${maxDeposit} ${fromCoin.code}`)
      }

      // Determine rate
      let serverRate: number
      if (input.fromCoinId === input.toCoinId && input.fromNetworkId !== input.toNetworkId) {
        // Bridge: same coin, different network
        serverRate = 1
      } else {
        serverRate = await getSpotRate(fromCoin.code, toCoin.code)
      }

      // Calculate fee & final amount
      const grossToAmount = fromAmount * serverRate
      const feePercent = Number(toCoin.floatFeePercent)
      const calculatedFee = grossToAmount * (feePercent / 100)
      const minFee = Number(toCoin.minimumFee)
      const feeAmount = Math.max(calculatedFee, minFee)
      const serverToAmount = grossToAmount - feeAmount

      if (serverToAmount <= 0) {
        fail("Calculated payout amount is zero or negative after fees")
      }

      // ── Step 7: Create ExchangeRequest ────────────────────────────────
      // Generate unique orderId with retry on collision
      let orderId: string
      for (let attempt = 0; attempt < 5; attempt++) {
        orderId = generateOrderId()
        const existing = await db.exchangeRequest.findUnique({ where: { orderId } })
        if (!existing) break
        if (attempt === 4) fail("Failed to generate unique order ID", "INTERNAL_SERVER_ERROR")
      }

      const exchangeRequest = await db.exchangeRequest.create({
        data: {
          orderId: orderId!,
          fromCoinId: input.fromCoinId,
          fromNetworkId: input.fromNetworkId,
          toCoinId: input.toCoinId,
          toNetworkId: input.toNetworkId,
          fromAmount,
          toAmount: serverToAmount,
          clientWithdrawAddress: input.clientWithdrawAddress,
          estimatedRate: serverRate,
          feeAmount,
          depositAddressId: depositAddress.id,
          status: "CREATED",
        },
      })

      // ── Step 8: Create Tatum Subscription (webhook) ───────────────────
      const webhookUrl = process.env.TATUM_WEBHOOK_URL || process.env.WEBHOOK_URL
      if (!webhookUrl) {
        fail("TATUM_WEBHOOK_URL is not configured", "INTERNAL_SERVER_ERROR")
      }

      const networkType = process.env.TATUM_SUBSCRIPTION_NETWORK_TYPE || "mainnet"

      const subRes = await fetch(
        `${TATUM_DATA_API}/subscription?type=${networkType}`,
        {
          method: "POST",
          headers: tatumHeaders(),
          body: JSON.stringify({
            type: "ADDRESS_EVENT",
            attr: {
              chain: subscriptionChain,
              address: depositAddress.address,
              url: webhookUrl,
            },
          }),
        },
      )

      if (!subRes.ok) {
        const body = await subRes.text()
        console.error(`Tatum subscription failed (${subRes.status}): ${body}`)
        // Non-fatal: request is already created, subscription can be retried
      }

      let subscriptionId: string | null = null
      if (subRes.ok) {
        const subData = (await subRes.json()) as { id?: string }
        subscriptionId = subData.id ?? null
      }

      if (subscriptionId) {
        await db.subscription.create({
          data: {
            type: "ADDRESS_EVENT",
            webhookUrl,
            tatumSubscriptionId: subscriptionId,
            isActive: true,
            chain: subscriptionChain,
            depositAddressId: depositAddress.id,
            exchangeRequestId: exchangeRequest.id,
          },
        })
      }

      // ── Step 9: Return response ───────────────────────────────────────
      return {
        id: exchangeRequest.id,
        orderId: exchangeRequest.orderId,
        depositAddress: { address: depositAddress.address },
        fromAmount: Number(exchangeRequest.fromAmount),
        toAmount: Number(exchangeRequest.toAmount),
        estimatedRate: Number(exchangeRequest.estimatedRate),
        feeAmount: Number(exchangeRequest.feeAmount),
        status: exchangeRequest.status,
      }
    }),
})
