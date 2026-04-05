/**
 * index.ts — единая точка входа микросервиса
 *
 * Роутит все операции по нужной цепи.
 * Используется в createExchangeRequest и webhook-сервисе.
 */

import * as evm from "./chains/evm"
import * as tron from "./chains/tron"
import * as btc from "./chains/bitcoin"
import * as sol from "./chains/solana"
import * as xrp from "./chains/xrp"
import * as xlm from "./chains/stellar"
import * as algo from "./chains/algorand"
import * as near from "./chains/near"
import * as dot from "./chains/polkadot"
import * as ada from "./chains/cardano"
import * as xtz from "./chains/tezos"
import * as egld from "./chains/multiversx"
import * as vet from "./chains/vechain"
import * as atom from "./chains/cosmos"
import * as sui from "./chains/sui"
import * as ton from "./chains/ton"
import type { Chain, ChainFamily, ChainWallet, DerivedAddress, TxResult, Balance, GasEstimate } from "./types"

// ─── Определяем тип цепи ─────────────────────────────────────────────────────

// DB chain codes (uppercase) → family
const CHAIN_FAMILY_MAP: Record<string, ChainFamily> = {
  BTC: "bitcoin",
  LTC: "litecoin",
  DOGE: "dogecoin",
  BCH: "bitcoincash",
  TRON: "tron",
  SOL: "solana",
  XRP: "xrp",
  XLM: "stellar",
  ALGO: "algorand",
  NEAR: "near",
  DOT: "polkadot",  DOT_AH: "polkadot",  KUSAMA: "polkadot",  KUSAMA_AH: "polkadot",
  ADA: "cardano",
  XTZ: "tezos",
  EGLD: "multiversx",
  VET: "vechain",
  COSMOS: "cosmos",  MANTRA: "cosmos",
  SUI: "sui",
  TON: "ton",
}

export function getFamily(chain: string): ChainFamily {
  const key = chain.toUpperCase()

  // Direct match — DB codes ("BTC", "TRON", "SOL", …)
  if (key in CHAIN_FAMILY_MAP) return CHAIN_FAMILY_MAP[key]

  // Prefix match — legacy API identifiers ("bitcoin-mainnet", "tron-testnet", …)
  if (key.startsWith("BITCOIN-CASH") || key.startsWith("BITCOINCASH") || key.startsWith("BCH")) return "bitcoincash"
  if (key.startsWith("BITCOIN")) return "bitcoin"
  if (key.startsWith("LITECOIN")) return "litecoin"
  if (key.startsWith("DOGECOIN") || key.startsWith("DOGE")) return "dogecoin"
  if (key.startsWith("TRON")) return "tron"
  if (key.startsWith("SOLANA")) return "solana"
  if (key.startsWith("XRP") || key.startsWith("RIPPLE")) return "xrp"
  if (key.startsWith("STELLAR") || key.startsWith("XLM")) return "stellar"
  if (key.startsWith("ALGORAND") || key.startsWith("ALGO")) return "algorand"
  if (key.startsWith("NEAR")) return "near"
  if (key.startsWith("POLKADOT") || key.startsWith("KUSAMA") || key.startsWith("DOT")) return "polkadot"
  if (key.startsWith("CARDANO") || key.startsWith("ADA")) return "cardano"
  if (key.startsWith("TEZOS") || key.startsWith("XTZ")) return "tezos"
  if (key.startsWith("MULTIVERSX") || key.startsWith("EGLD") || key.startsWith("ELROND")) return "multiversx"
  if (key.startsWith("VECHAIN") || key.startsWith("VET")) return "vechain"
  if (key.startsWith("COSMOS") || key.startsWith("ATOM")) return "cosmos"
  if (key.startsWith("SUI")) return "sui"
  if (key.startsWith("TON")) return "ton"

  return "evm"
}

export function isTestnet(chain: string): boolean {
  const lower = chain.toLowerCase()
  return lower.includes("testnet") || lower.includes("sepolia") ||
    lower.includes("amoy") || lower.includes("devnet")
}

/** Auto-append "-mainnet" when the chain has no network suffix */
export function normalizeChain(chain: string): string {
  const lower = chain.toLowerCase()
  if (
    lower.includes("mainnet") || lower.includes("testnet") ||
    lower.includes("sepolia") || lower.includes("amoy") || lower.includes("devnet")
  ) return chain
  return `${chain}-mainnet`
}

// ─── 1. Генерация кошелька ───────────────────────────────────────────────────
export function generateWallet(chain: string): ChainWallet {
  chain = normalizeChain(chain)
  switch (getFamily(chain)) {
    case "bitcoin":     return btc.btcGenerateWallet(isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash": return btc.utxoGenerateWallet(chain)
    case "tron":        return tron.tronGenerateWallet()
    case "solana":      return sol.solGenerateWallet()
    case "xrp":         return xrp.xrpGenerateWallet()
    case "stellar":     return xlm.xlmGenerateWallet()
    case "algorand":    return algo.algoGenerateWallet()
    case "near":        return near.nearGenerateWallet()
    case "polkadot":    return dot.dotGenerateWallet(chain)
    case "cardano":     return ada.adaGenerateWallet(isTestnet(chain))
    case "tezos":       return xtz.xtzGenerateWallet()
    case "multiversx":  return egld.egldGenerateWallet()
    case "vechain":     return vet.vetGenerateWallet()
    case "cosmos":      return atom.atomGenerateWallet()
    case "sui":         return sui.suiGenerateWallet()
    case "ton":         return ton.tonGenerateWallet()
    default:            return evm.evmGenerateWallet()
  }
}

// ─── 2. Деривация адреса из xpub ────────────────────────────────────────────
// Для Ed25519 цепей (Sol/XRP/XLM/ALGO/NEAR/DOT/ADA/XTZ/EGLD/SUI/TON) xpub = мнемоник
export function deriveAddress(xpubOrMnemonic: string, index: number, chain: string): DerivedAddress | Promise<DerivedAddress> {
  chain = normalizeChain(chain)
  switch (getFamily(chain)) {
    case "bitcoin":     return btc.btcDeriveAddress(xpubOrMnemonic, index, isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash": return btc.utxoDeriveAddress(xpubOrMnemonic, index, chain)
    case "tron":        return tron.tronDeriveAddress(xpubOrMnemonic, index)
    case "solana":      return sol.solDeriveAddress(xpubOrMnemonic, index)
    case "xrp":         return xrp.xrpDeriveAddress(xpubOrMnemonic, index)
    case "stellar":     return xlm.xlmDeriveAddress(xpubOrMnemonic, index)
    case "algorand":    return algo.algoDeriveAddress(xpubOrMnemonic, index)
    case "near":        return near.nearDeriveAddress(xpubOrMnemonic, index)
    case "polkadot":    return dot.dotDeriveAddress(xpubOrMnemonic, index, chain)
    case "cardano":     return ada.adaDeriveAddress(xpubOrMnemonic, index, isTestnet(chain))
    case "tezos":       return xtz.xtzDeriveAddress(xpubOrMnemonic, index)
    case "multiversx":  return egld.egldDeriveAddress(xpubOrMnemonic, index)
    case "vechain":     return vet.vetDeriveAddress(xpubOrMnemonic, index)
    case "cosmos":      return atom.atomDeriveAddress(xpubOrMnemonic, index)
    case "sui":         return sui.suiDeriveAddress(xpubOrMnemonic, index)
    case "ton":         return ton.tonDeriveAddress(xpubOrMnemonic, index)
    default:            return evm.evmDeriveAddress(xpubOrMnemonic, index)
  }
}

// ─── 3. Деривация приватного ключа ──────────────────────────────────────────
export function derivePrivateKey(mnemonic: string, index: number, chain: string): string {
  chain = normalizeChain(chain)
  switch (getFamily(chain)) {
    case "bitcoin":     return btc.btcDerivePrivateKey(mnemonic, index, isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash": return btc.utxoDerivePrivateKey(mnemonic, index, chain)
    case "tron":        return tron.tronDerivePrivateKey(mnemonic, index)
    case "solana":      return sol.solDerivePrivateKey(mnemonic, index)
    case "xrp":         return xrp.xrpDerivePrivateKey(mnemonic, index)
    case "stellar":     return xlm.xlmDerivePrivateKey(mnemonic, index)
    case "algorand":    return algo.algoDerivePrivateKey(mnemonic, index)
    case "near":        return near.nearDerivePrivateKey(mnemonic, index)
    case "polkadot":    return dot.dotDerivePrivateKey(mnemonic, index, chain)
    case "cardano":     return ada.adaDerivePrivateKey(mnemonic, index)
    case "tezos":       return xtz.xtzDerivePrivateKey(mnemonic, index)
    case "multiversx":  return egld.egldDerivePrivateKey(mnemonic, index)
    case "vechain":     return vet.vetDerivePrivateKey(mnemonic, index)
    case "cosmos":      return atom.atomDerivePrivateKey(mnemonic, index)
    case "sui":         return sui.suiDerivePrivateKey(mnemonic, index)
    case "ton":         return ton.tonDerivePrivateKey(mnemonic, index)
    default:            return evm.evmDerivePrivateKey(mnemonic, index)
  }
}

// ─── 4. Баланс (native) ──────────────────────────────────────────────────────
export async function getBalance(address: string, chain: string): Promise<Balance> {
  chain = normalizeChain(chain)
  switch (getFamily(chain)) {
    case "bitcoin":     return btc.btcGetBalance(address, isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash": return btc.utxoGetBalance(address, chain)
    case "tron":        return tron.tronGetBalance(address, isTestnet(chain) ? "testnet" : "mainnet")
    case "solana":      return sol.solGetBalance(address, isTestnet(chain))
    case "xrp":         return xrp.xrpGetBalance(address, isTestnet(chain))
    case "stellar":     return xlm.xlmGetBalance(address, isTestnet(chain))
    case "algorand":    return algo.algoGetBalance(address, isTestnet(chain))
    case "near":        return near.nearGetBalance(address, isTestnet(chain))
    case "polkadot":    return dot.dotGetBalance(address, chain)
    case "cardano":     return ada.adaGetBalance(address, isTestnet(chain))
    case "tezos":       return xtz.xtzGetBalance(address)
    case "multiversx":  return egld.egldGetBalance(address)
    case "vechain":     return vet.vetGetBalance(address)
    case "cosmos":      return atom.atomGetBalance(address)
    case "sui":         return sui.suiGetBalance(address)
    case "ton":         return ton.tonGetBalance(address)
    default:            return evm.evmGetBalance(address, chain)
  }
}

// ─── 5. Баланс токена ────────────────────────────────────────────────────────
export async function getTokenBalance(
  address: string,
  contractAddress: string,
  chain: string
): Promise<Balance> {
  chain = normalizeChain(chain)
  const family = getFamily(chain)
  switch (family) {
    case "tron":   return tron.tronGetTrc20Balance(address, contractAddress, isTestnet(chain) ? "testnet" : "mainnet")
    case "solana": return sol.solGetTokenBalance(address, contractAddress, isTestnet(chain))
    case "sui":    return sui.suiGetTokenBalance(address, contractAddress)
    case "bitcoin":
    case "litecoin":
    case "dogecoin":
    case "bitcoincash":
      throw new Error(`${family} does not support tokens`)
    case "xrp":
    case "stellar":
    case "algorand":
    case "near":
    case "polkadot":
    case "cardano":
    case "tezos":
    case "multiversx":
    case "vechain":
    case "cosmos":
    case "ton":
      throw new Error(`Token balance for ${family} not yet implemented`)
    default:
      return evm.evmGetTokenBalance(address, contractAddress, chain)
  }
}

// ─── 6. Оценка fee ────────────────────────────────────────────────────────────
export async function estimateFee(params: {
  chain: string
  from: string
  to: string
  amount?: string
  contractAddress?: string   // для token transfers
  data?: string
}): Promise<GasEstimate | Record<string, unknown>> {
  const { chain: rawChain, from, to, amount, contractAddress, data } = params
  const chain = normalizeChain(rawChain)

  switch (getFamily(chain)) {
    case "bitcoin":
      return btc.btcEstimateFee(isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash":
      return btc.utxoEstimateFee(chain)

    case "tron":
      if (contractAddress) {
        return tron.tronEstimateEnergy({
          ownerAddress: from,
          contractAddress,
          functionSelector: "transfer(address,uint256)",
          network: isTestnet(chain) ? "testnet" : "mainnet",
        })
      }
      return { energyRequired: 0, feeLimit: 0 } as any

    case "solana":
      return sol.solEstimateFee(isTestnet(chain)) as any

    case "xrp":         return xrp.xrpEstimateFee(isTestnet(chain))
    case "stellar":     return xlm.xlmEstimateFee(isTestnet(chain))
    case "algorand":    return algo.algoEstimateFee(isTestnet(chain))
    case "near":        return near.nearEstimateFee(isTestnet(chain))
    case "polkadot":    return dot.dotEstimateFee(chain)
    case "cardano":     return ada.adaEstimateFee(isTestnet(chain))
    case "tezos":       return xtz.xtzEstimateFee()
    case "multiversx":  return egld.egldEstimateFee()
    case "vechain":     return vet.vetEstimateFee()
    case "cosmos":      return atom.atomEstimateFee()
    case "sui":         return sui.suiEstimateFee()
    case "ton":         return ton.tonEstimateFee()

    default:
      return evm.evmEstimateGas({
        chain, from, to,
        valueEth: amount,
        data,
      })
  }
}

// ─── 7. Отправка native ──────────────────────────────────────────────────────
export async function sendNative(params: {
  chain: string
  // EVM/TRON/VeChain: privateKey; BTC/UTXO: mnemonic + fromAddress; Ed25519: mnemonic + fromIndex
  privateKey?: string
  mnemonic?: string
  fromIndex?: number
  fromAddress?: string
  changeAddress?: string
  to: string
  amount: string
}): Promise<TxResult> {
  const { chain: rawChain, privateKey, mnemonic, fromIndex = 0, to, amount } = params
  const chain = normalizeChain(rawChain)

  switch (getFamily(chain)) {
    case "bitcoin":
      if (!mnemonic) throw new Error("BTC sendNative requires mnemonic")
      return btc.btcSendTransaction({
        mnemonic, fromAddress: params.fromAddress!, fromIndex,
        toAddress: to, amountBtc: amount, changeAddress: params.changeAddress,
        isTestnet: isTestnet(chain),
      })

    case "litecoin":
    case "dogecoin":
    case "bitcoincash":
      if (!mnemonic) throw new Error("UTXO sendNative requires mnemonic")
      return btc.utxoSendTransaction({
        chain, mnemonic, fromAddress: params.fromAddress!, fromIndex,
        toAddress: to, amount, changeAddress: params.changeAddress,
      })

    case "tron":
      if (!privateKey) throw new Error("TRON sendNative requires privateKey")
      return tron.tronSendNative({
        privateKey, to, amountTrx: amount,
        network: isTestnet(chain) ? "testnet" : "mainnet",
      })

    case "solana":
      if (!mnemonic) throw new Error("SOL sendNative requires mnemonic")
      return sol.solSendNative({
        mnemonic, fromIndex, toAddress: to, amountSol: amount,
        isTestnet: isTestnet(chain),
      })

    case "xrp":
      if (!privateKey) throw new Error("XRP sendNative requires privateKey")
      return xrp.xrpSendNative({ privateKey, to, amount, isTestnet: isTestnet(chain) })

    case "stellar":
      if (!privateKey) throw new Error("XLM sendNative requires privateKey (secret key)")
      return xlm.xlmSendNative({ secretKey: privateKey, to, amount, isTestnet: isTestnet(chain) })

    case "algorand":
      if (!mnemonic) throw new Error("ALGO sendNative requires mnemonic")
      return algo.algoSendNative({ mnemonic, fromIndex, to, amount, isTestnet: isTestnet(chain) })

    case "near":
      if (!mnemonic) throw new Error("NEAR sendNative requires mnemonic")
      return near.nearSendNative({ mnemonic, fromIndex, to, amount, isTestnet: isTestnet(chain) })

    case "polkadot":
      throw new Error("Polkadot sendNative requires @polkadot/api for extrinsic building — not yet implemented")

    case "cardano":
      throw new Error("Cardano sendNative requires @emurgo/cardano-serialization-lib for transaction building")

    case "tezos":
      if (!privateKey) throw new Error("XTZ sendNative requires privateKey")
      return xtz.xtzSendNative(privateKey, to, amount)

    case "multiversx":
      if (!mnemonic) throw new Error("EGLD sendNative requires mnemonic")
      return egld.egldSendNative(mnemonic, fromIndex, to, amount)

    case "vechain":
      if (!privateKey) throw new Error("VET sendNative requires privateKey")
      return vet.vetSendNative(privateKey, to, amount)

    case "cosmos":
      if (!mnemonic) throw new Error("ATOM sendNative requires mnemonic")
      return atom.atomSendNative(mnemonic, fromIndex, to, amount)

    case "sui":
      if (!mnemonic) throw new Error("SUI sendNative requires mnemonic")
      return sui.suiSendNative(mnemonic, fromIndex, to, amount)

    case "ton":
      if (!mnemonic) throw new Error("TON sendNative requires mnemonic")
      return ton.tonSendNative(mnemonic, fromIndex, to, amount)

    default:
      if (!privateKey) throw new Error("EVM sendNative requires privateKey")
      return evm.evmSendNative({ chain, privateKey, to, amountEth: amount })
  }
}

// ─── 8. Отправка токена ──────────────────────────────────────────────────────
export async function sendToken(params: {
  chain: string
  privateKey?: string
  mnemonic?: string
  fromIndex?: number
  to: string
  contractAddress: string
  amount: string
  decimals?: number
}): Promise<TxResult> {
  const { chain: rawChain, privateKey, mnemonic, fromIndex = 0, to, contractAddress, amount, decimals } = params
  const chain = normalizeChain(rawChain)
  const family = getFamily(chain)

  switch (family) {
    case "tron":
      if (!privateKey) throw new Error("TRON sendToken requires privateKey")
      return tron.tronSendTrc20({
        privateKey, to, contractAddress, amount,
        decimals: decimals ?? 6,
        network: isTestnet(chain) ? "testnet" : "mainnet",
      })

    case "solana":
      if (!mnemonic) throw new Error("SOL sendToken requires mnemonic")
      return sol.solSendToken({
        mnemonic, fromIndex, toAddress: to,
        mintAddress: contractAddress, amount,
        isTestnet: isTestnet(chain),
      })

    case "bitcoin":
    case "litecoin":
    case "dogecoin":
    case "bitcoincash":
      throw new Error(`${family} does not support tokens`)

    default:
      if (!privateKey) throw new Error("EVM sendToken requires privateKey")
      return evm.evmSendToken({ chain, privateKey, to, contractAddress, amount })
  }
}

// ─── 9. Статус транзакции ────────────────────────────────────────────────────
export async function getTxStatus(txId: string, chain: string) {
  chain = normalizeChain(chain)
  switch (getFamily(chain)) {
    case "bitcoin":     return btc.btcGetTxStatus(txId, isTestnet(chain))
    case "litecoin":
    case "dogecoin":
    case "bitcoincash": return btc.utxoGetTxStatus(txId, chain)
    case "tron":        return tron.tronGetTxInfo(txId, isTestnet(chain) ? "testnet" : "mainnet")
    case "solana":      return sol.solGetTxStatus(txId, isTestnet(chain))
    case "xrp":         return xrp.xrpGetTxStatus(txId, isTestnet(chain))
    case "stellar":     return xlm.xlmGetTxStatus(txId, isTestnet(chain))
    case "algorand":    return algo.algoGetTxStatus(txId, isTestnet(chain))
    case "near":        return near.nearGetTxStatus(txId, isTestnet(chain))
    case "polkadot":    return dot.dotGetTxStatus(txId, chain)
    case "cardano":     return ada.adaGetTxStatus(txId, isTestnet(chain))
    case "tezos":       return xtz.xtzGetTxStatus(txId)
    case "multiversx":  return egld.egldGetTxStatus(txId)
    case "vechain":     return vet.vetGetTxStatus(txId)
    case "cosmos":      return atom.atomGetTxStatus(txId)
    case "sui":         return sui.suiGetTxStatus(txId)
    case "ton":         return ton.tonGetTxStatus(txId)
    default:            return evm.evmGetReceipt(txId, chain)
  }
}

// ─── Re-exports для прямого доступа ─────────────────────────────────────────
export { evm, tron, btc, sol, xrp, xlm, algo, near, dot, ada, xtz, egld, vet, atom, sui, ton }
export * from "./types"
