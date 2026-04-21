/**
 * Gas requirement calculation utilities.
 *
 * The runtime gas management (ensureGasForStep, gas top-up broadcasting) has
 * been moved to the KMS microservice. This module retains only the pure
 * buildGasRequirementFromEstimate helper used by tests and the WASM
 * equivalence suite.
 */

import { Decimal } from "@prisma/client/runtime/client"

import {
  buildGasRequirementFromEstimate as wasmBuildGasRequirement,
} from "../lib/decimal"
import {
  GAS_FEE_MULTIPLIER,
  GAS_MIN_RESERVE,
} from "./constants"
import {
  type GasRequirement,
} from "./types"

export function buildGasRequirementFromEstimate(
  estimate: { gasLimit: string; gasPrice: string },
  amount: Decimal,
  isNativeTransfer: boolean
): GasRequirement {
  const result = wasmBuildGasRequirement(
    estimate,
    amount,
    isNativeTransfer,
    GAS_FEE_MULTIPLIER,
    GAS_MIN_RESERVE,
  )
  return {
    gasLimit: result.gasLimit,
    gasPrice: result.gasPrice,
    estimatedFeeWei: result.estimatedFeeWei,
    estimatedFeeNative: result.estimatedFeeNative,
    bufferedFee: result.bufferedFee,
    requiredNative: result.requiredNative,
    isNativeTransfer: result.isNativeTransfer,
  }
}