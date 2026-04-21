import db, {
  ExchangeRequestStatus,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "../db/index"
import { emitNotification } from "./notifications/emit"
import {
  decimalAdd,
  decimalEq,
  toDecimal,
} from "../lib/decimal"
import {
  FINAL_EXCHANGE_REQUEST_STATUSES,
  ZERO_DECIMAL,
} from "./constants"
import { normalizeWebhookPayload, type NormalizedTatumWebhookPayload } from "./normalize"
import {
  exchangeRequestInclude,
  type ClientDepositStageResult,
  type DepositAddressContext,
  type ExchangeRequestContext,
  type ResolvedDepositAddress,
  type TransactionContext,
  type TransactionExecutor,
  type WebhookProcessResult,
} from "./types"
import {
  advanceExchangeRequestStatus,
  canAcceptDepositInStatus,
  classifyAmount,
  createSystemLog,
  detectClientDepositEligibility,
  findDepositAddress,
  isInternalKnownTransaction,
  isFinalExchangeRequestStatus,
  isPrismaKnownError,
  sameAddress,
} from "./helpers"
import {
  getExchangeRequestContextById,
  maybeStartExchangeSettlementForConfirmedTransfer,
} from "./settlement"
import {
  initiateRefundIfNeeded,
  initiateTransferToExchangeIfNeeded,
} from "./transfer"

function canonicalizeWebhookPayloadForDepositAddress(
  payload: NormalizedTatumWebhookPayload,
  depositAddress: DepositAddressContext,
  matchedField: ResolvedDepositAddress["matchedField"]
): NormalizedTatumWebhookPayload {
  if (matchedField === "address" || sameAddress(payload.address, depositAddress.address)) {
    return payload
  }

  if (!sameAddress(payload.counterAddress, depositAddress.address)) {
    return payload
  }

  return {
    ...payload,
    address: depositAddress.address,
    counterAddress: payload.address,
  }
}

function isExplicitlyAllowedDepositDirection(
  payload: NormalizedTatumWebhookPayload,
  matchedField: ResolvedDepositAddress["matchedField"]
): boolean {
  if (matchedField !== "counterAddress") {
    return true
  }

  const chain = payload.chain?.trim().toLowerCase()
  const transferType = payload.type?.trim().toLowerCase()
  const currency = payload.currency?.trim().toUpperCase()
  const subscriptionType = payload.subscriptionType?.trim().toUpperCase()
  const hasTokenContract = Boolean(payload.contractAddress || payload.asset)

  return (
    chain === "bsc-mainnet"
    && transferType === "token"
    && currency === "BSC"
    && subscriptionType === "ADDRESS_EVENT"
    && hasTokenContract
  )
}

async function resolveDepositAddressFromWebhook(
  payload: NormalizedTatumWebhookPayload
): Promise<ResolvedDepositAddress | null> {
  if (payload.address) {
    const depositAddress = await findDepositAddress(payload.address)
    if (depositAddress) {
      return {
        depositAddress,
        matchedField: "address",
      }
    }
  }

  if (payload.counterAddress && payload.counterAddress !== payload.address) {
    const depositAddress = await findDepositAddress(payload.counterAddress)
    if (depositAddress) {
      return {
        depositAddress,
        matchedField: "counterAddress",
      }
    }
  }

  return null
}

async function findActiveExchangeRequestForDepositAddress(
  depositAddressId: string
): Promise<
  | { kind: "ok"; request: ExchangeRequestContext }
  | { kind: "missing" }
  | { kind: "ambiguous"; count: number }
> {
  const requests = await db.exchangeRequest.findMany({
    where: {
      depositAddressId,
      status: {
        notIn: Array.from(FINAL_EXCHANGE_REQUEST_STATUSES),
      },
    },
    include: exchangeRequestInclude,
    orderBy: {
      createdAt: "desc",
    },
  })

  if (requests.length === 0) {
    return { kind: "missing" }
  }

  if (requests.length > 1) {
    return { kind: "ambiguous", count: requests.length }
  }

  return { kind: "ok", request: requests[0] }
}

async function findExistingTransactionByTxHash(
  txHash: string
): Promise<TransactionContext | null> {
  return db.transaction.findUnique({
    where: { txHash },
  })
}

export async function updateRequestFromConfirmedInternalTransaction(
  executor: TransactionExecutor,
  transaction: TransactionContext
): Promise<void> {
  if (!transaction.exchangeRequestId) {
    return
  }

  if (!isInternalKnownTransaction(transaction)) {
    return
  }

  const request = await executor.exchangeRequest.findUnique({
    where: { id: transaction.exchangeRequestId },
  })

  if (!request || isFinalExchangeRequestStatus(request.status)) {
    return
  }

  if (transaction.type === TransactionType.GAS_TOPUP) {
    return
  }

  if (transaction.type === TransactionType.TRANSFER_TO_BINANCE) {
    await executor.exchangeRequest.update({
      where: { id: request.id },
      data: {
        status: advanceExchangeRequestStatus(request.status, ExchangeRequestStatus.PROCESSING),
      },
    })
    return
  }

  if (transaction.type !== TransactionType.CLIENT_REFUND) {
    return
  }

  const currentRefundedAmount = request.refundedAmount ?? ZERO_DECIMAL
  const nextRefundedAmount = decimalAdd(currentRefundedAmount, transaction.amount)
  const isFullRefund = decimalEq(transaction.amount, request.receivedAmount ?? ZERO_DECIMAL)

  await executor.exchangeRequest.update({
    where: { id: request.id },
    data: {
      refundedAmount: nextRefundedAmount,
      isRefunded: isFullRefund,
      isPartialRefund: !isFullRefund,
      status: advanceExchangeRequestStatus(
        request.status,
        isFullRefund ? ExchangeRequestStatus.REFUNDED : ExchangeRequestStatus.PARTIALLY_REFUNDED
      ),
    },
  })
}

async function mergeExistingTransaction(
  existingTransaction: TransactionContext,
  payload: NormalizedTatumWebhookPayload
): Promise<TransactionContext> {
  const mergedTransaction = await db.$transaction(async (transactionExecutor) => {
    const data: Prisma.TransactionUpdateInput = {}
    let shouldUpdate = false

    if (existingTransaction.blockNumber === null && payload.blockNumber !== null) {
      data.blockNumber = payload.blockNumber
      shouldUpdate = true
    }

    if (existingTransaction.senderAddress === null && payload.counterAddress) {
      data.senderAddress = payload.counterAddress
      shouldUpdate = true
    }

    if (existingTransaction.fromAddress === null && payload.counterAddress) {
      data.fromAddress = payload.counterAddress
      shouldUpdate = true
    }

    if (existingTransaction.toAddress === null && payload.address) {
      data.toAddress = payload.address
      shouldUpdate = true
    }

    if (existingTransaction.rawPayload === null) {
      data.rawPayload = payload.rawPayload
      shouldUpdate = true
    }

    if (existingTransaction.status !== TransactionStatus.CONFIRMED) {
      data.status = TransactionStatus.CONFIRMED
      data.confirmedAt = new Date()
      shouldUpdate = true
    }

    const mergedTransaction = shouldUpdate
      ? await transactionExecutor.transaction.update({
          where: { id: existingTransaction.id },
          data,
        })
      : existingTransaction

    if (shouldUpdate && mergedTransaction.status === TransactionStatus.CONFIRMED) {
      await updateRequestFromConfirmedInternalTransaction(transactionExecutor, mergedTransaction)
    }

    await createSystemLog(
      transactionExecutor,
      "info",
      "TATUM_WEBHOOK_DUPLICATE",
      "Duplicate or retry webhook merged into existing transaction",
      {
        transactionId: mergedTransaction.id,
        txHash: mergedTransaction.txHash,
        type: mergedTransaction.type,
      }
    )

    return mergedTransaction
  })

  await maybeStartExchangeSettlementForConfirmedTransfer(mergedTransaction)
  await maybeResumePipelineAfterGasTopUp(mergedTransaction)

  console.info(`[merge:${mergedTransaction.id}] done: type="${mergedTransaction.type}" status="${mergedTransaction.status}" ER=${mergedTransaction.exchangeRequestId ?? 'null'}`)

  return mergedTransaction
}

async function createClientDepositAtomically(
  requestId: string,
  payload: NormalizedTatumWebhookPayload
): Promise<ClientDepositStageResult> {
  try {
    return await db.$transaction(async (transactionExecutor) => {
      const request = await transactionExecutor.exchangeRequest.findUnique({
        where: { id: requestId },
        include: exchangeRequestInclude,
      })

      if (!request || !request.depositAddress) {
        return { kind: "ignored", reason: "request-or-deposit-address-missing" }
      }

      const duplicatedTransaction = payload.txId
        ? await transactionExecutor.transaction.findUnique({ where: { txHash: payload.txId } })
        : null

      if (duplicatedTransaction) {
        return { kind: "duplicate", transaction: duplicatedTransaction }
      }

      const eligibility = detectClientDepositEligibility(request, payload)
      if (!eligibility.eligible) {
        await createSystemLog(
          transactionExecutor,
          "info",
          "TATUM_WEBHOOK_IGNORED",
          "Webhook did not qualify as a client deposit",
          {
            exchangeRequestId: request.id,
            reason: eligibility.reason,
            txId: payload.txId,
          }
        )
        return { kind: "ignored", reason: eligibility.reason }
      }

      const receivedAmount = toDecimal(payload.amount!)
      const classification = classifyAmount(request.fromAmount, receivedAmount)
      const nextStatus = advanceExchangeRequestStatus(request.status, classification.nextStatus)

      const createdTransaction = await transactionExecutor.transaction.create({
        data: {
          exchangeRequestId: request.id,
          depositAddressId: request.depositAddress.id,
          type: TransactionType.CLIENT_DEPOSIT,
          status: TransactionStatus.DETECTED,
          direction: "IN",
          senderAddress: payload.counterAddress,
          fromAddress: payload.counterAddress,
          toAddress: payload.address,
          amount: receivedAmount,
          confirmedAmount: receivedAmount,
          incomingCoinId: request.fromCoinId,
          networkId: request.fromNetworkId,
          txHash: payload.txId,
          blockNumber: payload.blockNumber,
          detectedAt: new Date(),
          rawPayload: payload.rawPayload,
        },
      })

      const updatedRequest = await transactionExecutor.exchangeRequest.update({
        where: { id: request.id },
        data: {
          receivedAmount: receivedAmount,
          acceptedAmount: classification.acceptedAmount,
          refundReason:
            classification.kind === "underpaid"
              ? "Received amount is lower than expected deposit amount"
              : classification.kind === "overpaid"
                ? "Received amount is higher than expected deposit amount"
                : null,
          status: nextStatus,
        },
        include: exchangeRequestInclude,
      })

      await createSystemLog(
        transactionExecutor,
        "info",
        "CLIENT_DEPOSIT_RECORDED",
        "Client deposit recorded atomically from Tatum webhook",
        {
          exchangeRequestId: request.id,
          transactionId: createdTransaction.id,
          txId: payload.txId,
          amount: payload.amount,
          classification: classification.kind,
        }
      )

      return {
        kind: "created",
        request: updatedRequest,
        transaction: createdTransaction,
        classification,
      }
    })
  } catch (error) {
    if (isPrismaKnownError(error) && error.code === "P2002" && payload.txId) {
      const existingTransaction = await findExistingTransactionByTxHash(payload.txId)
      if (existingTransaction) {
        return {
          kind: "duplicate",
          transaction: existingTransaction,
        }
      }
    }

    throw error
  }
}

async function getLatestClientDepositTransaction(
  requestId: string
): Promise<TransactionContext | null> {
  return db.transaction.findFirst({
    where: {
      exchangeRequestId: requestId,
      type: TransactionType.CLIENT_DEPOSIT,
    },
    orderBy: {
      createdAt: "desc",
    },
  })
}

async function resumePostDepositSideEffects(
  request: ExchangeRequestContext,
  payload: NormalizedTatumWebhookPayload
): Promise<void> {
  const tag = `[pipeline:${request.id}]`

  if (!request.receivedAmount) {
    console.warn(`${tag} resumePostDepositSideEffects: skipped, no receivedAmount`)
    return
  }

  if (isFinalExchangeRequestStatus(request.status)) {
    console.warn(`${tag} resumePostDepositSideEffects: skipped, final status "${request.status}"`)
    return
  }

  const classification = classifyAmount(request.fromAmount, request.receivedAmount)
  console.info(`${tag} resumePostDepositSideEffects: classification=${classification.kind}, accepted=${classification.acceptedAmount}, refund=${classification.refundAmount}, status="${request.status}"`)

  const refundResult = await initiateRefundIfNeeded(request, classification, payload)
  console.info(`${tag} refundResult: triggered=${refundResult.triggered}, blockedByGasTopUp=${refundResult.blockedByGasTopUp}`)

  if (refundResult.blockedByGasTopUp) {
    console.warn(`${tag} resumePostDepositSideEffects: halted, refund blocked by gas top-up`)
    return
  }

  if (classification.kind === "underpaid") {
    console.info(`${tag} resumePostDepositSideEffects: halted, underpaid — refund only`)
    return
  }

  console.info(`${tag} resumePostDepositSideEffects: initiating transfer to exchange...`)
  const transferResult = await initiateTransferToExchangeIfNeeded(request, classification, payload)
  console.info(`${tag} transferResult: triggered=${transferResult.triggered}, blockedByGasTopUp=${transferResult.blockedByGasTopUp}`)
}

async function maybeResumeClientDepositPipeline(
  transaction: TransactionContext,
  payload?: NormalizedTatumWebhookPayload
): Promise<void> {
  const tag = `[resume-deposit:${transaction.id}]`

  if (transaction.type !== TransactionType.CLIENT_DEPOSIT || !transaction.exchangeRequestId) {
    console.info(`${tag} skipped: type="${transaction.type}", ER=${transaction.exchangeRequestId ?? 'null'}`)
    return
  }

  console.info(`${tag} resuming deposit pipeline for ER ${transaction.exchangeRequestId}`)

  const request = await getExchangeRequestContextById(transaction.exchangeRequestId)
  if (!request) {
    console.warn(`${tag} skipped: exchange request not found`)
    return
  }

  const normalizedPayload = payload ?? normalizeWebhookPayload(transaction.rawPayload)
  const canonicalPayload = request.depositAddress
    ? canonicalizeWebhookPayloadForDepositAddress(
        normalizedPayload,
        request.depositAddress,
        sameAddress(normalizedPayload.counterAddress, request.depositAddress.address)
          ? "counterAddress"
          : "address"
      )
    : normalizedPayload

  if (!canonicalPayload.address || !canonicalPayload.amount || !canonicalPayload.txId) {
    console.warn(`${tag} skipped: incomplete canonical payload (address=${!!canonicalPayload.address}, amount=${!!canonicalPayload.amount}, txId=${!!canonicalPayload.txId})`)
    return
  }

  console.info(`${tag} calling resumePostDepositSideEffects, request status="${request.status}"`)
  await resumePostDepositSideEffects(request, canonicalPayload)
}

export async function maybeResumePipelineAfterGasTopUp(
  transaction: TransactionContext
): Promise<void> {
  const tag = `[gas-resume:${transaction.id}]`

  if (
    transaction.type !== TransactionType.GAS_TOPUP
    || transaction.status !== TransactionStatus.CONFIRMED
    || !transaction.exchangeRequestId
  ) {
    console.info(`${tag} skipped: type="${transaction.type}" status="${transaction.status}" ER=${transaction.exchangeRequestId ?? 'null'}`)
    return
  }

  console.info(`${tag} gas top-up confirmed for ER ${transaction.exchangeRequestId}, looking for client deposit...`)

  const latestClientDeposit = await getLatestClientDepositTransaction(transaction.exchangeRequestId)
  if (!latestClientDeposit) {
    console.warn(`${tag} no client deposit found for ER ${transaction.exchangeRequestId}`)
    return
  }

  console.info(`${tag} found client deposit ${latestClientDeposit.id}, resuming pipeline`)
  await maybeResumeClientDepositPipeline(latestClientDeposit)
}

export async function processTatumAddressEventWebhook(
  payload: NormalizedTatumWebhookPayload,
  requestId = "tatum-process"
): Promise<WebhookProcessResult> {
  const existingTransaction = payload.txId
    ? await findExistingTransactionByTxHash(payload.txId)
    : null

  if (existingTransaction) {
    const merged = await mergeExistingTransaction(existingTransaction, payload)
    await maybeResumeClientDepositPipeline(merged, payload)

    await emitNotification("webhook.duplicate", {
      correlationId: requestId,
      sourceEventId: payload.txId ?? undefined,
      summary: `Duplicate webhook merged into transaction ${merged.id}`,
      payload: {
        transactionId: merged.id,
        txHash: payload.txId,
        type: merged.type,
        source: "Tatum",
      },
    })

    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        transactionId: merged.id,
        type: merged.type,
      },
    }
  }

  const resolvedDepositAddress = await resolveDepositAddressFromWebhook(payload)
  if (!resolvedDepositAddress) {
    await createSystemLog(db, "info", "UNKNOWN_DEPOSIT_ADDRESS", "Webhook address not found", {
      address: payload.address,
      counterAddress: payload.counterAddress,
      txId: payload.txId,
    })

    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: "unknown-address",
      },
    }
  }

  const depositAddress = resolvedDepositAddress.depositAddress

  if (!isExplicitlyAllowedDepositDirection(payload, resolvedDepositAddress.matchedField)) {
    await createSystemLog(
      db,
      "info",
      "NON_DEPOSIT_DIRECTION_WEBHOOK_IGNORED",
      "Webhook matched a known deposit address through a direction that is not allowlisted",
      {
        address: payload.address,
        counterAddress: payload.counterAddress,
        chain: payload.chain,
        transferType: payload.type,
        currency: payload.currency,
        contractAddress: payload.contractAddress,
        subscriptionType: payload.subscriptionType,
        matchedField: resolvedDepositAddress.matchedField,
        depositAddressId: depositAddress.id,
        txId: payload.txId,
      }
    )

    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: "non-deposit-direction",
      },
    }
  }

  const canonicalPayload = canonicalizeWebhookPayloadForDepositAddress(
    payload,
    depositAddress,
    resolvedDepositAddress.matchedField
  )

  if (resolvedDepositAddress.matchedField === "counterAddress") {
    await createSystemLog(
      db,
      "info",
      "DEPOSIT_ADDRESS_RESOLVED_FROM_COUNTERPARTY",
      "Webhook deposit address was resolved from counterAddress and canonicalized for processing",
      {
        originalAddress: payload.address,
        originalCounterAddress: payload.counterAddress,
        canonicalAddress: canonicalPayload.address,
        canonicalCounterAddress: canonicalPayload.counterAddress,
        depositAddressId: depositAddress.id,
        txId: payload.txId,
      }
    )
  }

  const requestLookup = await findActiveExchangeRequestForDepositAddress(depositAddress.id)
  if (requestLookup.kind === "missing") {
    await createSystemLog(
      db,
      "warn",
      "MISSING_ACTIVE_EXCHANGE_REQUEST",
      "Deposit address is not linked to an active exchange request",
      {
        depositAddressId: depositAddress.id,
        address: depositAddress.address,
        txId: payload.txId,
      }
    )

    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: "missing-active-request",
      },
    }
  }

  if (requestLookup.kind === "ambiguous") {
    await createSystemLog(
      db,
      "error",
      "AMBIGUOUS_ACTIVE_EXCHANGE_REQUEST",
      "Deposit address is linked to multiple active exchange requests",
      {
        depositAddressId: depositAddress.id,
        address: depositAddress.address,
        txId: payload.txId,
        count: requestLookup.count,
      }
    )

    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: "ambiguous-active-request",
      },
    }
  }

  const stagedDeposit = await createClientDepositAtomically(requestLookup.request.id, canonicalPayload)
  if (stagedDeposit.kind === "duplicate" && stagedDeposit.transaction) {
    const merged = await mergeExistingTransaction(stagedDeposit.transaction, canonicalPayload)
    await maybeResumeClientDepositPipeline(merged, canonicalPayload)
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        transactionId: merged.id,
        type: merged.type,
      },
    }
  }

  if (stagedDeposit.kind === "ignored") {
    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: stagedDeposit.reason,
      },
    }
  }

  const request = stagedDeposit.request!
  const classification = stagedDeposit.classification!

  // ── Emit deposit notification based on classification ──
  const depositEventType = classification.kind === "underpaid"
    ? "deposit.underpaid" as const
    : classification.kind === "overpaid"
      ? "deposit.overpaid" as const
      : "deposit.confirmed" as const

  await emitNotification(depositEventType, {
    correlationId: requestId,
    sourceEventId: canonicalPayload.txId ?? undefined,
    summary: classification.kind === "exact"
      ? `Deposit of ${canonicalPayload.amount} ${request.fromCoin.code} confirmed on ${request.fromNetwork.code}`
      : classification.kind === "underpaid"
        ? `Underpaid deposit: received ${canonicalPayload.amount} ${request.fromCoin.code}, expected ${request.fromAmount}`
        : `Overpaid deposit: received ${canonicalPayload.amount} ${request.fromCoin.code}, expected ${request.fromAmount}`,
    payload: {
      exchangeRequestId: request.id,
      amount: canonicalPayload.amount,
      expectedAmount: request.fromAmount.toFixed(),
      acceptedAmount: classification.acceptedAmount.toFixed(),
      refundAmount: classification.refundAmount.toFixed(),
      currency: request.fromCoin.code,
      coin: request.fromCoin.code,
      network: request.fromNetwork.code,
      chain: request.fromNetwork.chain,
      classification: classification.kind,
      txHash: canonicalPayload.txId,
      fromAddress: canonicalPayload.counterAddress,
      toAddress: canonicalPayload.address,
      depositAddress: request.depositAddress?.address,
      status: request.status,
      source: "Tatum",
    },
  })

  const refundResult = await initiateRefundIfNeeded(request, classification, canonicalPayload)
  if (refundResult.blockedByGasTopUp) {
    return {
      status: 500,
      body: {
        ok: false,
        retryable: true,
        exchangeRequestId: request.id,
        reason: "awaiting-gas-topup-confirmation",
      },
    }
  }

  if (classification.kind === "underpaid") {
    return {
      status: 200,
      body: {
        ok: true,
        exchangeRequestId: request.id,
        status: ExchangeRequestStatus.REFUND_PENDING,
        waitingFor: "refund-confirmation",
      },
    }
  }

  const transferResult = await initiateTransferToExchangeIfNeeded(request, classification, canonicalPayload)
  if (transferResult.blockedByGasTopUp) {
    return {
      status: 500,
      body: {
        ok: false,
        retryable: true,
        exchangeRequestId: request.id,
        reason: "awaiting-gas-topup-confirmation",
      },
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      exchangeRequestId: request.id,
      classification: classification.kind,
      refundTriggered: refundResult.triggered,
      transferTriggered: transferResult.triggered,
    },
  }
}