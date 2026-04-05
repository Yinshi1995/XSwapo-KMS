/**
 * chains/bitcoin.ts
 * UTXO chains: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash.
 *
 * All use the same UTXO transaction model with different:
 *  - Derivation paths (BIP-44/84)
 *  - Network parameters (magic bytes, address prefixes)
 *  - RPC endpoints
 *
 * BTC: BIP-84 m/84'/0'/0' (Native SegWit bc1...)
 * LTC: BIP-84 m/84'/2'/0' (Native SegWit ltc1...)
 * DOGE: BIP-44 m/44'/3'/0' (Legacy D...)
 * BCH: BIP-44 m/44'/145'/0' (Legacy 1... / cashaddr bitcoincash:q...)
 *
 * bun add bitcoinjs-lib ecpair tiny-secp256k1 @bitcoinerlab/secp256k1
 */

import * as bitcoin from "bitcoinjs-lib"
import * as ecc from "tiny-secp256k1"
import { BIP32Factory } from "bip32"
import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import * as bchaddr from "bchaddrjs"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, TATUM_DATA_API, TATUM_REST_API, gatewayUrl } from "../gateway"

bitcoin.initEccLib(ecc)
const bip32 = BIP32Factory(ecc)

// ─── Multi-chain UTXO configuration ──────────────────────────────────────────

interface UtxoChainConfig {
  rpc: string
  testnetRpc: string
  dataChain: string
  testnetDataChain: string
  derivationPath: string
  testnetDerivationPath: string
  network: bitcoin.Network
  testnetNetwork: bitcoin.Network
  addressType: "p2wpkh" | "p2pkh" // Native SegWit or Legacy
}

// Litecoin network params
const litecoinNetwork: bitcoin.Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x04b24746, private: 0x04b2430c }, // Ltub/Ltpv (BIP-84)
  pubKeyHash: 0x30,  // L
  scriptHash: 0x32,  // M
  wif: 0xb0,
}

const litecoinTestnet: bitcoin.Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "tltc",
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
}

// Dogecoin network params
const dogecoinNetwork: bitcoin.Network = {
  messagePrefix: "\x19Dogecoin Signed Message:\n",
  bech32: "doge", // unused — Doge uses legacy P2PKH
  bip32: { public: 0x02facafd, private: 0x02fac398 }, // dgub/dgpv
  pubKeyHash: 0x1e,  // D
  scriptHash: 0x16,  // 9 or A
  wif: 0x9e,
}

const dogecoinTestnet: bitcoin.Network = {
  messagePrefix: "\x19Dogecoin Signed Message:\n",
  bech32: "doget",
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x71,
  scriptHash: 0xc4,
  wif: 0xf1,
}

// Bitcoin Cash uses the same network params as BTC mainnet (legacy addresses)
const bitcoincashNetwork: bitcoin.Network = { ...bitcoin.networks.bitcoin }
const bitcoincashTestnet: bitcoin.Network = { ...bitcoin.networks.testnet }

const UTXO_CHAINS: Record<string, UtxoChainConfig> = {
  bitcoin: {
    rpc: gatewayUrl("bitcoin-mainnet"),
    testnetRpc: gatewayUrl("bitcoin-testnet"),
    dataChain: "bitcoin-mainnet",
    testnetDataChain: "bitcoin-testnet",
    derivationPath: "m/84'/0'/0'",
    testnetDerivationPath: "m/84'/1'/0'",
    network: bitcoin.networks.bitcoin,
    testnetNetwork: bitcoin.networks.testnet,
    addressType: "p2wpkh",
  },
  litecoin: {
    rpc: gatewayUrl("litecoin-mainnet"),
    testnetRpc: gatewayUrl("litecoin-testnet"),
    dataChain: "litecoin-mainnet",
    testnetDataChain: "litecoin-testnet",
    derivationPath: "m/84'/2'/0'",
    testnetDerivationPath: "m/84'/1'/0'",
    network: litecoinNetwork,
    testnetNetwork: litecoinTestnet,
    addressType: "p2wpkh",
  },
  dogecoin: {
    rpc: gatewayUrl("dogecoin-mainnet"),
    testnetRpc: gatewayUrl("dogecoin-testnet"),
    dataChain: "dogecoin-mainnet",
    testnetDataChain: "dogecoin-testnet",
    derivationPath: "m/44'/3'/0'",
    testnetDerivationPath: "m/44'/1'/0'",
    network: dogecoinNetwork,
    testnetNetwork: dogecoinTestnet,
    addressType: "p2pkh",
  },
  bitcoincash: {
    rpc: gatewayUrl("bch-mainnet"),
    testnetRpc: gatewayUrl("bch-testnet"),
    dataChain: "bch-mainnet",
    testnetDataChain: "bch-testnet",
    derivationPath: "m/44'/145'/0'",
    testnetDerivationPath: "m/44'/1'/0'",
    network: bitcoincashNetwork,
    testnetNetwork: bitcoincashTestnet,
    addressType: "p2pkh",
  },
}

function getChainConfig(chain: string): { config: UtxoChainConfig; testnet: boolean } {
  const testnet = chain.includes("testnet")
  if (chain.startsWith("litecoin")) return { config: UTXO_CHAINS.litecoin, testnet }
  if (chain.startsWith("dogecoin") || chain.startsWith("doge")) return { config: UTXO_CHAINS.dogecoin, testnet }
  if (chain.startsWith("bitcoin-cash") || chain.startsWith("bitcoincash") || chain.startsWith("bch")) return { config: UTXO_CHAINS.bitcoincash, testnet }
  return { config: UTXO_CHAINS.bitcoin, testnet }
}

// Tatum Bitcoin RPC (Bitcoin Core JSON-RPC совместимый)
const BTC_RPC = gatewayUrl("bitcoin-mainnet")
const BTC_TESTNET_RPC = gatewayUrl("bitcoin-testnet")

// BIP-84 для Native SegWit (bech32, адреса bc1...)
// Tatum использует именно его для BTC
const BTC_DERIVATION_PATH = "m/84'/0'/0'"
const BTC_TESTNET_DERIVATION_PATH = "m/84'/1'/0'"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNetwork(isTestnet = false) {
  return isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
}

async function rpcCall<T>(method: string, params: unknown[], isTestnet = false): Promise<T> {
  const url = isTestnet ? BTC_TESTNET_RPC : BTC_RPC
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = await res.json() as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`BTC RPC ${method}: ${data.error.message}`)
  return data.result as T
}

async function dataApi<T>(path: string): Promise<T> {
  const res = await fetch(`${TATUM_DATA_API}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`BTC Data API ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

// ─── 1. Генерация кошелька ────────────────────────────────────────────────────
// Bitcoin: mnemonic → seed → BIP32 master key → xpub/zpub
export function btcGenerateWallet(isTestnet = false): ChainWallet {
  const mnemonic = generateMnemonic(256) // 24 слова
  const seed = mnemonicToSeedSync(mnemonic)
  const network = getNetwork(isTestnet)
  const path = isTestnet ? BTC_TESTNET_DERIVATION_PATH : BTC_DERIVATION_PATH

  const root = bip32.fromSeed(seed, network)
  const account = root.derivePath(path)
  // zpub — расширенный публичный ключ для Native SegWit
  const xpub = account.neutered().toBase58()

  return { mnemonic, xpub }
}

// ─── 2. Деривация адреса ─────────────────────────────────────────────────────
// BIP-84: xpub → m/0/{index} → bech32 адрес (bc1q...)
export function btcDeriveAddress(xpub: string, index: number, isTestnet = false): DerivedAddress {
  const network = getNetwork(isTestnet)
  const node = bip32.fromBase58(xpub, network)
  const child = node.derive(0).derive(index)

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network,
  })
  if (!address) throw new Error(`Failed to derive BTC address at index ${index}`)
  return { address }
}

// ─── 3. Деривация приватного ключа ───────────────────────────────────────────
export function btcDerivePrivateKey(mnemonic: string, index: number, isTestnet = false): string {
  const seed = mnemonicToSeedSync(mnemonic)
  const network = getNetwork(isTestnet)
  const path = isTestnet ? BTC_TESTNET_DERIVATION_PATH : BTC_DERIVATION_PATH

  const root = bip32.fromSeed(seed, network)
  const child = root.derivePath(path).derive(0).derive(index)
  if (!child.privateKey) throw new Error("Failed to derive private key")
  return child.privateKey.toString("hex")
}

// ─── 4. Баланс адреса ─────────────────────────────────────────────────────────
// Tatum v3 REST API: GET /v3/bitcoin/address/balance/{address}
export async function btcGetBalance(address: string, isTestnet = false): Promise<Balance> {
  const chain = isTestnet ? "bitcoin-testnet" : "bitcoin"
  const res = await fetch(`${TATUM_REST_API}/${chain}/address/balance/${address}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`BTC balance API HTTP ${res.status}`)
  const data = await res.json() as { incoming: string; outgoing: string }
  const balance = (Number(data.incoming) - Number(data.outgoing)).toFixed(8)
  return {
    balance,
    raw: Math.round(Number(balance) * 1e8).toString(),
  }
}

// ─── 5. Список UTXO ───────────────────────────────────────────────────────────
export interface UTXO {
  txHash: string
  index: number
  value: number        // в BTC
  valueSats: number    // в satoshi
}

export async function btcGetUtxos(
  address: string,
  totalValueBtc: string,
  isTestnet = false
): Promise<UTXO[]> {
  const chain = isTestnet ? "bitcoin-testnet" : "bitcoin-mainnet"
  const data = await dataApi<Array<{
    txHash: string; index: number; value: number
  }>>(`/data/utxos?chain=${chain}&address=${address}&totalValue=${totalValueBtc}`)

  return data.map(u => ({
    txHash: u.txHash,
    index: u.index,
    value: u.value,
    valueSats: Math.round(u.value * 1e8),
  }))
}

// ─── 6. Оценка fee ────────────────────────────────────────────────────────────
export async function btcEstimateFee(isTestnet = false): Promise<{
  feePerByte: number    // satoshi per byte
  feeFor250Bytes: number // satoshi, типичная транзакция ~250 bytes
}> {
  // Используем Bitcoin Core RPC estimatesmartfee
  const result = await rpcCall<{ feerate?: number }>(
    "estimatesmartfee", [6], isTestnet // 6 блоков target
  )
  const feeRateBtcPerKb = result.feerate ?? 0.0001
  const feePerByte = Math.ceil((feeRateBtcPerKb * 1e8) / 1000)
  return { feePerByte, feeFor250Bytes: feePerByte * 250 }
}

// ─── 7. Отправка BTC ─────────────────────────────────────────────────────────
// UTXO модель: нужно вручную собрать транзакцию
export async function btcSendTransaction(params: {
  mnemonic: string
  fromAddress: string
  fromIndex: number
  toAddress: string
  amountBtc: string
  changeAddress?: string  // куда вернуть сдачу (обычно тот же fromAddress)
  feePerByte?: number     // satoshi/byte, если не указан — estimatesmartfee
  isTestnet?: boolean
}): Promise<TxResult> {
  const {
    mnemonic, fromAddress, fromIndex, toAddress, amountBtc,
    changeAddress, isTestnet = false
  } = params

  const network = getNetwork(isTestnet)
  const amountSats = Math.round(Number(amountBtc) * 1e8)

  // 1. Получаем UTXOs
  const utxos = await btcGetUtxos(fromAddress, amountBtc, isTestnet)
  if (!utxos.length) throw new Error("No UTXOs available")

  // 2. Получаем fee rate
  const { feePerByte } = params.feePerByte
    ? { feePerByte: params.feePerByte }
    : await btcEstimateFee(isTestnet)

  // 3. Деривируем ключ
  const seed = mnemonicToSeedSync(mnemonic)
  const root = bip32.fromSeed(seed, network)
  const path = isTestnet ? BTC_TESTNET_DERIVATION_PATH : BTC_DERIVATION_PATH
  const child = root.derivePath(path).derive(0).derive(fromIndex)
  if (!child.privateKey) throw new Error("Failed to derive private key")

  // 4. Строим транзакцию
  const psbt = new bitcoin.Psbt({ network })
  let inputTotal = 0

  for (const utxo of utxos) {
    // Для P2WPKH нужен witnessUtxo
    const txHex = await rpcCall<string>("getrawtransaction", [utxo.txHash, false], isTestnet)
    const prevTx = bitcoin.Transaction.fromHex(txHex)
    const prevOut = prevTx.outs[utxo.index]!

    psbt.addInput({
      hash: utxo.txHash,
      index: utxo.index,
      witnessUtxo: { script: prevOut.script, value: BigInt(utxo.valueSats) },
    })
    inputTotal += utxo.valueSats
    if (inputTotal >= amountSats) break
  }

  // 5. Считаем fee (примерно: 10 + inputs*68 + outputs*31 bytes)
  const estimatedSize = 10 + (psbt.inputCount * 68) + (2 * 31)
  const feeSats = Math.ceil(estimatedSize * feePerByte)
  const changeSats = inputTotal - amountSats - feeSats

  if (changeSats < 0) throw new Error(`Insufficient balance. Need ${amountSats + feeSats} sats, have ${inputTotal}`)

  // 6. Добавляем outputs
  psbt.addOutput({ address: toAddress, value: BigInt(amountSats) })
  if (changeSats > 546) { // dust limit
    psbt.addOutput({ address: changeAddress ?? fromAddress, value: BigInt(changeSats) })
  }

  // 7. Подписываем
  const keyPair = {
    publicKey: Buffer.from(child.publicKey),
    sign: (hash: Buffer) => {
      const sig = ecc.sign(hash, child.privateKey!)
      return Buffer.from(sig)
    },
  }
  psbt.signAllInputs(keyPair as any)
  psbt.finalizeAllInputs()

  // 8. Broadcast через RPC
  const rawTx = psbt.extractTransaction().toHex()
  const txId = await rpcCall<string>("sendrawtransaction", [rawTx], isTestnet)

  return { txId }
}

// ─── 8. Статус транзакции ─────────────────────────────────────────────────────
export async function btcGetTxStatus(txId: string, isTestnet = false) {
  const tx = await rpcCall<{ confirmations?: number; blockhash?: string } | null>(
    "getrawtransaction", [txId, true], isTestnet
  ).catch(() => null)

  if (!tx) return { status: "pending" as const, confirmations: 0 }
  const confirmations = tx.confirmations ?? 0
  return {
    status: confirmations >= 1 ? "confirmed" as const : "pending" as const,
    confirmations,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generic UTXO chain functions (LTC, DOGE, BCH)
// Same UTXO model as BTC, different network params and derivation paths.
// ═══════════════════════════════════════════════════════════════════════════════

async function utxoRpcCall<T>(method: string, params: unknown[], chain: string): Promise<T> {
  const { config, testnet } = getChainConfig(chain)
  const url = testnet ? config.testnetRpc : config.rpc
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = await res.json() as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`UTXO RPC ${method}: ${data.error.message}`)
  return data.result as T
}

export function utxoGenerateWallet(chain: string): ChainWallet {
  const { config, testnet } = getChainConfig(chain)
  const mnemonic = generateMnemonic(256)
  const seed = mnemonicToSeedSync(mnemonic)
  const network = testnet ? config.testnetNetwork : config.network
  const path = testnet ? config.testnetDerivationPath : config.derivationPath
  const root = bip32.fromSeed(seed, network)
  const account = root.derivePath(path)
  return { mnemonic, xpub: account.neutered().toBase58() }
}

export function utxoDeriveAddress(xpub: string, index: number, chain: string): DerivedAddress {
  const { config, testnet } = getChainConfig(chain)
  const network = testnet ? config.testnetNetwork : config.network
  const node = bip32.fromBase58(xpub, network)
  const child = node.derive(0).derive(index)

  if (config.addressType === "p2wpkh") {
    const { address } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(child.publicKey),
      network,
    })
    if (!address) throw new Error(`Failed to derive address for ${chain} at index ${index}`)
    return { address }
  }

  // Legacy P2PKH for DOGE, BCH
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network,
  })
  if (!address) throw new Error(`Failed to derive address for ${chain} at index ${index}`)
  return { address }
}

export function utxoDerivePrivateKey(mnemonic: string, index: number, chain: string): string {
  const { config, testnet } = getChainConfig(chain)
  const seed = mnemonicToSeedSync(mnemonic)
  const network = testnet ? config.testnetNetwork : config.network
  const path = testnet ? config.testnetDerivationPath : config.derivationPath
  const root = bip32.fromSeed(seed, network)
  const child = root.derivePath(path).derive(0).derive(index)
  if (!child.privateKey) throw new Error("Failed to derive private key")
  return child.privateKey.toString("hex")
}

// Tatum v3 REST API chain name mapping
const UTXO_REST_CHAIN: Record<string, string> = {
  litecoin: "litecoin",
  dogecoin: "dogecoin",
  bitcoincash: "bcash",
}

export async function utxoGetBalance(address: string, chain: string): Promise<Balance> {
  const { config, testnet } = getChainConfig(chain)
  const baseName = chain.replace(/-mainnet|-testnet/g, "").replace("bitcoin-cash", "bitcoincash").replace("bch", "bitcoincash")
  const restChain = UTXO_REST_CHAIN[baseName]

  // BCH: use Rostrum RPC via bitcoin-cash-mainnet-rostrum gateway
  if (baseName === "bitcoincash") {
    const bchUrl = testnet ? config.testnetRpc : gatewayUrl("bitcoin-cash-mainnet-rostrum")
    // Rostrum requires cashaddr format (without prefix)
    let cashAddr = address
    try {
      const full = bchaddr.toCashAddress(address)
      cashAddr = full.replace("bitcoincash:", "")
    } catch { /* already cashaddr or will fail at Rostrum */ }
    const res = await fetch(bchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "blockchain.address.get_balance",
        params: [cashAddr],
      }),
    })
    if (!res.ok) throw new Error(`BCH Rostrum balance HTTP ${res.status}`)
    const data = await res.json() as { result?: { confirmed: number; unconfirmed: number }; error?: any }
    if (data.error) throw new Error(`BCH Rostrum: ${JSON.stringify(data.error)}`)
    const satoshis = (data.result?.confirmed ?? 0) + (data.result?.unconfirmed ?? 0)
    return {
      balance: (satoshis / 1e8).toFixed(8),
      raw: satoshis.toString(),
    }
  }

  // LTC, DOGE: use Tatum v3 REST API
  if (!restChain) throw new Error(`No REST API mapping for ${chain}`)
  const suffix = testnet ? "-testnet" : ""
  const res = await fetch(`${TATUM_REST_API}/${restChain}${suffix}/address/balance/${address}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`UTXO balance API HTTP ${res.status} for ${chain}`)
  const data = await res.json() as { incoming: string; outgoing: string }
  const balance = (Number(data.incoming) - Number(data.outgoing)).toFixed(8)
  return {
    balance,
    raw: Math.round(Number(balance) * 1e8).toString(),
  }
}

export async function utxoEstimateFee(chain: string): Promise<{
  feePerByte: number; feeFor250Bytes: number
}> {
  const result = await utxoRpcCall<{ feerate?: number }>(
    "estimatesmartfee", [6], chain,
  )
  const feeRatePerKb = result.feerate ?? 0.0001
  const feePerByte = Math.ceil((feeRatePerKb * 1e8) / 1000)
  return { feePerByte, feeFor250Bytes: feePerByte * 250 }
}

export async function utxoGetUtxos(address: string, totalValue: string, chain: string): Promise<UTXO[]> {
  const { config, testnet } = getChainConfig(chain)
  const dataChain = testnet ? config.testnetDataChain : config.dataChain
  const data = await dataApi<Array<{
    txHash: string; index: number; value: number
  }>>(`/data/utxos?chain=${dataChain}&address=${address}&totalValue=${totalValue}`)
  return data.map(u => ({
    txHash: u.txHash,
    index: u.index,
    value: u.value,
    valueSats: Math.round(u.value * 1e8),
  }))
}

export async function utxoSendTransaction(params: {
  chain: string
  mnemonic: string
  fromAddress: string
  fromIndex: number
  toAddress: string
  amount: string
  changeAddress?: string
  feePerByte?: number
}): Promise<TxResult> {
  const { chain, mnemonic, fromAddress, fromIndex, toAddress, amount, changeAddress } = params
  const { config, testnet } = getChainConfig(chain)
  const network = testnet ? config.testnetNetwork : config.network
  const amountSats = Math.round(Number(amount) * 1e8)

  const utxos = await utxoGetUtxos(fromAddress, amount, chain)
  if (!utxos.length) throw new Error("No UTXOs available")

  const { feePerByte } = params.feePerByte
    ? { feePerByte: params.feePerByte }
    : await utxoEstimateFee(chain)

  const seed = mnemonicToSeedSync(mnemonic)
  const path = testnet ? config.testnetDerivationPath : config.derivationPath
  const root = bip32.fromSeed(seed, network)
  const child = root.derivePath(path).derive(0).derive(fromIndex)
  if (!child.privateKey) throw new Error("Failed to derive private key")

  const psbt = new bitcoin.Psbt({ network })
  let inputTotal = 0

  for (const utxo of utxos) {
    if (config.addressType === "p2wpkh") {
      const txHex = await utxoRpcCall<string>("getrawtransaction", [utxo.txHash, false], chain)
      const prevTx = bitcoin.Transaction.fromHex(txHex)
      const prevOut = prevTx.outs[utxo.index]!
      psbt.addInput({
        hash: utxo.txHash,
        index: utxo.index,
        witnessUtxo: { script: prevOut.script, value: BigInt(utxo.valueSats) },
      })
    } else {
      // Legacy: use nonWitnessUtxo
      const txHex = await utxoRpcCall<string>("getrawtransaction", [utxo.txHash, false], chain)
      psbt.addInput({
        hash: utxo.txHash,
        index: utxo.index,
        nonWitnessUtxo: Buffer.from(txHex, "hex"),
      })
    }
    inputTotal += utxo.valueSats
    if (inputTotal >= amountSats) break
  }

  const estimatedSize = 10 + (psbt.inputCount * (config.addressType === "p2wpkh" ? 68 : 148)) + (2 * 34)
  const feeSats = Math.ceil(estimatedSize * feePerByte)
  const changeSats = inputTotal - amountSats - feeSats

  if (changeSats < 0) throw new Error(`Insufficient balance. Need ${amountSats + feeSats} sats, have ${inputTotal}`)

  psbt.addOutput({ address: toAddress, value: BigInt(amountSats) })
  if (changeSats > 546) {
    psbt.addOutput({ address: changeAddress ?? fromAddress, value: BigInt(changeSats) })
  }

  const keyPair = {
    publicKey: Buffer.from(child.publicKey),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, child.privateKey!)),
  }
  psbt.signAllInputs(keyPair as any)
  psbt.finalizeAllInputs()

  const rawTx = psbt.extractTransaction().toHex()
  const txId = await utxoRpcCall<string>("sendrawtransaction", [rawTx], chain)
  return { txId }
}

export async function utxoGetTxStatus(txId: string, chain: string) {
  const tx = await utxoRpcCall<{ confirmations?: number } | null>(
    "getrawtransaction", [txId, true], chain,
  ).catch(() => null)
  if (!tx) return { status: "pending" as const, confirmations: 0 }
  const confirmations = tx.confirmations ?? 0
  return {
    status: confirmations >= 1 ? "confirmed" as const : "pending" as const,
    confirmations,
  }
}
