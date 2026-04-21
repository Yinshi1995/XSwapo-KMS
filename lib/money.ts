/**
 * lib/money.ts — thin compatibility layer re-exporting the Decimal helpers.
 *
 * Existing pipeline code imports `../utils/money` (decimal wrappers) and
 * `../wasm/financial-core` (classification, FSM, gas, settlement). This
 * module re-exports everything from `./decimal` so imports can be rewritten
 * to a single location.
 */

export {
  toDecimal,
  decimalEq,
  decimalGt,
  decimalGte,
  decimalLt,
  decimalLte,
  decimalAdd,
  decimalSub,
  decimalMul,
  decimalDiv,
  decimalMin,
  decimalMax,
  truncateDp,
  classifyAmount,
  getRequestedPayoutAmount,
  advanceExchangeRequestStatus,
  buildGasRequirementFromEstimate,
  calculateNetTargetFromTrades,
} from "./decimal"

export type {
  DecimalValue,
  AmountClassificationResult,
  GasRequirementResult,
  BinanceTradeFill,
} from "./decimal"
