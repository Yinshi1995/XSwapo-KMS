import db from "../index"

export async function seedExchangeRequests() {
  const [btc, usdt, btcNetwork, usdtEthNetwork] = await Promise.all([
    db.coin.findFirst({ where: { code: "BTC" } }),
    db.coin.findFirst({ where: { code: "USDT" } }),
    db.network.findFirst({ where: { code: "BTC_MAINNET" } }),
    db.network.findFirst({ where: { code: "ETH_MAINNET" } }),
  ])

  if (!btc || !usdt || !btcNetwork || !usdtEthNetwork) return

  const masterWallet = await db.masterWallet.findFirst({
    where: { coinId: btc.id },
    include: { depositAddresses: true },
  })

  const depositAddress = masterWallet?.depositAddresses[0]

  const requests = [
    {
      id: "seed-exchange-btc-usdt-waiting",
      fromAmount: 0.1,
      toAmount: 6500,
      receivedAmount: null as number | null,
      acceptedAmount: null as number | null,
      refundedAmount: 0,
      isRefunded: false,
      isPartialRefund: false,
      refundReason: null as string | null,
      clientWithdrawAddress: "bc1q-client-demo-1",
      status: "WAITING_DEPOSIT" as const,
      estimatedRate: 65000,
      feeAmount: 0,
      completedAt: null as Date | null,
      failedReason: null as string | null,
    },
    {
      id: "seed-exchange-btc-usdt-processing",
      fromAmount: 0.2,
      toAmount: 13000,
      receivedAmount: 0.2,
      acceptedAmount: 0.2,
      refundedAmount: 0,
      isRefunded: false,
      isPartialRefund: false,
      refundReason: null as string | null,
      clientWithdrawAddress: "bc1q-client-demo-2",
      status: "PROCESSING" as const,
      estimatedRate: 65000,
      feeAmount: 0.0002,
      completedAt: null as Date | null,
      failedReason: null as string | null,
    },
    {
      id: "seed-exchange-btc-usdt-partial-refund",
      fromAmount: 0.3,
      toAmount: 19500,
      receivedAmount: 0.35,
      acceptedAmount: 0.3,
      refundedAmount: 0.05,
      isRefunded: false,
      isPartialRefund: true,
      refundReason: "Overpaid, partial refund issued",
      clientWithdrawAddress: "bc1q-client-demo-3",
      status: "PARTIALLY_REFUNDED" as const,
      estimatedRate: 65000,
      feeAmount: 0.0003,
      completedAt: null as Date | null,
      failedReason: null as string | null,
    },
  ]

  for (const request of requests) {
    await db.exchangeRequest.upsert({
      where: { id: request.id },
      update: {
        fromCoinId: btc.id,
        fromNetworkId: btcNetwork.id,
        toCoinId: usdt.id,
        toNetworkId: usdtEthNetwork.id,
        fromAmount: request.fromAmount,
        toAmount: request.toAmount,
        receivedAmount: request.receivedAmount,
        acceptedAmount: request.acceptedAmount,
        refundedAmount: request.refundedAmount,
        isRefunded: request.isRefunded,
        isPartialRefund: request.isPartialRefund,
        refundReason: request.refundReason,
        clientWithdrawAddress: request.clientWithdrawAddress,
        depositAddressId: depositAddress?.id ?? null,
        status: request.status,
        estimatedRate: request.estimatedRate,
        feeAmount: request.feeAmount,
        completedAt: request.completedAt,
        failedReason: request.failedReason,
      },
      create: {
        id: request.id,
        fromCoinId: btc.id,
        fromNetworkId: btcNetwork.id,
        toCoinId: usdt.id,
        toNetworkId: usdtEthNetwork.id,
        fromAmount: request.fromAmount,
        toAmount: request.toAmount,
        receivedAmount: request.receivedAmount,
        acceptedAmount: request.acceptedAmount,
        refundedAmount: request.refundedAmount,
        isRefunded: request.isRefunded,
        isPartialRefund: request.isPartialRefund,
        refundReason: request.refundReason,
        clientWithdrawAddress: request.clientWithdrawAddress,
        depositAddressId: depositAddress?.id ?? null,
        status: request.status,
        estimatedRate: request.estimatedRate,
        feeAmount: request.feeAmount,
        completedAt: request.completedAt,
        failedReason: request.failedReason,
      },
    })
  }
}
