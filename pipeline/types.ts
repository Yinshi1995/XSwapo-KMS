import { Decimal } from "@prisma/client/runtime/client"

import {
  ExchangeRequestStatus,
  Prisma,
  type Transaction,
} from "../db/index"
import type db from "../db/index"

// ─── Prisma include shapes ───────────────────────────────────────────

export const depositAddressInclude = {
  masterWallet: {
    include: {
      coin: true,
      network: true,
    },
  },
} satisfies Prisma.DepositAddressInclude

export const exchangeRequestInclude = {
  fromCoin: true,
  fromNetwork: true,
  toCoin: true,
  toNetwork: true,
  depositAddress: {
    include: depositAddressInclude,
  },
  transactions: true,
} satisfies Prisma.ExchangeRequestInclude

// ─── Derived Prisma payload types ────────────────────────────────────

export type DepositAddressContext = Prisma.DepositAddressGetPayload<{
  include: typeof depositAddressInclude
}>

export type ExchangeRequestContext = Prisma.ExchangeRequestGetPayload<{
  include: typeof exchangeRequestInclude
}>

export type TransactionContext = Prisma.TransactionGetPayload<Record<string, never>>

export type TransactionExecutor = Prisma.TransactionClient | typeof db

// ─── Domain types ────────────────────────────────────────────────────

export type AmountClassification =
  | {
      kind: "exact"
      acceptedAmount: Decimal
      refundAmount: Decimal
      nextStatus: ExchangeRequestStatus
    }
  | {
      kind: "underpaid"
      acceptedAmount: Decimal
      refundAmount: Decimal
      nextStatus: ExchangeRequestStatus
    }
  | {
      kind: "overpaid"
      acceptedAmount: Decimal
      refundAmount: Decimal
      nextStatus: ExchangeRequestStatus
    }

export interface WebhookProcessResult {
  status: number
  body: Record<string, unknown>
}

export interface ClientDepositStageResult {
  kind: "created" | "duplicate" | "ignored"
  request?: ExchangeRequestContext
  transaction?: TransactionContext
  classification?: AmountClassification
  reason?: string
}

export interface GasRequirement {
  gasLimit: Decimal
  gasPrice: Decimal
  estimatedFeeWei: Decimal
  estimatedFeeNative: Decimal
  bufferedFee: Decimal
  requiredNative: Decimal
  isNativeTransfer: boolean
}

export interface GasFundingPlan {
  mainAction: GasRequirement
  gasTopUpTx: GasRequirement | null
  depositWalletBalance: Decimal
  depositWalletTargetBalance: Decimal
  depositWalletDeficit: Decimal
  topUpAmount: Decimal
  gasWalletBalance: Decimal | null
  gasWalletRequiredNative: Decimal | null
  gasWalletShortage: Decimal | null
}

export interface TransferDestination {
  address: string
  networkCode: string
}

export interface ResolvedDepositAddress {
  depositAddress: DepositAddressContext
  matchedField: "address" | "counterAddress"
}

export interface SideEffectIntentResult {
  transaction: TransactionContext
  created: boolean
}

export interface SideEffectDispatchResult {
  triggered: boolean
  blockedByGasTopUp: boolean
}

export interface ExchangeSettlementOutcome {
  provider: string
  payoutTransactionId: string
  withdrawalId: string
  withdrawOrderId: string
  withdrawAmount: string
  orderSymbol?: string
  orderId?: string | number
}

export type OutgoingTransferSpec =
  | {
      kind: "native"
      chain: string
      currency: string
    }
  | {
      kind: "token"
      chain: string
      contractAddress: string
      digits: number
    }
