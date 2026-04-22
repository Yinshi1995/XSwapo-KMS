/**
 * lib/sweep.ts — pure in-process sweep implementation.
 *
 * Extracted from the previous `trpc/routers/sweep.ts` procedure so it can be
 * reused by the deposit-polling pipeline without making a network hop back to
 * the tRPC endpoint. The tRPC router is a thin wrapper around this function.
 */

import { estimateFee, getBalance, sendNative, sendToken, getFamily } from "../index"
import type { GasEstimate, ChainFamily } from "../types"

// ─── Types ───────────────────────────────────────────────────────────

export type SweepErrorCode =
  | "GAS_ESTIMATION_FAILED"
  | "GAS_WALLET_INSUFFICIENT"
  | "GAS_TOPUP_FAILED"
  | "SWEEP_FAILED"
  | "INVALID_CHAIN"
  | "INSUFFICIENT_FUNDS"

export type SweepResult =
  | {
      status: "SWEEP_SENT"
      txId: string
      /** Actual amount sent on-chain (native: after gas deduction; token: full amount). */
      amount: string
      destination: string
      /**
       * Gas cost paid from our gas wallet (native coin units, e.g. "0.001" ETH).
       * Only present for token sweeps where gas is paid externally from the gas wallet.
       */
      gasCostNative?: string
    }
  | { status: "GAS_TOPUP_SENT"; gasTopupTxId: string; gasAmount: string; message: string }
  | { status: "ERROR"; code: SweepErrorCode; message: string; details?: unknown }

export interface SweepToExchangeParams {
  destinationAddress: string
  chain: string
  amount: string
  contractAddress?: string
  decimals?: number
  depositPrivateKey: string
  depositAddress: string
  gasPrivateKey: string
  gasAddress: string
  gasFeeMultiplier?: number
  gasMinReserve?: string
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_GAS_FEE_MULTIPLIER = 2.0
const DEFAULT_GAS_MIN_RESERVE = "0"

// ─── Fee extraction ──────────────────────────────────────────────────

/**
 * Extract the estimated fee in human-readable native-token units from the
 * heterogeneous return value of `estimateFee()`.
 */
export function extractFeeNative(
  feeData: GasEstimate | Record<string, unknown>,
  _family: ChainFamily,
): string {
  // EVM — totalFeeEth is present in ETH/BNB/MATIC units
  if ("totalFeeEth" in feeData && typeof feeData.totalFeeEth === "string") {
    return feeData.totalFeeEth
  }

  // TRON — feeLimit returns SUN; convert to TRX
  if ("feeLimit" in feeData && typeof feeData.feeLimit === "number") {
    const feeLimitSun = feeData.feeLimit as number
    if (feeLimitSun === 0) return "0"
    return (feeLimitSun / 1_000_000).toString()
  }

  // BTC / UTXO — feeFor250Bytes is in satoshi
  if ("feeFor250Bytes" in feeData && typeof feeData.feeFor250Bytes === "number") {
    const satoshi = feeData.feeFor250Bytes as number
    return (satoshi / 1e8).toString()
  }

  // Generic — already human-readable
  if ("fee" in feeData && typeof feeData.fee === "string") {
    return feeData.fee
  }

  return "0"
}

// ─── Decimal-safe arithmetic via BigInt-scaled integers ──────────────

const PRECISION = 18n
const SCALE = 10n ** PRECISION

export function toBigScale(value: string): bigint {
  const [intPart = "0", fracPart = ""] = value.split(".")
  const paddedFrac = fracPart.padEnd(Number(PRECISION), "0").slice(0, Number(PRECISION))
  return BigInt(intPart) * SCALE + BigInt(paddedFrac)
}

export function fromBigScale(scaled: bigint): string {
  const isNeg = scaled < 0n
  const abs = isNeg ? -scaled : scaled
  const intPart = abs / SCALE
  const fracPart = abs % SCALE
  const fracStr = fracPart.toString().padStart(Number(PRECISION), "0").replace(/0+$/, "")
  const result = fracStr ? `${intPart}.${fracStr}` : intPart.toString()
  return isNeg ? `-${result}` : result
}

export function multiplyScaled(scaled: bigint, multiplier: number): bigint {
  const MULT_SCALE = 100_000_000n
  const multInt = BigInt(Math.round(multiplier * Number(MULT_SCALE)))
  return (scaled * multInt) / MULT_SCALE
}

// ─── Core sweep implementation ───────────────────────────────────────

/**
 * Stateless sweep: estimate gas → top-up from gas wallet if needed → send
 * funds to destination. Returns a discriminated union describing the outcome.
 */
export async function performSweepToExchange(
  params: SweepToExchangeParams,
): Promise<SweepResult> {
  const {
    destinationAddress, chain, amount,
    contractAddress, decimals,
    depositPrivateKey, depositAddress,
    gasPrivateKey, gasAddress,
    gasFeeMultiplier = DEFAULT_GAS_FEE_MULTIPLIER,
    gasMinReserve = DEFAULT_GAS_MIN_RESERVE,
  } = params

  const isTokenTransfer = !!contractAddress
  const family = getFamily(chain)

  console.log(`[sweep] Starting on ${chain} (family=${family}), token=${isTokenTransfer}, amount=${amount}`)

  // ── 1. Estimate gas fee ────────────────────────────────────────────
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

  // ── 2. Apply multiplier ────────────────────────────────────────────
  const feeScaled = toBigScale(feeNative)
  const bufferedScaled = multiplyScaled(feeScaled, gasFeeMultiplier)
  const minReserveScaled = toBigScale(gasMinReserve)
  const requiredGasScaled = bufferedScaled > minReserveScaled ? bufferedScaled : minReserveScaled
  const requiredGas = fromBigScale(requiredGasScaled)

  console.log(`[sweep] Buffered fee: ${fromBigScale(bufferedScaled)} (×${gasFeeMultiplier}), required gas: ${requiredGas}`)

  // ── 3. Deposit wallet native balance ──────────────────────────────
  const depositBalance = await getBalance(depositAddress, chain)
  const depositNativeScaled = toBigScale(depositBalance.balance)

  console.log(`[sweep] Deposit wallet native balance: ${depositBalance.balance}`)

  // ── 4. Gas top-up if needed ───────────────────────────────────────
  if (depositNativeScaled < requiredGasScaled) {
    console.log(`[sweep] Insufficient gas on deposit wallet (${depositBalance.balance} < ${requiredGas}), initiating gas top-up`)

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

  // ── 5. Send funds to destination ──────────────────────────────────
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
      return {
        status: "SWEEP_SENT",
        txId: result.txId,
        amount,
        destination: destinationAddress,
        gasCostNative: requiredGas,
      }
    } else {
      // Native sweep: send exactly the requested amount. The caller is the
      // source of truth for how much to move (e.g. refundAmount for partial
      // refunds on OVERPAID, acceptedAmount for the transfer-to-exchange step).
      //
      // Gas is paid by the network from the same deposit balance, so we
      // require `balance >= amount + requiredGas`. The gas top-up step above
      // has already ensured `balance >= requiredGas`; here we additionally
      // verify there is room for both the requested amount and the gas.
      const requestedScaled = toBigScale(amount)
      if (requestedScaled <= 0n) {
        return {
          status: "ERROR",
          code: "SWEEP_FAILED",
          message: `Native sweep amount must be positive, got ${amount}`,
          details: { amount },
        }
      }
      if (depositNativeScaled < requestedScaled + requiredGasScaled) {
        return {
          status: "ERROR",
          code: "INSUFFICIENT_FUNDS",
          message: `Deposit balance ${depositBalance.balance} cannot send ${amount} and cover gas ${requiredGas} on ${chain}`,
          details: { balance: depositBalance.balance, requiredGas, requested: amount },
        }
      }
      console.log(`[sweep] Sending native amount=${amount} (balance=${depositBalance.balance}, gas reserve=${requiredGas}) to ${destinationAddress}`)
      const result = await sendNative({
        chain,
        privateKey: depositPrivateKey,
        to: destinationAddress,
        amount,
      })
      console.log(`[sweep] Native sweep sent: ${result.txId}`)
      return { status: "SWEEP_SENT", txId: result.txId, amount, destination: destinationAddress }
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
}
