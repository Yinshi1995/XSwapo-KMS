import db, {
  ExchangeRequestStatus,
  TransactionStatus,
  TransactionType,
} from "../db/index"
import { getExchangeProvider } from "./exchange"
import { emitNotification } from "./notifications/emit"
import { toDecimal } from "../lib/decimal"
import {
  createSystemLog,
  formatDecimal,
  getCoinNetworkMapping,
  getNativeCoinCode,
  getRequestedPayoutAmount,
  isFinalExchangeRequestStatus,
  isNativeAsset,
  isPrismaKnownError,
} from "./helpers"
import {
  exchangeRequestInclude,
  type ExchangeRequestContext,
  type ExchangeSettlementOutcome,
  type SideEffectIntentResult,
  type TransactionContext,
} from "./types"

async function getExchangeTransferCoinCode(request: ExchangeRequestContext): Promise<string> {
  const mapping = await getCoinNetworkMapping(request.fromCoinId, request.fromNetworkId)
  return isNativeAsset(request, mapping)
    ? getNativeCoinCode(request.fromNetwork)
    : request.fromCoin.code.toUpperCase()
}

export async function getExchangeRequestContextById(
  requestId: string
): Promise<ExchangeRequestContext | null> {
  return db.exchangeRequest.findUnique({
    where: { id: requestId },
    include: exchangeRequestInclude,
  })
}

async function ensureClientPayoutIntent(
  request: ExchangeRequestContext
): Promise<SideEffectIntentResult> {
  const idempotencyKey = `${request.id}:client-payout`
  const payoutAmount = getRequestedPayoutAmount(request)
  const existing = await db.transaction.findUnique({
    where: {
      type_idempotencyKey: {
        type: TransactionType.CLIENT_PAYOUT,
        idempotencyKey,
      },
    },
  })

  if (existing) {
    if (!toDecimal(existing.amount).equals(payoutAmount) && existing.status !== TransactionStatus.CONFIRMED) {
      const transaction = await db.transaction.update({
        where: { id: existing.id },
        data: {
          amount: payoutAmount,
        },
      })

      return {
        transaction,
        created: false,
      }
    }

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
        type: TransactionType.CLIENT_PAYOUT,
        status: TransactionStatus.CREATED,
        direction: "OUT",
        toAddress: request.clientWithdrawAddress,
        amount: payoutAmount,
        outgoingCoinId: request.toCoinId,
        networkId: request.toNetworkId,
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
            type: TransactionType.CLIENT_PAYOUT,
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

async function acquireClientPayoutExecution(transactionId: string): Promise<boolean> {
  const result = await db.transaction.updateMany({
    where: {
      id: transactionId,
      status: {
        in: [TransactionStatus.CREATED, TransactionStatus.FAILED],
      },
    },
    data: {
      status: TransactionStatus.PENDING,
      processedAt: new Date(),
      failedReason: null,
    },
  })

  return result.count === 1
}

async function markExchangeSettlementFailure(
  requestId: string,
  payoutTransactionId: string,
  error: unknown
): Promise<void> {
  const provider = getExchangeProvider()
  const message = error instanceof Error ? error.message : String(error)

  await db.$transaction(async (transactionExecutor) => {
    await transactionExecutor.transaction.update({
      where: { id: payoutTransactionId },
      data: {
        status: TransactionStatus.FAILED,
        failedReason: message,
      },
    })

    await transactionExecutor.exchangeRequest.update({
      where: { id: requestId },
      data: {
        status: ExchangeRequestStatus.FAILED,
        failedReason: message,
      },
    })

    await createSystemLog(
      transactionExecutor,
      "error",
      "EXCHANGE_SETTLEMENT_FAILED",
      `Exchange settlement failed after transfer confirmation (provider: ${provider.name})`,
      {
        exchangeRequestId: requestId,
        payoutTransactionId,
        provider: provider.name,
        error: message,
      }
    )
  })
}

async function finalizeExchangeSettlement(
  request: ExchangeRequestContext,
  outcome: ExchangeSettlementOutcome
): Promise<void> {
  const now = new Date()

  // COMPLETED here means the exchange accepted the withdrawal request; we intentionally do not
  // wait for withdraw/history so the pipeline is not blocked on on-chain finalization polling.

  await db.$transaction(async (transactionExecutor) => {
    await transactionExecutor.transaction.update({
      where: { id: outcome.payoutTransactionId },
      data: {
        amount: toDecimal(outcome.withdrawAmount),
        externalId: outcome.withdrawalId,
        status: TransactionStatus.CONFIRMED,
        confirmedAt: now,
        processedAt: now,
        failedReason: null,
      },
    })

    await transactionExecutor.exchangeRequest.update({
      where: { id: request.id },
      data: {
        status: ExchangeRequestStatus.COMPLETED,
        completedAt: now,
        failedReason: null,
      },
    })

    await createSystemLog(
      transactionExecutor,
      "info",
      "EXCHANGE_SETTLEMENT_COMPLETED",
      `Exchange settlement completed: ${outcome.provider} accepted the payout withdrawal request`,
      {
        exchangeRequestId: request.id,
        provider: outcome.provider,
        payoutTransactionId: outcome.payoutTransactionId,
        withdrawalId: outcome.withdrawalId,
        withdrawOrderId: outcome.withdrawOrderId,
        withdrawAmount: outcome.withdrawAmount,
        coin: request.toCoin.code,
        network: request.toNetwork.chain.toUpperCase(),
        clientWithdrawAddress: request.clientWithdrawAddress,
        orderSymbol: outcome.orderSymbol,
        orderId: outcome.orderId,
      }
    )
  })
}

async function settleConfirmedTransferToExchange(
  transferTransaction: TransactionContext
): Promise<void> {
  const tag = `[settlement:${transferTransaction.id}]`

  if (!transferTransaction.exchangeRequestId) {
    console.warn(`${tag} skipped: no exchangeRequestId on transaction`)
    return
  }

  console.info(`${tag} starting settlement for ER ${transferTransaction.exchangeRequestId}`)

  const request = await getExchangeRequestContextById(transferTransaction.exchangeRequestId)
  if (!request) {
    console.warn(`${tag} skipped: exchange request not found`)
    return
  }
  if (isFinalExchangeRequestStatus(request.status)) {
    console.warn(`${tag} skipped: exchange request already in final status "${request.status}"`)
    return
  }

  const provider = getExchangeProvider()
  const withdrawOrderId = `${request.id}:client-payout`

  console.info(`${tag} request status="${request.status}", provider="${provider.name}", toAmount=${formatDecimal(request.toAmount)}, feeAmount=${formatDecimal(request.feeAmount)}`)

  let payoutIntent: SideEffectIntentResult
  try {
    payoutIntent = await ensureClientPayoutIntent(request)
  } catch (error) {
    console.error(`${tag} ensureClientPayoutIntent threw:`, error)
    const message = error instanceof Error ? error.message : String(error)
    await db.$transaction(async (tx) => {
      await tx.exchangeRequest.update({
        where: { id: request.id },
        data: {
          status: ExchangeRequestStatus.FAILED,
          failedReason: message,
        },
      })
      await createSystemLog(
        tx,
        "error",
        "EXCHANGE_SETTLEMENT_FAILED",
        `Exchange settlement failed before payout intent (provider: ${provider.name}): ${message}`,
        {
          exchangeRequestId: request.id,
          provider: provider.name,
          error: message,
        }
      )
    })
    throw error
  }

  console.info(`${tag} payoutIntent: id=${payoutIntent.transaction.id}, status="${payoutIntent.transaction.status}", created=${payoutIntent.created}`)

  if (payoutIntent.transaction.status === TransactionStatus.CONFIRMED) {
    console.info(`${tag} skipped: payout already confirmed`)
    return
  }

  const acquired = await acquireClientPayoutExecution(payoutIntent.transaction.id)
  if (!acquired) {
    console.warn(`${tag} skipped: could not acquire payout execution lock (status not CREATED/FAILED)`)
    return
  }

  console.info(`${tag} acquired payout execution lock, starting exchange settlement...`)

  await emitNotification("settlement.started", {
    correlationId: `settlement:${transferTransaction.id}`,
    sourceEventId: transferTransaction.txHash ?? undefined,
    summary: `Settlement started for request ${request.id} via ${provider.name}`,
    payload: {
      exchangeRequestId: request.id,
      transactionId: transferTransaction.id,
      provider: provider.name,
      fromCoin: request.fromCoin.code,
      toCoin: request.toCoin.code,
      toAmount: formatDecimal(request.toAmount),
      network: request.toNetwork.code,
    },
  })

  try {
    const transferCoinCode = await getExchangeTransferCoinCode(request)
    const needsSwap = request.fromCoin.code.toUpperCase() !== request.toCoin.code.toUpperCase()
    const withdrawAmount = formatDecimal(getRequestedPayoutAmount(request))

    console.info(`${tag} executeSettlement: transferCoin=${transferCoinCode}, needsSwap=${needsSwap}, withdrawAmount=${withdrawAmount}, withdrawCoin=${request.toCoin.code}, withdrawNetwork=${request.toNetwork.kucoinChainCode ?? request.toNetwork.code}, withdrawAddress=${request.clientWithdrawAddress}`)

    // Extract gas cost for token sweeps (saved by transfer.ts from sweepResult.gasCostNative).
    // Absent for native coin deposits (gas was already deducted from the transfer amount).
    const sweepRawPayload = transferTransaction.rawPayload as { gasCostNative?: string } | null
    const depositGasCostNative = sweepRawPayload?.gasCostNative || undefined

    const settlement = await provider.executeSettlement({
      depositCoin: transferCoinCode,
      depositNetwork: request.fromNetwork.kucoinChainCode ?? request.fromNetwork.code,
      depositAddress: transferTransaction.toAddress ?? undefined,
      depositAmount: transferTransaction.amount.toString(),
      depositTxId: transferTransaction.txHash ?? undefined,
      depositStartTime: Math.max(
        (transferTransaction.processedAt ?? transferTransaction.createdAt).getTime() - 5 * 60 * 1000,
        0
      ),
      needsSwap,
      sourceCoin: transferCoinCode,
      targetCoin: request.toCoin.code,
      withdrawCoin: request.toCoin.code,
      withdrawNetwork: request.toNetwork.kucoinChainCode ?? request.toNetwork.code,
      withdrawAmount,
      withdrawAddress: request.clientWithdrawAddress,
      withdrawOrderId,
      depositGasCostNative,
      depositNetworkNativeCoin: depositGasCostNative
        ? getNativeCoinCode(request.fromNetwork)
        : undefined,
    })

    console.info(`${tag} settlement succeeded: withdrawalId=${settlement.withdrawalId}, withdrawAmount=${settlement.withdrawAmount}`)

    await finalizeExchangeSettlement(request, {
      provider: provider.name,
      payoutTransactionId: payoutIntent.transaction.id,
      withdrawalId: settlement.withdrawalId,
      withdrawOrderId,
      withdrawAmount: settlement.withdrawAmount,
      orderSymbol: settlement.orderInfo?.symbol,
      orderId: settlement.orderInfo?.orderId,
    })

    await emitNotification("settlement.completed", {
      correlationId: `settlement:${transferTransaction.id}`,
      sourceEventId: settlement.withdrawalId,
      summary: `Settlement completed: ${settlement.withdrawAmount} ${request.toCoin.code} sent to client`,
      payload: {
        exchangeRequestId: request.id,
        provider: provider.name,
        amount: settlement.withdrawAmount,
        currency: request.toCoin.code,
        coin: request.toCoin.code,
        network: request.toNetwork.code,
        chain: request.toNetwork.chain,
        toAddress: request.clientWithdrawAddress,
        withdrawalId: settlement.withdrawalId,
        status: "COMPLETED",
        source: provider.name,
      },
    })

    console.info(`${tag} settlement finalized successfully`)
  } catch (error) {
    console.error(`${tag} settlement execution failed:`, error)
    await markExchangeSettlementFailure(request.id, payoutIntent.transaction.id, error)

    await emitNotification("settlement.failed", {
      correlationId: `settlement:${transferTransaction.id}`,
      summary: `Settlement failed for request ${request.id}: ${error instanceof Error ? error.message : String(error)}`,
      payload: {
        exchangeRequestId: request.id,
        provider: provider.name,
        fromCoin: request.fromCoin.code,
        toCoin: request.toCoin.code,
        error: error instanceof Error ? error.message : String(error),
        network: request.toNetwork.code,
        status: "FAILED",
        source: provider.name,
      },
    })

    throw error
  }
}

export async function maybeStartExchangeSettlementForConfirmedTransfer(
  transaction: TransactionContext
): Promise<void> {
  if (
    transaction.type !== TransactionType.TRANSFER_TO_BINANCE
    || transaction.status !== TransactionStatus.CONFIRMED
  ) {
    console.info(`[settlement] skipped: tx ${transaction.id} type="${transaction.type}" status="${transaction.status}" — not a confirmed TRANSFER_TO_BINANCE`)
    return
  }

  console.info(`[settlement] firing settleConfirmedTransferToExchange for tx ${transaction.id}`)

  const providerName = getExchangeProvider().name
  void settleConfirmedTransferToExchange(transaction).catch((error) => {
    console.error(`[${providerName}-settlement] failed`, {
      transactionId: transaction.id,
      exchangeRequestId: transaction.exchangeRequestId,
      error,
    })
  })
}
