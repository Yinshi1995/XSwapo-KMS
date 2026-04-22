import { Decimal } from "@prisma/client/runtime/client"

import db, {
  ExchangeRequestStatus,
  TransactionStatus,
  TransactionType,
} from "../db/index"
import { getExchangeProvider } from "./exchange"
import { emitNotification } from "./notifications/emit"
import { sweepToExchange, type SweepResult } from "./kms-local"
import {
  advanceExchangeRequestStatus,
  createSystemLog,
  deriveWalletPrivateKey,
  ensureSideEffectIntent,
  getCoinNetworkMapping,
  getGasWalletForNetwork,
  getNativeCoinCode,
  isNativeAsset,
  resolveOutgoingTransferSpec,
} from "./helpers"
import {
  type AmountClassification,
  type ExchangeRequestContext,
  type SideEffectDispatchResult,
  type TransferDestination,
} from "./types"
import type { NormalizedTatumWebhookPayload } from "./normalize"

// ─── Exchange destination resolution ─────────────────────────────────

async function resolveTransferToExchangeDestination(
  request: ExchangeRequestContext
): Promise<TransferDestination> {
  const provider = getExchangeProvider()
  const mapping = await getCoinNetworkMapping(request.fromCoinId, request.fromNetworkId)
  const networkCode = request.fromNetwork.chain.toUpperCase()

  if (!networkCode) {
    throw new Error(
      `Missing exchange network mapping for ${request.fromCoin.code} on ${request.fromNetwork.code}`
    )
  }

  const coinCode = isNativeAsset(request, mapping)
    ? getNativeCoinCode(request.fromNetwork)
    : request.fromCoin.code

  const kucoinChain = request.fromNetwork.kucoinChainCode ?? request.fromNetwork.code
  const destination = await provider.getDepositAddress(coinCode, kucoinChain)

  if (destination.tag || destination.memo) {
    throw new Error(
      `Exchange deposit with tag/memo is not yet supported for ${coinCode} on ${networkCode} (provider: ${provider.name})`
    )
  }

  return {
    address: destination.address,
    networkCode,
  }
}

// ─── KMS sweep helper ────────────────────────────────────────────────

async function performSweep(
  request: ExchangeRequestContext,
  destinationAddress: string,
  amount: Decimal,
  requestId?: string,
): Promise<SweepResult> {
  const mapping = await getCoinNetworkMapping(request.fromCoinId, request.fromNetworkId)
  const transferSpec = resolveOutgoingTransferSpec(request, mapping)

  const depositPrivateKey = await deriveWalletPrivateKey(
    request.fromNetwork,
    request.depositAddress!.masterWallet.surprise!,
    request.depositAddress!.index,
  )

  const gasWallet = await getGasWalletForNetwork(request.fromNetworkId)
  if (!gasWallet?.surprise) {
    throw new Error(`Active gas wallet is missing for network ${request.fromNetwork.code}`)
  }

  const gasPrivateKey = await deriveWalletPrivateKey(
    request.fromNetwork,
    gasWallet.surprise,
    0,
  )

  return sweepToExchange(
    {
      destinationAddress,
      chain: request.fromNetwork.chain,
      amount: amount.toString(),
      contractAddress: transferSpec.kind === "token" ? transferSpec.contractAddress : undefined,
      decimals: transferSpec.kind === "token" ? transferSpec.digits : undefined,
      depositPrivateKey,
      depositAddress: request.depositAddress!.address,
      gasPrivateKey,
      gasAddress: gasWallet.address,
      gasFeeMultiplier: 2.0,
    },
    requestId,
  )
}

// ─── Handle SweepResult for a GAS_TOPUP ─────────────────────────────

async function handleGasTopUpResult(
  request: ExchangeRequestContext,
  sweepResult: Extract<SweepResult, { status: "GAS_TOPUP_SENT" }>,
  processingStep: string,
): Promise<void> {
  const idempotencyKey = `${request.id}:gas-topup:${processingStep}:kms`
  const nativeCoinId = request.fromCoinId

  const intent = await ensureSideEffectIntent(
    request,
    TransactionType.GAS_TOPUP,
    idempotencyKey,
    new Decimal(sweepResult.gasAmount),
    request.depositAddress!.address,
    nativeCoinId,
  )

  if (!intent.transaction.txHash) {
    await db.transaction.update({
      where: { id: intent.transaction.id },
      data: {
        txHash: sweepResult.gasTopupTxId,
        externalId: sweepResult.gasTopupTxId,
        status: TransactionStatus.BROADCASTED,
        processedAt: new Date(),
      },
    })
  }

  await createSystemLog(
    db,
    "warn",
    "GAS_TOPUP_INITIATED",
    `KMS initiated gas top-up before sweep: ${sweepResult.message}`,
    {
      exchangeRequestId: request.id,
      gasTopupTxId: sweepResult.gasTopupTxId,
      gasAmount: sweepResult.gasAmount,
      step: processingStep,
    },
  )

  await emitNotification("gas.topup.initiated", {
    correlationId: `gas:${request.id}`,
    summary: `Gas top-up of ${sweepResult.gasAmount} initiated on ${request.fromNetwork.code} by KMS`,
    payload: {
      exchangeRequestId: request.id,
      amount: sweepResult.gasAmount,
      network: request.fromNetwork.code,
      chain: request.fromNetwork.chain,
      txHash: sweepResult.gasTopupTxId,
      depositAddress: request.depositAddress?.address,
      depositAddressId: request.depositAddress?.id,
      step: processingStep,
      source: "KMS",
    },
  })
}

// ─── Handle SweepResult ERROR ────────────────────────────────────────

function handleSweepError(
  sweepResult: Extract<SweepResult, { status: "ERROR" }>,
  context: string,
): never {
  throw new Error(
    `KMS sweep error (${context}): [${sweepResult.code}] ${sweepResult.message}`,
  )
}

// ─── Refund ──────────────────────────────────────────────────────────

export async function initiateRefundIfNeeded(
  request: ExchangeRequestContext,
  classification: AmountClassification,
  payload: NormalizedTatumWebhookPayload,
): Promise<SideEffectDispatchResult> {
  if (classification.kind === "exact") {
    return { triggered: false, blockedByGasTopUp: false }
  }

  if (!payload.counterAddress) {
    throw new Error(`Refund destination is missing for exchange request ${request.id}`)
  }

  const idempotencyKey = `${request.id}:refund:${payload.txId}`
  const refundIntent = await ensureSideEffectIntent(
    request,
    TransactionType.CLIENT_REFUND,
    idempotencyKey,
    classification.refundAmount,
    payload.counterAddress,
    request.fromCoinId,
  )

  if (refundIntent.transaction.txHash) {
    return { triggered: false, blockedByGasTopUp: false }
  }

  const sweepResult = await performSweep(
    request,
    payload.counterAddress,
    classification.refundAmount,
    `refund:${request.id}`,
  )

  if (sweepResult.status === "GAS_TOPUP_SENT") {
    await handleGasTopUpResult(request, sweepResult, `refund:${payload.txId}`)
    return { triggered: false, blockedByGasTopUp: true }
  }

  if (sweepResult.status === "ERROR") {
    handleSweepError(sweepResult, `refund:${request.id}`)
  }

  // SWEEP_SENT
  const nextStatus = ExchangeRequestStatus.REFUND_PENDING

  await db.$transaction(async (transactionExecutor) => {
    await transactionExecutor.transaction.update({
      where: { id: refundIntent.transaction.id },
      data: {
        txHash: sweepResult.txId,
        externalId: sweepResult.txId,
        status: TransactionStatus.BROADCASTED,
        processedAt: new Date(),
      },
    })

    await transactionExecutor.exchangeRequest.update({
      where: { id: request.id },
      data: {
        status: advanceExchangeRequestStatus(request.status, nextStatus),
      },
    })

    await createSystemLog(
      transactionExecutor,
      "info",
      "CLIENT_REFUND_INITIATED",
      "Refund initiated via KMS sweep from deposit wallet",
      {
        exchangeRequestId: request.id,
        transactionId: refundIntent.transaction.id,
        txHash: sweepResult.txId,
        amount: classification.refundAmount.toString(),
      },
    )
  })

  await emitNotification(
    classification.kind === "underpaid" ? "refund.initiated" : "refund.initiated",
    {
      correlationId: `refund:${request.id}`,
      sourceEventId: sweepResult.txId,
      summary: `Refund of ${classification.refundAmount} ${request.fromCoin.code} initiated to ${payload.counterAddress}`,
      payload: {
        exchangeRequestId: request.id,
        amount: classification.refundAmount.toString(),
        currency: request.fromCoin.code,
        coin: request.fromCoin.code,
        network: request.fromNetwork.code,
        chain: request.fromNetwork.chain,
        toAddress: payload.counterAddress,
        txHash: sweepResult.txId,
        classification: classification.kind,
        depositAddress: request.depositAddress?.address,
        depositAddressId: request.depositAddress?.id,
        status: "BROADCASTED",
        source: "KMS",
      },
    },
  )

  return { triggered: true, blockedByGasTopUp: false }
}

// ─── Transfer to Exchange ────────────────────────────────────────────

export async function initiateTransferToExchangeIfNeeded(
  request: ExchangeRequestContext,
  classification: AmountClassification,
  payload: NormalizedTatumWebhookPayload,
): Promise<SideEffectDispatchResult> {
  const tag = `[transfer:${request.id}]`

  if (classification.kind === "underpaid") {
    console.info(`${tag} skipped: underpaid`)
    return { triggered: false, blockedByGasTopUp: false }
  }

  console.info(`${tag} resolving exchange destination...`)
  const transferDestination = await resolveTransferToExchangeDestination(request)
  console.info(`${tag} destination=${transferDestination.address}`)

  const idempotencyKey = `${request.id}:transfer:${payload.txId}`
  const transferIntent = await ensureSideEffectIntent(
    request,
    TransactionType.TRANSFER_TO_BINANCE,
    idempotencyKey,
    classification.acceptedAmount,
    transferDestination.address,
    request.fromCoinId,
  )

  if (transferIntent.transaction.txHash) {
    return { triggered: false, blockedByGasTopUp: false }
  }

  console.info(`${tag} calling KMS sweep...`)

  const sweepResult = await performSweep(
    request,
    transferDestination.address,
    classification.acceptedAmount,
    `transfer:${request.id}`,
  )

  if (sweepResult.status === "GAS_TOPUP_SENT") {
    console.warn(`${tag} KMS returned GAS_TOPUP_SENT, waiting for confirmation`)
    await handleGasTopUpResult(request, sweepResult, `transfer:${payload.txId}`)
    return { triggered: false, blockedByGasTopUp: true }
  }

  if (sweepResult.status === "ERROR") {
    handleSweepError(sweepResult, `transfer:${request.id}`)
  }

  // SWEEP_SENT
  console.info(
    `${tag} sweep sent, txId=${sweepResult.txId} actualAmount=${sweepResult.amount}` +
    (sweepResult.gasCostNative ? ` gasCostNative=${sweepResult.gasCostNative}` : ""),
  )

  await db.$transaction(async (transactionExecutor) => {
    await transactionExecutor.transaction.update({
      where: { id: transferIntent.transaction.id },
      data: {
        // For native coins: KMS deducts gas from the transfer amount, so
        // sweepResult.amount is already the net value KuCoin will credit.
        // For tokens: sweepResult.amount equals the full token amount (gas is
        // separate, paid from the gas wallet — stored in gasCostNative below).
        amount: new Decimal(sweepResult.amount),
        txHash: sweepResult.txId,
        externalId: sweepResult.txId,
        status: TransactionStatus.BROADCASTED,
        processedAt: new Date(),
        // Token sweeps: persist the gas cost (native coin) so the settlement
        // step can deduct it from the exchange amount and keep it as reimbursement.
        ...(sweepResult.gasCostNative !== undefined && {
          rawPayload: { gasCostNative: sweepResult.gasCostNative },
        }),
      },
    })

    await transactionExecutor.exchangeRequest.update({
      where: { id: request.id },
      data: {
        status: advanceExchangeRequestStatus(request.status, ExchangeRequestStatus.PROCESSING),
      },
    })

    await createSystemLog(
      transactionExecutor,
      "info",
      "TRANSFER_TO_EXCHANGE_INITIATED",
      `Accepted deposit amount swept to exchange via KMS (provider: ${getExchangeProvider().name})`,
      {
        exchangeRequestId: request.id,
        transactionId: transferIntent.transaction.id,
        txHash: sweepResult.txId,
        amount: classification.acceptedAmount.toString(),
        destination: transferDestination.address,
        networkCode: transferDestination.networkCode,
      },
    )
  })

  await emitNotification("transfer.to_exchange", {
    correlationId: `transfer:${request.id}`,
    sourceEventId: sweepResult.txId,
    summary: `Transfer of ${classification.acceptedAmount} ${request.fromCoin.code} sent to ${getExchangeProvider().name} via KMS`,
    payload: {
      exchangeRequestId: request.id,
      amount: classification.acceptedAmount.toString(),
      currency: request.fromCoin.code,
      coin: request.fromCoin.code,
      network: request.fromNetwork.code,
      chain: request.fromNetwork.chain,
      toAddress: transferDestination.address,
      txHash: sweepResult.txId,
      depositAddress: request.depositAddress?.address,
      depositAddressId: request.depositAddress?.id,
      provider: getExchangeProvider().name,
      status: "BROADCASTED",
      source: "KMS",
    },
  })

  return { triggered: true, blockedByGasTopUp: false }
}
