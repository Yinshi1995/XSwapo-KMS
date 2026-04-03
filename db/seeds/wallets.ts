import { encryptMnemonic } from "../../src/app/services/crypto"
import db from "../index"
import { generateMnemonic } from "bip39"

export async function seedWallets() {
  const mappings = await db.coinNetworkMapping.findMany({
    include: { coin: true, network: true },
  })

  for (const mapping of mappings) {
    const mnemonic = generateMnemonic(256)
    const encryptedMnemonic = encryptMnemonic(mnemonic)

    const masterWallet = await db.masterWallet.upsert({
      where: {
        coinId_networkId: {
          coinId: mapping.coinId,
          networkId: mapping.networkId,
        },
      },
      update: {
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
      create: {
        coinId: mapping.coinId,
        networkId: mapping.networkId,
        xpub: `xpub-dev-${mapping.coin.code}-${mapping.network.code}`,
        surprise: encryptedMnemonic,
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
    })

    const depositAddress = `dep-${mapping.coin.code}-${mapping.network.code}-0`

    // Ensure seeding is idempotent with respect to the real unique constraint
    // (masterWalletxpub, index). If a row already exists for this wallet/index,
    // just update its address instead of trying to create a duplicate.
    await db.depositAddress.upsert({
      where: {
        masterWalletxpub_index: {
          masterWalletxpub: masterWallet.xpub,
          index: 0,
        },
      },
      update: {
        address: depositAddress,
      },
      create: {
        address: depositAddress,
        index: 0,
        masterWalletxpub: masterWallet.xpub,
      },
    })
  }

  const networks = await db.network.findMany()

  for (const network of networks) {
    const gasMnemonic = generateMnemonic(256)
    const encryptedGasMnemonic = encryptMnemonic(gasMnemonic)

    await db.gasWallet.upsert({
      where: { address: `0xgas-${network.code.toLowerCase()}` },
      update: {
        networkId: network.id,
        xpub: `xpub-gas-${network.code.toLowerCase()}`,
        type: "MASTER",
        status: "ACTIVE",
        minBalance: 0.1,
        targetBalance: 1,
        isPrimary: true,
      },
      create: {
        networkId: network.id,
        address: `0xgas-${network.code.toLowerCase()}`,
        xpub: `xpub-gas-${network.code.toLowerCase()}`,
        surprise: encryptedGasMnemonic,
        type: "MASTER",
        status: "ACTIVE",
        balance: 0,
        minBalance: 0.1,
        targetBalance: 1,
        isPrimary: true,
      },
    })
  }
}
