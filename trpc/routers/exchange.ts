/**
 * trpc/routers/exchange.ts — exchange.createRequest
 *
 * Полный флоу создания заявки на обмен:
 *  0. Валидация входных данных
 *  1. Проверка coin-network маппингов (source deposit + destination withdraw)
 *  2. Определение chain-кодов
 *  3. Получение или создание MasterWallet (локальная генерация)
 *  4. Деривация депозитного адреса (локальная)
 *  5. Сохранение DepositAddress + обновление MasterWallet
 *  5a. Автосоздание GasWallet для source и destination сетей
 *  6. Серверный расчёт курса (Binance)
 *  7. Создание ExchangeRequest
 *  8. Возврат ответа клиенту
 */

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { router, publicProcedure } from "../init"
import db, { DepositSource } from "../../db/index"
import { generateWallet, deriveAddress, estimateFee, getFamily } from "../../index"
import { encryptMnemonic } from "../../lib/crypto"
import { getSpotRate } from "../../lib/spotRate"
import { generateOrderId } from "../../lib/orderId"
import { emitNotification } from "../../pipeline/notifications/emit"
import { extractFeeNative } from "../../lib/sweep"
import { getOrCreateDepositAddress } from "../../lib/depositAddress"

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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/**
 * Estimate sweep gas fee for a network. Returns fee in native coin units.
 * Uses a proxy address pair for estimation since deposit address doesn't exist yet.
 */
async function estimateSweepGasFee(
  chainCode: string,
  contractAddress: string | null,
): Promise<number> {
  try {
    const family = getFamily(chainCode)
    const feeData = await estimateFee({
      chain: chainCode,
      from: ZERO_ADDRESS,
      to: ZERO_ADDRESS,
      contractAddress: contractAddress ?? undefined,
    })
    const feeNative = extractFeeNative(feeData, family)
    return parseFloat(feeNative) || 0
  } catch (err) {
    console.warn(`[exchange.createRequest] Gas estimation failed for ${chainCode}:`, err)
    return 0
  }
}

/** Ensure a GasWallet exists for the given network; create one if missing. */
async function ensureGasWallet(networkId: string, chainCode: string) {
  const existing = await db.gasWallet.findFirst({
    where: { networkId, isPrimary: true },
  })
  if (existing) return existing

  const walletData = generateWallet(chainCode)
  const addrData = await deriveAddress(walletData.xpub, 0, chainCode)
  const surprise = encryptMnemonic(walletData.mnemonic)

  return db.gasWallet.create({
    data: {
      networkId,
      address: addrData.address,
      xpub: walletData.xpub,
      surprise,
      type: "MASTER",
      status: "ACTIVE",
      balance: 0,
      minBalance: 0,
      targetBalance: 0,
      isPrimary: true,
    },
  })
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
          include: { coin: true, network: true },
        }),
      ])

      if (!sourceMapping) fail("Selected source coin-network pair is not available for deposits")
      if (!destMapping) fail("Selected destination coin-network pair is not available for payouts")

      const sourceNetwork = sourceMapping.network
      const destNetwork = destMapping.network

      // ── Step 2: Determine chain codes ─────────────────────────────────
      const baseChainCode = sourceMapping.tatumChainCode || sourceNetwork.chain

      // ── Step 3-5: Get or create deposit address ────────────────────────
      // Supports multiple sources: TATUM (HD wallet), KUCOIN, BINANCE (static)
      const depositAddressResult = await getOrCreateDepositAddress({
        coinId: input.fromCoinId,
        networkId: input.fromNetworkId,
        chainCode: baseChainCode,
        coinCode: sourceMapping.coin.code,
        depositSource: sourceNetwork.depositSource,
        kucoinChainCode: sourceNetwork.kucoinChainCode,
      })

      // Fetch the DepositAddress record for linking to ExchangeRequest
      const depositAddress = await db.depositAddress.findUniqueOrThrow({
        where: { address: depositAddressResult.address },
      })

      // ── Step 5a: Ensure GasWallets for source & destination networks ──
      // Skip for exchange-managed deposits (KUCOIN/BINANCE) — no sweep needed
      const destChainCode = destNetwork.chain
      if (sourceNetwork.depositSource === DepositSource.TATUM) {
        await ensureGasWallet(sourceNetwork.id, baseChainCode)
      }
      await ensureGasWallet(destNetwork.id, destChainCode)

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

      // Float fee (our commission) — percentage of gross amount
      const floatFeePercent = Number(toCoin.floatFeePercent)
      const floatFee = grossToAmount * (floatFeePercent / 100)

      // Fixed fee (external/exchange commission) — percentage of gross amount
      const fixedFeePercent = Number(toCoin.fixedFeePercent)
      const fixedFee = grossToAmount * (fixedFeePercent / 100)

      // Gas fee for sweep (source network → exchange)
      // Skip for exchange-managed deposits (KUCOIN/BINANCE) — no sweep needed
      let gasFee = 0
      if (sourceNetwork.depositSource === DepositSource.TATUM) {
        const sourceNativeCoin = sourceNetwork.nativeCoin?.toUpperCase()
        if (sourceNativeCoin) {
          const gasFeeNative = await estimateSweepGasFee(
            baseChainCode,
            sourceMapping.contractAddress,
          )
          if (gasFeeNative > 0) {
            // Convert gas fee from native coin to toCoin
            // Apply 2x multiplier as buffer for gas price fluctuations
            const bufferedGasFee = gasFeeNative * 2
            if (sourceNativeCoin === toCoin.code.toUpperCase()) {
              gasFee = bufferedGasFee
            } else {
              try {
                const gasToToRate = await getSpotRate(sourceNativeCoin, toCoin.code)
                gasFee = bufferedGasFee * gasToToRate
              } catch {
                console.warn(`[exchange.createRequest] Could not convert gas fee ${sourceNativeCoin} → ${toCoin.code}`)
              }
            }
          }
        }
      }

      // Minimum fee floor
      const minFee = Number(toCoin.minimumFee)

      // Total fee: max(float + fixed + gas, minFee)
      const calculatedFee = floatFee + fixedFee + gasFee
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

      // ── Step 7a: Notify operators (Telegram + Redis) ──────────────────
      // Fire-and-forget: notification failures never break request creation.
      void emitNotification("deposit.created", {
        correlationId: exchangeRequest.id,
        summary:
          `New exchange request ${exchangeRequest.orderId}: ` +
          `${fromAmount} ${fromCoin.code} (${sourceNetwork.code}) → ` +
          `${serverToAmount.toFixed(8)} ${toCoin.code} (${destNetwork.code})`,
        payload: {
          exchangeRequestId: exchangeRequest.id,
          orderId: exchangeRequest.orderId,
          depositAddress: depositAddress.address,
          fromAmount: String(fromAmount),
          fromCoin: fromCoin.code,
          fromNetwork: sourceNetwork.code,
          fromChain: sourceNetwork.chain,
          toAmount: serverToAmount.toFixed(8),
          toCoin: toCoin.code,
          toNetwork: destNetwork.code,
          clientWithdrawAddress: input.clientWithdrawAddress,
          estimatedRate: String(serverRate),
          feeAmount: String(feeAmount),
        },
        routingOverride: { sendToTelegram: true },
      })

      // ── Step 8: Return response ───────────────────────────────────────
      return {
        id: exchangeRequest.id,
        orderId: exchangeRequest.orderId,
        depositAddress: { address: depositAddress.address },
        fromAmount: Number(exchangeRequest.fromAmount),
        toAmount: Number(exchangeRequest.toAmount),
        estimatedRate: Number(exchangeRequest.estimatedRate),
        feeAmount: Number(exchangeRequest.feeAmount),
        feeBreakdown: {
          floatFee: parseFloat(floatFee.toFixed(8)),
          fixedFee: parseFloat(fixedFee.toFixed(8)),
          gasFee: parseFloat(gasFee.toFixed(8)),
          minFee: minFee,
        },
        status: exchangeRequest.status,
      }
    }),
})
