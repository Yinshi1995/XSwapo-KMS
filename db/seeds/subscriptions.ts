import db from "../index"

export async function seedSubscriptions() {
  const exchangeRequest = await db.exchangeRequest.findUnique({
    where: { id: "seed-exchange-btc-usdt-processing" },
    include: {
      depositAddress: true,
    },
  })

  const depositAddress =
    exchangeRequest?.depositAddress ??
    (await db.depositAddress.findFirst({
      include: {
        masterWallet: {
          include: {
            network: true,
          },
        },
      },
    }))

  if (!depositAddress) return

  const chain = (depositAddress as any).masterWallet?.network?.chain ?? ""

  const subscriptions = [
    {
      id: "seed-subscription-native-1",
      type: "INCOMING_NATIVE_TX" as const,
      webhookUrl: "https://example.com/webhook/native",
      tatumSubscriptionId: "demo-native-1",
      isActive: true,
      depositAddressId: depositAddress.id,
      chain,
      exchangeRequestId: exchangeRequest?.id ?? null,
    },
    {
      id: "seed-subscription-fungible-1",
      type: "INCOMING_FUNGIBLE_TX" as const,
      webhookUrl: "https://example.com/webhook/token",
      tatumSubscriptionId: "demo-fungible-1",
      isActive: true,
      depositAddressId: depositAddress.id,
      chain,
      exchangeRequestId: null,
    },
  ]

  for (const subscription of subscriptions) {
    await db.subscription.upsert({
      where: { id: subscription.id },
      update: subscription,
      create: subscription,
    })
  }
}
