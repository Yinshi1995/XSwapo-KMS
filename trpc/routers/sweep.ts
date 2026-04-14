/**
 * trpc/routers/sweep.ts — sweep.toExchange
 *
 * Stateless sweep: estimate gas → top-up if needed → send funds to exchange.
 * Called by the webhook service per deposit confirmation.
 */

import { z } from "zod"
import {
  router, publicProcedure,
  ChainSchema, AddressSchema, AmountSchema, PrivateKeySchema,
} from "../init"
import { estimateFee, getBalance, sendNative, sendToken, getFamily } from "../../index"
import type { GasEstimate, SweepResult, ChainFamily } from "../../types"

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_GAS_FEE_MULTIPLIER = 2.0
const DEFAULT_GAS_MIN_RESERVE = "0"

// ─── Fee extraction helper ───────────────────────────────────────────────────

/**
 * Extract the estimated fee in human-readable native-token units from the
 * heterogeneous return value of `estimateFee()`.
 *
 * - EVM  → GasEstimate.totalFeeEth  (string, in ETH/BNB/MATIC…)
 * - TRON token → feeLimit (number, in SUN) → convert to TRX
 * - TRON native → 0 (bandwidth is free within daily limit)
 * - BTC/UTXO → feeFor250Bytes (satoshi) → convert to BTC
 * - Others → fee (string, human-readable)
 */
export function extractFeeNative(
  feeData: GasEstimate | Record<string, unknown>,
  family: ChainFamily,
): string {
  // EVM — has totalFeeEth
  if ("totalFeeEth" in feeData && typeof feeData.totalFeeEth === "string") {
    return feeData.totalFeeEth
  }

  // TRON — energy-based estimation returns { energyRequired, feeLimit }
  if ("feeLimit" in feeData && typeof feeData.feeLimit === "number") {
    const feeLimitSun = feeData.feeLimit as number
    if (feeLimitSun === 0) return "0"
    // Convert SUN → TRX  (1 TRX = 1_000_000 SUN)
    return (feeLimitSun / 1_000_000).toString()
  }

  // BTC / UTXO — { feePerByte, feeFor250Bytes } in satoshi
  if ("feeFor250Bytes" in feeData && typeof feeData.feeFor250Bytes === "number") {
    const satoshi = feeData.feeFor250Bytes as number
    // Convert satoshi → BTC  (1 BTC = 100_000_000 satoshi)
    return (satoshi / 1e8).toString()
  }

  // Generic chains — { fee: string } (human-readable)
  if ("fee" in feeData && typeof feeData.fee === "string") {
    return feeData.fee
  }

  return "0"
}

// ─── Decimal-safe comparison & arithmetic via BigInt-scaled integers ─────────

const PRECISION = 18n
const SCALE = 10n ** PRECISION

/** Parse a human-readable decimal string into a scaled BigInt */
export function toBigScale(value: string): bigint {
  const [intPart = "0", fracPart = ""] = value.split(".")
  const paddedFrac = fracPart.padEnd(Number(PRECISION), "0").slice(0, Number(PRECISION))
  return BigInt(intPart) * SCALE + BigInt(paddedFrac)
}

/** Convert a scaled BigInt back to a human-readable decimal string */
export function fromBigScale(scaled: bigint): string {
  const isNeg = scaled < 0n
  const abs = isNeg ? -scaled : scaled
  const intPart = abs / SCALE
  const fracPart = abs % SCALE
  const fracStr = fracPart.toString().padStart(Number(PRECISION), "0").replace(/0+$/, "")
  const result = fracStr ? `${intPart}.${fracStr}` : intPart.toString()
  return isNeg ? `-${result}` : result
}

/** Multiply a scaled BigInt by a float multiplier, returning scaled BigInt */
export function multiplyScaled(scaled: bigint, multiplier: number): bigint {
  // Convert multiplier to integer arithmetic: multiplier * 1e8, then divide by 1e8
  const MULT_SCALE = 100_000_000n
  const multInt = BigInt(Math.round(multiplier * Number(MULT_SCALE)))
  return (scaled * multInt) / MULT_SCALE
}

// ─── Sweep router ────────────────────────────────────────────────────────────

export const sweepRouter = router({
  toExchange: publicProcedure
    .input(
      z.object({
        destinationAddress: AddressSchema,
        chain: ChainSchema,
        amount: AmountSchema,
        contractAddress: z.string().min(1).optional(),
        decimals: z.number({ coerce: true }).int().optional(),
        depositPrivateKey: PrivateKeySchema,
        depositAddress: AddressSchema,
        gasPrivateKey: PrivateKeySchema,
        gasAddress: AddressSchema,
        gasFeeMultiplier: z.number().positive().optional(),
        gasMinReserve: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<SweepResult> => {
      const {
        destinationAddress, chain, amount,
        contractAddress, decimals,
        depositPrivateKey, depositAddress,
        gasPrivateKey, gasAddress,
        gasFeeMultiplier = DEFAULT_GAS_FEE_MULTIPLIER,
        gasMinReserve = DEFAULT_GAS_MIN_RESERVE,
      } = input

      const isTokenTransfer = !!contractAddress
      const family = getFamily(chain)

      console.log(`[sweep] Starting sweep on ${chain} (family=${family}), token=${isTokenTransfer}, amount=${amount}`)

      // ── 1. Estimate gas fee ──────────────────────────────────────────────
      let feeNative: string
      try {
        const feeData = await estimateFee({
          chain,
          from: depositAddress,
          to: destinationAddress,
          amount: isTokenTransfer ? undefined : amount,
          contractAddress,
        })
        feeNative = extractFeeNative(feeData, family)
        console.log(`[sweep] Raw fee estimate: ${feeNative} (native)`)
      } catch (err) {
        console.error(`[sweep] Fee estimation failed:`, err)
        return {
          status: "ERROR",
          code: "GAS_ESTIMATION_FAILED",
          message: `Failed to estimate gas for ${chain}`,
          details: err instanceof Error ? err.message : err,
        }
      }

      // ── 2. Apply gas fee multiplier (buffered fee) ───────────────────────
      const feeScaled = toBigScale(feeNative)
      const bufferedScaled = multiplyScaled(feeScaled, gasFeeMultiplier)
      const minReserveScaled = toBigScale(gasMinReserve)
      const requiredGasScaled = bufferedScaled > minReserveScaled ? bufferedScaled : minReserveScaled
      const requiredGas = fromBigScale(requiredGasScaled)

      console.log(`[sweep] Buffered fee: ${fromBigScale(bufferedScaled)} (×${gasFeeMultiplier}), required gas: ${requiredGas}`)

      // ── 3. Check deposit wallet native balance ───────────────────────────
      const depositBalance = await getBalance(depositAddress, chain)
      const depositNativeScaled = toBigScale(depositBalance.balance)

      console.log(`[sweep] Deposit wallet native balance: ${depositBalance.balance}`)

      // ── 4. Gas top-up if needed ──────────────────────────────────────────
      if (depositNativeScaled < requiredGasScaled) {
        console.log(`[sweep] Insufficient gas on deposit wallet (${depositBalance.balance} < ${requiredGas}), initiating gas top-up`)

        // Check gas wallet balance
        const gasWalletBalance = await getBalance(gasAddress, chain)
        const gasWalletScaled = toBigScale(gasWalletBalance.balance)

        console.log(`[sweep] Gas wallet balance: ${gasWalletBalance.balance}`)

        if (gasWalletScaled < requiredGasScaled) {
          return {
            status: "ERROR",
            code: "GAS_WALLET_INSUFFICIENT",
            message: `Gas wallet has ${gasWalletBalance.balance} but ${requiredGas} is required`,
            details: { gasWalletBalance: gasWalletBalance.balance, requiredGas },
          }
        }

        // Send gas top-up
        try {
          const topupResult = await sendNative({
            chain,
            privateKey: gasPrivateKey,
            to: depositAddress,
            amount: requiredGas,
          })

          console.log(`[sweep] Gas top-up sent: ${topupResult.txId}, amount: ${requiredGas}`)

          return {
            status: "GAS_TOPUP_SENT",
            gasTopupTxId: topupResult.txId,
            gasAmount: requiredGas,
            message: "Gas top-up sent, retry sweep after confirmation",
          }
        } catch (err) {
          console.error(`[sweep] Gas top-up failed:`, err)
          return {
            status: "ERROR",
            code: "GAS_TOPUP_FAILED",
            message: `Failed to send gas top-up to ${depositAddress}`,
            details: err instanceof Error ? err.message : err,
          }
        }
      }

      // ── 5. Send funds to exchange ────────────────────────────────────────
      try {
        if (isTokenTransfer) {
          console.log(`[sweep] Sending token ${contractAddress} amount=${amount} to ${destinationAddress}`)
          const result = await sendToken({
            chain,
            privateKey: depositPrivateKey,
            to: destinationAddress,
            contractAddress: contractAddress!,
            amount,
            decimals,
          })
          console.log(`[sweep] Token sweep sent: ${result.txId}`)
          return { status: "SWEEP_SENT", txId: result.txId, amount, destination: destinationAddress }
        } else {
          // Native sweep: gas comes from the same balance, so subtract fee
          const sendAmountScaled = depositNativeScaled - requiredGasScaled
          if (sendAmountScaled <= 0n) {
            return {
              status: "ERROR",
              code: "INSUFFICIENT_FUNDS",
              message: `Deposit balance ${depositBalance.balance} is not enough to cover gas ${requiredGas} for native sweep on ${chain}`,
              details: { balance: depositBalance.balance, requiredGas },
            }
          }
          const sendAmount = fromBigScale(sendAmountScaled)
          console.log(`[sweep] Sending native amount=${sendAmount} (deposit=${depositBalance.balance} - gas=${requiredGas}) to ${destinationAddress}`)
          const result = await sendNative({
            chain,
            privateKey: depositPrivateKey,
            to: destinationAddress,
            amount: sendAmount,
          })
          console.log(`[sweep] Native sweep sent: ${result.txId}`)
          return { status: "SWEEP_SENT", txId: result.txId, amount: sendAmount, destination: destinationAddress }
        }
      } catch (err) {
        console.error(`[sweep] Sweep send failed:`, err)
        return {
          status: "ERROR",
          code: "SWEEP_FAILED",
          message: `Failed to send ${isTokenTransfer ? "token" : "native"} sweep on ${chain}`,
          details: err instanceof Error ? err.message : err,
        }
      }
    }),
})
