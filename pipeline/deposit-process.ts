import db, { TransactionStatus, TransactionType } from "../db/index"
import { emitNotification } from "./notifications/emit"
import { toDecimal } from "../lib/decimal"
import {
  advanceExchangeRequestStatus,
  classifyAmount,
  createSystemLog,
} from "./helpers"
import { getExchangeRequestContextById } from "./settlement"
import { initiateTransferToExchangeIfNeeded } from "./transfer"
import type { NormalizedTatumWebhookPayload } from "./normalize"
import type { ExchangeRequestContext } from "./types"

export async function processPolledDeposit(
  request: ExchangeRequestContext,
  balance: string,
  txHash?: string,
): Promise<void> {
  const tag = `[poll-process:${request.id}]`

  // In-memory dedup: skip if CLIENT_DEPOSIT already recorded
  if (request.transactions.some(t => t.type === TransactionType.CLIENT_DEPOSIT)) {
    console.info(`${tag} skipped: CLIENT_DEPOSIT already exists`)
    return
  }

  // Also dedup by txHash if provided (for exchange-managed deposits)
  if (txHash) {
    const existingByTxHash = await db.transaction.findUnique({
      where: { txHash },
    })
    if (existingByTxHash) {
      console.info(`${tag} skipped: transaction with txHash=${txHash} already exists`)
      return
    }
  }

  const receivedAmount = toDecimal(balance)
  const classification = classifyAmount(request.fromAmount, receivedAmount)
  const nextStatus = advanceExchangeRequestStatus(request.status, classification.nextStatus)

  const createdTransaction = await db.$transaction(async (tx) => {
    // Concurrent-safe dedup inside the transaction
    const existing = await tx.transaction.findFirst({
      where: { exchangeRequestId: request.id, type: TransactionType.CLIENT_DEPOSIT },
    })
    if (existing) return null

    const created = await tx.transaction.create({
      data: {
        exchangeRequestId: request.id,
        depositAddressId: request.depositAddress!.id,
        type: TransactionType.CLIENT_DEPOSIT,
        status: TransactionStatus.DETECTED,
        direction: "IN",
        toAddress: request.depositAddress!.address,
        amount: receivedAmount,
        confirmedAmount: receivedAmount,
        incomingCoinId: request.fromCoinId,
        networkId: request.fromNetworkId,
        txHash: txHash ?? null,
        detectedAt: new Date(),
        rawPayload: { source: "polling", detectedAt: new Date().toISOString(), txHash },
      },
    })

    await tx.exchangeRequest.update({
      where: { id: request.id },
      data: {
        receivedAmount,
        acceptedAmount: classification.acceptedAmount,
        refundReason:
          classification.kind === "underpaid"
            ? "Received amount is lower than expected deposit amount"
            : classification.kind === "overpaid"
              ? "Received amount is higher than expected deposit amount"
              : null,
        status: nextStatus,
      },
    })

    await createSystemLog(
      tx,
      "info",
      "CLIENT_DEPOSIT_RECORDED",
      "Client deposit recorded from balance poll",
      {
        exchangeRequestId: request.id,
        amount: balance,
        classification: classification.kind,
        source: "polling",
      },
    )

    return created
  })

  if (!createdTransaction) {
    console.info(`${tag} concurrent dedup: deposit already recorded`)
    return
  }

  console.info(
    `${tag} CLIENT_DEPOSIT created: id=${createdTransaction.id} amount=${balance} classification=${classification.kind}`,
  )

  const depositEventType =
    classification.kind === "underpaid"
      ? ("deposit.underpaid" as const)
      : classification.kind === "overpaid"
        ? ("deposit.overpaid" as const)
        : ("deposit.confirmed" as const)

  await emitNotification(depositEventType, {
    correlationId: `poll:${request.id}`,
    summary:
      classification.kind === "exact"
        ? `Deposit of ${balance} ${request.fromCoin.code} confirmed on ${request.fromNetwork.code}`
        : classification.kind === "underpaid"
          ? `Underpaid deposit: received ${balance} ${request.fromCoin.code}, expected ${request.fromAmount}`
          : `Overpaid deposit: received ${balance} ${request.fromCoin.code}, expected ${request.fromAmount}`,
    payload: {
      exchangeRequestId: request.id,
      amount: balance,
      expectedAmount: request.fromAmount.toFixed(),
      acceptedAmount: classification.acceptedAmount.toFixed(),
      refundAmount: classification.refundAmount.toFixed(),
      currency: request.fromCoin.code,
      coin: request.fromCoin.code,
      network: request.fromNetwork.code,
      chain: request.fromNetwork.chain,
      classification: classification.kind,
      depositAddress: request.depositAddress!.address,
      depositAddressId: request.depositAddress!.id,
      status: nextStatus,
      source: "polling",
    },
  })

  // Underpaid: can't refund without sender address — stop here
  if (classification.kind === "underpaid") {
    console.warn(`${tag} underpaid — refund skipped (no sender address from polling)`)
    await createSystemLog(
      db,
      "warn",
      "POLLING_UNDERPAID_NO_REFUND",
      "Underpaid deposit detected via polling; refund skipped — no sender address available",
      {
        exchangeRequestId: request.id,
        receivedAmount: balance,
        expectedAmount: request.fromAmount.toFixed(),
      },
    )
    return
  }

  // Overpaid: skip refund, proceed with transfer of acceptedAmount
  if (classification.kind === "overpaid") {
    console.warn(
      `${tag} overpaid — refund of ${classification.refundAmount} skipped (no sender address from polling)`,
    )
    await createSystemLog(
      db,
      "warn",
      "POLLING_OVERPAID_NO_REFUND",
      "Overpaid deposit detected via polling; refund portion skipped — no sender address available",
      {
        exchangeRequestId: request.id,
        receivedAmount: balance,
        expectedAmount: request.fromAmount.toFixed(),
        refundAmount: classification.refundAmount.toFixed(),
      },
    )
  }

  // Re-fetch request with updated status before calling transfer
  const updatedRequest = await getExchangeRequestContextById(request.id)
  if (!updatedRequest) {
    console.warn(`${tag} exchange request not found after deposit recording`)
    return
  }

  // Synthetic payload: only txId (idempotency key) is used by initiateTransferToExchangeIfNeeded
  const syntheticPayload: NormalizedTatumWebhookPayload = {
    address: request.depositAddress!.address,
    amount: balance,
    txId: `poll:${request.id}`,
    counterAddress: null,
    chain: request.fromNetwork.chain,
    type: null,
    asset: null,
    currency: null,
    contractAddress: null,
    subscriptionType: null,
    blockNumber: null,
    rawPayload: { source: "polling" },
  }

  const transferResult = await initiateTransferToExchangeIfNeeded(
    updatedRequest,
    classification,
    syntheticPayload,
  )

  console.info(
    `${tag} transferResult: triggered=${transferResult.triggered} blockedByGasTopUp=${transferResult.blockedByGasTopUp}`,
  )
}
