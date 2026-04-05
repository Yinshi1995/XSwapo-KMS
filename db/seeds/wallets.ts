import { encryptMnemonic } from "../../lib/crypto"
import { generateWallet, deriveAddress } from "../../index"
import db from "../index"

export async function seedWallets() {
  const mappings = await db.coinNetworkMapping.findMany({
    include: { coin: true, network: true },
  })

  for (const mapping of mappings) {
    const chainCode = mapping.tatumChainCode || mapping.network.chain
    const walletData = generateWallet(chainCode)
    const addrData = await deriveAddress(walletData.xpub, 0, chainCode)
    const surprise = encryptMnemonic(walletData.mnemonic)

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
        xpub: walletData.xpub,
        surprise,
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
    })

    await db.depositAddress.upsert({
      where: {
        masterWalletxpub_index: {
          masterWalletxpub: masterWallet.xpub,
          index: 0,
        },
      },
      update: {
        address: addrData.address,
      },
      create: {
        address: addrData.address,
        index: 0,
        masterWalletxpub: masterWallet.xpub,
      },
    })
  }

  const networks = await db.network.findMany()

  for (const network of networks) {
    const chainCode = network.chain
    const walletData = generateWallet(chainCode)
    const addrData = await deriveAddress(walletData.xpub, 0, chainCode)
    const surprise = encryptMnemonic(walletData.mnemonic)

    await db.gasWallet.upsert({
      where: { address: addrData.address },
      update: {
        networkId: network.id,
        xpub: walletData.xpub,
        type: "MASTER",
        status: "ACTIVE",
        minBalance: 0,
        targetBalance: 0,
        isPrimary: true,
      },
      create: {
        networkId: network.id,
        address: addrData.address,
        xpub: walletData.xpub,
        surprise,
        type: "MASTER",
        status: "ACTIVE",
        balance: 0,
        minBalance: 0,
        targetBalance: 0,
        isPrimary: true,
      },
    })
  }
}
