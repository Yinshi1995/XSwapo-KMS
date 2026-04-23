/**
 * lib/depositAddress.ts — Deposit address provider abstraction
 *
 * Supports multiple sources for deposit addresses:
 * - TATUM: HD wallet generation via local crypto libs (default)
 * - KUCOIN: Static address fetched from KuCoin exchange API
 * - BINANCE: Static address fetched from Binance exchange API
 */

import { DepositSource } from "../db/index"
import db from "../db/index"
import { generateWallet, deriveAddress } from "../index"
import { encryptMnemonic } from "./crypto"
import { getExchangeProvider } from "../pipeline/exchange"

export interface DepositAddressResult {
  address: string
  memo?: string
  source: DepositSource
  masterWalletXpub?: string
  index?: number
}

export interface GetDepositAddressParams {
  coinId: string
  networkId: string
  chainCode: string
  coinCode: string
  depositSource: DepositSource
  kucoinChainCode?: string | null
}

/**
 * Get or create a deposit address based on the network's depositSource.
 *
 * For TATUM: Creates/uses MasterWallet and derives HD address
 * For KUCOIN: Fetches static address from KuCoin exchange
 * For BINANCE: Fetches static address from Binance exchange
 */
export async function getOrCreateDepositAddress(
  params: GetDepositAddressParams,
): Promise<DepositAddressResult> {
  const { depositSource } = params

  switch (depositSource) {
    case DepositSource.KUCOIN:
      return getKuCoinDepositAddress(params)
    case DepositSource.BINANCE:
      return getBinanceDepositAddress(params)
    case DepositSource.TATUM:
    default:
      return getTatumDepositAddress(params)
  }
}

/**
 * TATUM source: HD wallet generation via local crypto libs.
 * Creates MasterWallet if needed, derives next address.
 */
async function getTatumDepositAddress(
  params: GetDepositAddressParams,
): Promise<DepositAddressResult> {
  const { coinId, networkId, chainCode } = params

  let masterWallet = await db.masterWallet.findUnique({
    where: { coinId_networkId: { coinId, networkId } },
  })

  if (!masterWallet) {
    const walletData = generateWallet(chainCode)
    const surprise = encryptMnemonic(walletData.mnemonic)

    masterWallet = await db.masterWallet.create({
      data: {
        coinId,
        networkId,
        xpub: walletData.xpub,
        surprise,
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
    })
  }

  const nextIndex = masterWallet.generatedAddresses > 0
    ? masterWallet.currentIndex + 1
    : 0

  const addrData = await deriveAddress(masterWallet.xpub, nextIndex, chainCode)
  if (!addrData.address) {
    throw new Error("Failed to derive deposit address from master wallet XPUB")
  }

  const [depositAddress] = await db.$transaction([
    db.depositAddress.create({
      data: {
        address: addrData.address,
        index: nextIndex,
        masterWalletxpub: masterWallet.xpub,
      },
    }),
    db.masterWallet.update({
      where: { xpub: masterWallet.xpub },
      data: {
        currentIndex: nextIndex,
        generatedAddresses: { increment: 1 },
      },
    }),
  ])

  return {
    address: depositAddress.address,
    source: DepositSource.TATUM,
    masterWalletXpub: masterWallet.xpub,
    index: nextIndex,
  }
}

/**
 * KUCOIN source: Static address from KuCoin exchange.
 * Returns the same address for all requests (exchange-managed).
 */
async function getKuCoinDepositAddress(
  params: GetDepositAddressParams,
): Promise<DepositAddressResult> {
  const { coinId, networkId, coinCode, kucoinChainCode, chainCode } = params

  const provider = getExchangeProvider()
  if (provider.name !== "kucoin") {
    throw new Error(
      `Network configured for KUCOIN deposits but active exchange provider is "${provider.name}". ` +
      `Set EXCHANGE_PROVIDER=kucoin or change network depositSource.`
    )
  }

  const chain = kucoinChainCode || chainCode.toLowerCase()
  const exchangeAddress = await provider.getDepositAddress(coinCode, chain)

  const existingDepositAddress = await db.depositAddress.findUnique({
    where: { address: exchangeAddress.address },
  })

  if (existingDepositAddress) {
    return {
      address: existingDepositAddress.address,
      memo: exchangeAddress.memo,
      source: DepositSource.KUCOIN,
    }
  }

  let masterWallet = await db.masterWallet.findUnique({
    where: { coinId_networkId: { coinId, networkId } },
  })

  if (!masterWallet) {
    masterWallet = await db.masterWallet.create({
      data: {
        coinId,
        networkId,
        xpub: `kucoin:${coinCode}:${chain}`,
        surprise: null,
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
    })
  }

  const depositAddress = await db.depositAddress.create({
    data: {
      address: exchangeAddress.address,
      index: 0,
      masterWalletxpub: masterWallet.xpub,
    },
  })

  await db.masterWallet.update({
    where: { xpub: masterWallet.xpub },
    data: { generatedAddresses: { increment: 1 } },
  })

  return {
    address: depositAddress.address,
    memo: exchangeAddress.memo,
    source: DepositSource.KUCOIN,
    masterWalletXpub: masterWallet.xpub,
    index: 0,
  }
}

/**
 * BINANCE source: Static address from Binance exchange.
 * Returns the same address for all requests (exchange-managed).
 */
async function getBinanceDepositAddress(
  params: GetDepositAddressParams,
): Promise<DepositAddressResult> {
  const { coinId, networkId, coinCode, chainCode } = params

  const provider = getExchangeProvider()
  if (provider.name !== "binance") {
    throw new Error(
      `Network configured for BINANCE deposits but active exchange provider is "${provider.name}". ` +
      `Set EXCHANGE_PROVIDER=binance or change network depositSource.`
    )
  }

  const exchangeAddress = await provider.getDepositAddress(coinCode, chainCode)

  const existingDepositAddress = await db.depositAddress.findUnique({
    where: { address: exchangeAddress.address },
  })

  if (existingDepositAddress) {
    return {
      address: existingDepositAddress.address,
      memo: exchangeAddress.tag || exchangeAddress.memo,
      source: DepositSource.BINANCE,
    }
  }

  let masterWallet = await db.masterWallet.findUnique({
    where: { coinId_networkId: { coinId, networkId } },
  })

  if (!masterWallet) {
    masterWallet = await db.masterWallet.create({
      data: {
        coinId,
        networkId,
        xpub: `binance:${coinCode}:${chainCode}`,
        surprise: null,
        status: "ACTIVE",
        currentIndex: 0,
        generatedAddresses: 0,
      },
    })
  }

  const depositAddress = await db.depositAddress.create({
    data: {
      address: exchangeAddress.address,
      index: 0,
      masterWalletxpub: masterWallet.xpub,
    },
  })

  await db.masterWallet.update({
    where: { xpub: masterWallet.xpub },
    data: { generatedAddresses: { increment: 1 } },
  })

  return {
    address: depositAddress.address,
    memo: exchangeAddress.tag || exchangeAddress.memo,
    source: DepositSource.BINANCE,
    masterWalletXpub: masterWallet.xpub,
    index: 0,
  }
}
