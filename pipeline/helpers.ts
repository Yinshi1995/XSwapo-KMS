import { Decimal } from "@prisma/client/runtime/client"

import db, {
  ExchangeRequestStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
  type CoinNetworkMapping,
  type GasWallet,
  type Network,
  type Transaction,
} from "../db/index"
import { decryptMnemonic } from "../lib/crypto"
import { derivePrivateKey as kmsDerivePk } from "./kms-local"
import {
  advanceExchangeRequestStatus as wasmAdvanceStatus,
  classifyAmount as wasmClassifyAmount,
  getRequestedPayoutAmount as wasmGetRequestedPayoutAmount,
} from "../lib/decimal"

/**
 * Map a Prisma `Network.chain` value to the token chain code that Tatum
 * expects. For the current project, these are equal (upper-cased); callers
 * that need a Tatum-specific override must provide it via
 * `CoinNetworkMapping.tatumChainCode`.
 */
function mapPrismaNetworkChainToTatum(chain: string): string {
  return chain
}
import {
  ACCEPTABLE_DEPOSIT_STATUSES,
  FINAL_EXCHANGE_REQUEST_STATUSES,
  GAS_FEE_MULTIPLIER,
  GAS_MIN_RESERVE,
  KNOWN_INTERNAL_TRANSACTION_TYPES,
} from "./constants"
import type { NormalizedTatumWebhookPayload } from "./normalize"
import {
  depositAddressInclude,
  type AmountClassification,
  type DepositAddressContext,
  type ExchangeRequestContext,
  type GasFundingPlan,
  type OutgoingTransferSpec,
  type SideEffectIntentResult,
  type TransactionExecutor,
} from "./types"

// ─── Prisma error guard ──────────────────────────────────────────────

export function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError
}

// ─── Network / chain helpers ─────────────────────────────────────────

export function getChainSlug(network: Network): string {
  return network.tatumWalletSlug ?? network.chain
}

export function getNativeCoinCode(network: Network): string {
  if (network.nativeCoin) {
    return network.nativeCoin.toUpperCase()
  }

  const chain = network.chain.toUpperCase()
  if (chain === "ETH") return "ETH"
  if (chain === "BSC") return "BNB"
  if (chain === "MATIC" || chain === "POLYGON") return "MATIC"
  if (chain === "AVAX" || chain === "AVALANCHE") return "AVAX"
  return chain
}

export function getTatumNativeCurrencyCode(network: Network): string {
  const chain = getChainSlug(network).toUpperCase()

  if (chain === "BSC") return "BSC"
  if (chain === "ETH") return "ETH"
  if (chain === "MATIC" || chain === "POLYGON") return "MATIC"
  if (chain === "AVAX" || chain === "AVALANCHE") return "AVAX"

  return chain
}

// ─── Formatting / logging ────────────────────────────────────────────

function createJsonLogData(data: Record<string, unknown>): Prisma.InputJsonValue {
  return data as Prisma.InputJsonValue
}

export function formatDecimal(value: Decimal): string {
  return value.toFixed()
}

export function buildGasCalculationLogData(
  request: ExchangeRequestContext,
  processingStep: string,
  destinationAddress: string,
  amount: Decimal,
  fundingPlan: GasFundingPlan,
  gasWallet?: GasWallet | null
): Record<string, unknown> {
  return {
    exchangeRequestId: request.id,
    depositAddressId: request.depositAddressId,
    network: request.fromNetwork.code,
    chain: request.fromNetwork.chain,
    step: processingStep,
    destinationAddress,
    transferAmount: formatDecimal(amount),
    asset: request.fromCoin.code,
    gasFeeMultiplier: formatDecimal(GAS_FEE_MULTIPLIER),
    gasMinReserve: formatDecimal(GAS_MIN_RESERVE),
    depositWallet: {
      address: request.depositAddress?.address,
      balance: formatDecimal(fundingPlan.depositWalletBalance),
      deficit: formatDecimal(fundingPlan.depositWalletDeficit),
      targetBalance: formatDecimal(fundingPlan.depositWalletTargetBalance),
    },
    mainActionGas: {
      isNativeTransfer: fundingPlan.mainAction.isNativeTransfer,
      gasLimit: formatDecimal(fundingPlan.mainAction.gasLimit),
      gasPrice: formatDecimal(fundingPlan.mainAction.gasPrice),
      estimatedFeeWei: formatDecimal(fundingPlan.mainAction.estimatedFeeWei),
      estimatedFeeNative: formatDecimal(fundingPlan.mainAction.estimatedFeeNative),
      bufferedFee: formatDecimal(fundingPlan.mainAction.bufferedFee),
      requiredNative: formatDecimal(fundingPlan.mainAction.requiredNative),
    },
    computedTopUpAmount: formatDecimal(fundingPlan.topUpAmount),
    gasTopUpGas: fundingPlan.gasTopUpTx
      ? {
          gasLimit: formatDecimal(fundingPlan.gasTopUpTx.gasLimit),
          gasPrice: formatDecimal(fundingPlan.gasTopUpTx.gasPrice),
          estimatedFeeWei: formatDecimal(fundingPlan.gasTopUpTx.estimatedFeeWei),
          estimatedFeeNative: formatDecimal(fundingPlan.gasTopUpTx.estimatedFeeNative),
          bufferedFee: formatDecimal(fundingPlan.gasTopUpTx.bufferedFee),
          requiredNative: formatDecimal(fundingPlan.gasTopUpTx.requiredNative),
        }
      : null,
    gasWallet: gasWallet
      ? {
          id: gasWallet.id,
          address: gasWallet.address,
          balance: fundingPlan.gasWalletBalance ? formatDecimal(fundingPlan.gasWalletBalance) : null,
          requiredNative: fundingPlan.gasWalletRequiredNative
            ? formatDecimal(fundingPlan.gasWalletRequiredNative)
            : null,
          shortage: fundingPlan.gasWalletShortage
            ? formatDecimal(fundingPlan.gasWalletShortage)
            : null,
        }
      : null,
  }
}

export async function createSystemLog(
  executor: TransactionExecutor,
  level: string,
  type: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  await executor.systemLog.create({
    data: {
      level,
      type,
      message,
      data: data ? createJsonLogData(data) : undefined,
    },
  })
}

// ─── Status helpers ──────────────────────────────────────────────────

export function isFinalExchangeRequestStatus(status: ExchangeRequestStatus): boolean {
  return FINAL_EXCHANGE_REQUEST_STATUSES.has(status)
}

export function canAcceptDepositInStatus(status: ExchangeRequestStatus): boolean {
  return ACCEPTABLE_DEPOSIT_STATUSES.has(status)
}

export function isInternalKnownTransaction(transaction: Transaction): boolean {
  return KNOWN_INTERNAL_TRANSACTION_TYPES.has(transaction.type)
}

export function advanceExchangeRequestStatus(
  currentStatus: ExchangeRequestStatus,
  nextStatus: ExchangeRequestStatus
): ExchangeRequestStatus {
  return wasmAdvanceStatus(currentStatus, nextStatus) as ExchangeRequestStatus
}

// ─── Amount classification ───────────────────────────────────────────

export function classifyAmount(
  expectedAmount: Decimal,
  receivedAmount: Decimal
): AmountClassification {
  const result = wasmClassifyAmount(expectedAmount, receivedAmount)
  return {
    kind: result.kind,
    acceptedAmount: result.acceptedAmount,
    refundAmount: result.refundAmount,
    nextStatus: result.nextStatus as ExchangeRequestStatus,
  }
}

// ─── Payout helpers ──────────────────────────────────────────────────

export function getRequestedPayoutAmount(request: ExchangeRequestContext): Decimal {
  try {
    return wasmGetRequestedPayoutAmount(request.toAmount, request.feeAmount)
  } catch {
    throw new Error(
      `Exchange request ${request.id} has feeAmount greater than toAmount: fee=${formatDecimal(request.feeAmount)} toAmount=${formatDecimal(request.toAmount)}`,
    )
  }
}

// ─── Deposit eligibility ─────────────────────────────────────────────

export function detectClientDepositEligibility(
  request: ExchangeRequestContext,
  payload: NormalizedTatumWebhookPayload
): { eligible: true } | { eligible: false; reason: string } {
  if (!payload.txId) {
    return { eligible: false, reason: "missing-txid" }
  }

  if (isFinalExchangeRequestStatus(request.status)) {
    return { eligible: false, reason: "final-status" }
  }

  if (!canAcceptDepositInStatus(request.status)) {
    return { eligible: false, reason: `status-not-eligible:${request.status}` }
  }

  const existingAcceptedDeposit = request.transactions.find(
    (transaction) =>
      transaction.type === TransactionType.CLIENT_DEPOSIT &&
      transaction.txHash !== null &&
      transaction.txHash !== payload.txId
  )

  if (existingAcceptedDeposit) {
    return { eligible: false, reason: "deposit-already-recorded" }
  }

  return { eligible: true }
}

// ─── Address helpers ─────────────────────────────────────────────────

export async function findDepositAddress(address: string): Promise<DepositAddressContext | null> {
  return db.depositAddress.findFirst({
    where: {
      address: {
        equals: address,
        mode: "insensitive",
      },
    },
    include: depositAddressInclude,
  })
}

export function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false
  }

  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

// ─── Coin / network mapping helpers ──────────────────────────────────

export async function getCoinNetworkMapping(
  coinId: string,
  networkId: string
): Promise<CoinNetworkMapping | null> {
  return db.coinNetworkMapping.findUnique({
    where: {
      coinId_networkId: {
        coinId,
        networkId,
      },
    },
  })
}

export async function getNetworkNativeCoinId(network: Network): Promise<string | null> {
  const nativeCoinCode = getNativeCoinCode(network)
  const coin = await db.coin.findFirst({
    where: {
      code: {
        equals: nativeCoinCode,
        mode: "insensitive",
      },
    },
  })

  return coin?.id ?? null
}

export function isNativeAsset(request: ExchangeRequestContext, mapping: CoinNetworkMapping | null): boolean {
  if (mapping?.contractAddress) {
    return false
  }

  return request.fromCoin.code.toUpperCase() === getNativeCoinCode(request.fromNetwork)
}

export function getTatumTokenChainCode(
  network: Network,
  mapping: CoinNetworkMapping
): string {
  return (mapping.tatumChainCode?.trim() || mapPrismaNetworkChainToTatum(network.chain)).toUpperCase()
}

export function resolveOutgoingTransferSpec(
  request: ExchangeRequestContext,
  mapping: CoinNetworkMapping | null
): OutgoingTransferSpec {
  if (isNativeAsset(request, mapping)) {
    return {
      kind: "native",
      chain: getChainSlug(request.fromNetwork),
      currency: getTatumNativeCurrencyCode(request.fromNetwork),
    }
  }

  if (!mapping) {
    throw new Error(
      `Missing CoinNetworkMapping for token asset ${request.fromCoin.code} on ${request.fromNetwork.code}`
    )
  }

  const contractAddress = mapping.contractAddress?.trim()
  if (!contractAddress) {
    throw new Error(
      `Missing CoinNetworkMapping.contractAddress for token asset ${request.fromCoin.code} on ${request.fromNetwork.code}`
    )
  }

  return {
    kind: "token",
    // Non-native assets must go through Tatum's token endpoint, which expects
    // a chain code in the JSON body plus the token contract from CoinNetworkMapping.
    chain: getTatumTokenChainCode(request.fromNetwork, mapping),
    contractAddress,
    digits: mapping.decimals,
  }
}

// ─── Side-effect intent (shared utility) ─────────────────────────────

export async function ensureSideEffectIntent(
  request: ExchangeRequestContext,
  type: TransactionType,
  idempotencyKey: string,
  amount: Decimal,
  toAddress: string,
  outgoingCoinId: string
): Promise<SideEffectIntentResult> {
  const existing = await db.transaction.findUnique({
    where: {
      type_idempotencyKey: {
        type,
        idempotencyKey,
      },
    },
  })

  if (existing) {
    return {
      transaction: existing,
      created: false,
    }
  }

  try {
    const transaction = await db.transaction.create({
      data: {
        exchangeRequestId: request.id,
        depositAddressId: request.depositAddressId,
        type,
        status: TransactionStatus.CREATED,
        direction: "OUT",
        fromAddress: request.depositAddress!.address,
        toAddress,
        amount,
        outgoingCoinId,
        networkId: request.fromNetworkId,
        idempotencyKey,
      },
    })

    return {
      transaction,
      created: true,
    }
  } catch (error) {
    if (isPrismaKnownError(error) && error.code === "P2002") {
      const transaction = await db.transaction.findUniqueOrThrow({
        where: {
          type_idempotencyKey: {
            type,
            idempotencyKey,
          },
        },
      })

      return {
        transaction,
        created: false,
      }
    }

    throw error
  }
}

// ─── Gas wallet lookup ───────────────────────────────────────────────

export async function getGasWalletForNetwork(networkId: string) {
  const primaryWallet = await db.gasWallet.findFirst({
    where: {
      networkId,
      status: "ACTIVE",
      isPrimary: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  })

  if (primaryWallet) {
    return primaryWallet
  }

  return db.gasWallet.findFirst({
    where: {
      networkId,
      status: "ACTIVE",
    },
    orderBy: {
      createdAt: "asc",
    },
  })
}

// ─── Wallet key derivation ───────────────────────────────────────────

export async function deriveWalletPrivateKey(
  network: Network,
  encryptedMnemonic: string,
  index: number
): Promise<string> {
  const mnemonic = decryptMnemonic(encryptedMnemonic)
  return kmsDerivePk(
    { mnemonic, index, chain: getChainSlug(network) },
  )
}
