import db from "../index"

export async function seedTransactions() {
  const [deposit, processingRequest, partialRefundRequest] = await Promise.all([
    db.depositAddress.findFirst({
      include: {
        masterWallet: {
          include: {
            coin: true,
            network: true,
          },
        },
      },
    }),
    db.exchangeRequest.findUnique({ where: { id: "seed-exchange-btc-usdt-processing" } }),
    db.exchangeRequest.findUnique({ where: { id: "seed-exchange-btc-usdt-partial-refund" } }),
  ])

  if (
    !deposit ||
    !deposit.masterWallet ||
    !deposit.masterWallet.coin ||
    !deposit.masterWallet.network
  ) {
    return
  }

  const coin = deposit.masterWallet.coin
  const network = deposit.masterWallet.network

  const transactions = [
    {
      id: "seed-tx-client-deposit-detected",
      exchangeRequestId: processingRequest?.id ?? null,
      depositAddressId: deposit.id,
      type: "CLIENT_DEPOSIT" as const,
      status: "DETECTED" as const,
      direction: "IN",
      senderAddress: "bc1q-sender-demo-1",
      fromAddress: "bc1q-sender-demo-1",
      toAddress: deposit.address,
      amount: 0.05,
      confirmedAmount: null as number | null,
      incomingCoinId: coin.id,
      outgoingCoinId: null as string | null,
      networkId: network.id,
      txHash: "demo-tx-hash-1",
      blockNumber: 100001,
      confirmations: 1,
      detectedAt: new Date("2026-03-09T10:00:00.000Z"),
      processedAt: null as Date | null,
      confirmedAt: null as Date | null,
      failedReason: null as string | null,
      idempotencyKey: "seed-client-deposit-detected",
      externalId: "seed-ext-deposit-1",
      rawPayload: { source: "seed", kind: "deposit_detected" },
    },
    {
      id: "seed-tx-client-deposit-confirmed",
      exchangeRequestId: processingRequest?.id ?? null,
      depositAddressId: deposit.id,
      type: "CLIENT_DEPOSIT" as const,
      status: "CONFIRMED" as const,
      direction: "IN",
      senderAddress: "bc1q-sender-demo-2",
      fromAddress: "bc1q-sender-demo-2",
      toAddress: deposit.address,
      amount: 0.15,
      confirmedAmount: 0.15,
      incomingCoinId: coin.id,
      outgoingCoinId: null as string | null,
      networkId: network.id,
      txHash: "demo-tx-hash-2",
      blockNumber: 100002,
      confirmations: 6,
      detectedAt: new Date("2026-03-09T10:05:00.000Z"),
      processedAt: new Date("2026-03-09T10:15:00.000Z"),
      confirmedAt: new Date("2026-03-09T10:12:00.000Z"),
      failedReason: null as string | null,
      idempotencyKey: "seed-client-deposit-confirmed",
      externalId: "seed-ext-deposit-2",
      rawPayload: { source: "seed", kind: "deposit_confirmed" },
    },
    {
      id: "seed-tx-client-refund-partial",
      exchangeRequestId: partialRefundRequest?.id ?? null,
      depositAddressId: deposit.id,
      type: "CLIENT_REFUND" as const,
      status: "CONFIRMED" as const,
      direction: "OUT",
      senderAddress: deposit.address,
      fromAddress: deposit.address,
      toAddress: "bc1q-client-demo-3",
      amount: 0.05,
      confirmedAmount: 0.05,
      incomingCoinId: null as string | null,
      outgoingCoinId: coin.id,
      networkId: network.id,
      txHash: "demo-tx-hash-3",
      blockNumber: 100003,
      confirmations: 3,
      detectedAt: new Date("2026-03-09T10:20:00.000Z"),
      processedAt: new Date("2026-03-09T10:22:00.000Z"),
      confirmedAt: new Date("2026-03-09T10:25:00.000Z"),
      failedReason: null as string | null,
      idempotencyKey: "seed-client-refund-partial",
      externalId: "seed-ext-refund-1",
      rawPayload: { source: "seed", kind: "refund_partial" },
    },
  ]

  for (const transaction of transactions) {
    await db.transaction.upsert({
      where: { id: transaction.id },
      update: transaction,
      create: transaction,
    })
  }
}
