/**
 * chains/tron.ts
 * TRON — НЕ EVM-совместим для wallet/tx.
 * Использует собственный HTTP REST API Tatum Gateway.
 *
 * RPC URL: https://tron-mainnet.gateway.tatum.io
 *
 * Особенности:
 *  - Адреса в base58 формате (T...)
 *  - Деривация: BIP-44 path m/44'/195'/0'
 *  - Транзакции: создать → подписать → broadcast
 *  - TRC-20 токены (USDT на TRON) через /wallet/triggersmartcontract
 *  - Energy вместо gas
 *
 * bun add tronweb
 */

import { HDNodeWallet, Mnemonic } from "ethers"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"

// @ts-ignore — tronweb не имеет типов по умолчанию
import * as _TronWebModule from "tronweb"
const TronWeb = (_TronWebModule as any).TronWeb || (_TronWebModule as any).default || _TronWebModule

import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const TRON_RPC = gatewayUrl("tron-mainnet")
const TRON_TESTNET_RPC = gatewayUrl("tron-testnet")

// BIP-44 coin type для TRON = 195
const TRON_DERIVATION_PATH = "m/44'/195'/0'"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpcUrl(network: "mainnet" | "testnet" = "mainnet"): string {
  return network === "mainnet" ? TRON_RPC : TRON_TESTNET_RPC
}

async function tronPost<T>(path: string, body: unknown, network: "mainnet" | "testnet" = "mainnet"): Promise<T> {
  const res = await fetch(`${getRpcUrl(network)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`TRON POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function tronGet<T>(path: string, network: "mainnet" | "testnet" = "mainnet"): Promise<T> {
  const res = await fetch(`${getRpcUrl(network)}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`TRON GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function getTronWebInstance(privateKey: string, network: "mainnet" | "testnet" = "mainnet"): TronWeb {
  return new TronWeb({
    fullHost: getRpcUrl(network),
    headers: { "x-api-key": TATUM_API_KEY },
    privateKey: privateKey.replace(/^0x/, ""),
  })
}

// ─── 1. Генерация кошелька (локально через ethers + конвертация в TRON адрес) ─
export function tronGenerateWallet(): ChainWallet {
  const w = HDNodeWallet.createRandom()
  if (!w.mnemonic) throw new Error("mnemonic generation failed")
  const hd = HDNodeWallet.fromMnemonic(w.mnemonic, TRON_DERIVATION_PATH)
  // xpub для TRON — используем стандартный BIP-32 extended key
  return { mnemonic: w.mnemonic.phrase, xpub: hd.neuter().extendedKey }
}

// ─── 2. Деривация адреса (локально) ──────────────────────────────────────────
// TRON адреса = secp256k1 публичный ключ → keccak256 → base58check с префиксом 0x41
export function tronDeriveAddress(xpub: string, index: number): DerivedAddress {
  const hd = HDNodeWallet.fromExtendedKey(xpub)
  const child = hd.deriveChild(0).deriveChild(index)
  // Конвертируем ETH hex → TRON base58 напрямую
  const ethHex = child.address.toLowerCase().replace("0x", "")
  const tronAddress = TronWeb.address.fromHex("41" + ethHex)
  return { address: tronAddress }
}

// ─── 3. Деривация приватного ключа ───────────────────────────────────────────
export function tronDerivePrivateKey(mnemonic: string, index: number): string {
  const hd = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), TRON_DERIVATION_PATH)
  return hd.deriveChild(0).deriveChild(index).privateKey!.replace("0x", "")
}

// ─── 4. Баланс TRX ───────────────────────────────────────────────────────────
export async function tronGetBalance(
  address: string,
  network: "mainnet" | "testnet" = "mainnet"
): Promise<Balance> {
  const data = await tronPost<{ balance?: number }>(
    "/wallet/getaccount",
    { address, visible: true },
    network
  )
  const balanceSun = data.balance ?? 0
  // TRX: 1 TRX = 1_000_000 SUN
  return {
    balance: (balanceSun / 1_000_000).toString(),
    raw: balanceSun.toString(),
  }
}

// ─── 5. Баланс TRC-20 (USDT и др.) ──────────────────────────────────────────
export async function tronGetTrc20Balance(
  address: string,
  contractAddress: string,
  network: "mainnet" | "testnet" = "mainnet"
): Promise<Balance> {
  // balanceOf(address) = функция ERC-20/TRC-20
  const parameter = [{ type: "address", value: address }]
  const result = await tronPost<{
    result?: { result: boolean }
    constant_result?: string[]
  }>(
    "/wallet/triggerconstantcontract",
    {
      owner_address: address,
      contract_address: contractAddress,
      function_selector: "balanceOf(address)",
      parameter: encodeAbiParameter(address),
      visible: true,
    },
    network
  )
  const hex = result.constant_result?.[0] ?? "0"
  const raw = BigInt("0x" + hex)
  // USDT на TRON имеет 6 decimals
  return { balance: (Number(raw) / 1_000_000).toString(), raw: raw.toString() }
}

// ─── 6. Оценка Energy (аналог gas для TRON) ──────────────────────────────────
export async function tronEstimateEnergy(params: {
  ownerAddress: string
  contractAddress: string
  functionSelector: string
  parameter?: string
  network?: "mainnet" | "testnet"
}): Promise<{ energyRequired: number; feeLimit: number }> {
  const { ownerAddress, contractAddress, functionSelector, parameter = "", network = "mainnet" } = params
  const result = await tronPost<{ energy_required?: number }>(
    "/wallet/estimateenergy",
    {
      owner_address: ownerAddress,
      contract_address: contractAddress,
      function_selector: functionSelector,
      parameter,
      visible: true,
    },
    network
  )
  const energy = result.energy_required ?? 65000
  // feeLimit в SUN (1 TRX = 1_000_000 SUN), стандартный лимит для TRC-20 transfer
  return { energyRequired: energy, feeLimit: 150_000_000 }
}

// ─── 7. Отправка TRX (native) ─────────────────────────────────────────────────
export async function tronSendNative(params: {
  privateKey: string
  to: string
  amountTrx: string
  network?: "mainnet" | "testnet"
}): Promise<TxResult> {
  const { privateKey, to, amountTrx, network = "mainnet" } = params
  const tronWeb = getTronWebInstance(privateKey, network)
  const amountSun = Math.round(Number(amountTrx) * 1_000_000)

  const tx = await tronWeb.transactionBuilder.sendTrx(to, amountSun)
  const signed = await tronWeb.trx.sign(tx)
  const result = await tronWeb.trx.sendRawTransaction(signed)

  if (!result.result) throw new Error(`TRON sendTRX failed: ${JSON.stringify(result)}`)
  return { txId: result.txid }
}

// ─── 8. Отправка TRC-20 (USDT и др.) ─────────────────────────────────────────
export async function tronSendTrc20(params: {
  privateKey: string
  to: string
  contractAddress: string
  amount: string        // в читаемых единицах
  decimals?: number     // дефолт 6 для USDT
  network?: "mainnet" | "testnet"
}): Promise<TxResult> {
  const { privateKey, to, contractAddress, amount, decimals = 6, network = "mainnet" } = params
  const tronWeb = getTronWebInstance(privateKey, network)

  const amountRaw = BigInt(Math.round(Number(amount) * Math.pow(10, decimals)))

  const tx = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddress,
    "transfer(address,uint256)",
    { feeLimit: 150_000_000, callValue: 0 },
    [
      { type: "address", value: to },
      { type: "uint256", value: amountRaw.toString() },
    ]
  )
  const signed = await tronWeb.trx.sign(tx.transaction)
  const result = await tronWeb.trx.sendRawTransaction(signed)

  if (!result.result) throw new Error(`TRON TRC-20 transfer failed: ${JSON.stringify(result)}`)
  return { txId: result.txid }
}

// ─── 9. Receipt / статус транзакции ──────────────────────────────────────────
export async function tronGetTxInfo(
  txId: string,
  network: "mainnet" | "testnet" = "mainnet"
) {
  const data = await tronPost<{
    id?: string
    receipt?: { result?: string }
    blockNumber?: number
  }>(
    "/wallet/gettransactioninfobyid",
    { value: txId, visible: true },
    network
  )
  if (!data.id) return { status: "pending" as const, blockNumber: null }
  return {
    status: data.receipt?.result === "SUCCESS" ? "confirmed" as const : "failed" as const,
    blockNumber: data.blockNumber ?? null,
  }
}

// ─── Вспомогательная: encode address parameter для TRC-20 calls ──────────────
function encodeAbiParameter(address: string): string {
  // Убираем T... prefix и конвертируем в 32-байтовый hex
  const tronWeb = new TronWeb({ fullHost: TRON_RPC })
  const hexAddress = TronWeb.address.toHex(address).replace(/^41/, "")
  return hexAddress.padStart(64, "0")
}
