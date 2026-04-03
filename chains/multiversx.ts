/**
 * chains/multiversx.ts
 * MultiversX (formerly Elrond) / EGLD — Ed25519 BIP-32 (SLIP-0010).
 *
 * Tatum derivation: m/44'/508'/0'/0'  (then /{index}')
 * RPC: egld-mainnet.gateway.tatum.io (MultiversX Gateway/Proxy API)
 * Address format: erd1... (Bech32 with "erd" HRP)
 *
 * bun add @multiversx/sdk-core @multiversx/sdk-wallet
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const EGLD_RPC = gatewayUrl("egld-mainnet")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function egldGet<T>(path: string): Promise<T> {
  const res = await fetch(`${EGLD_RPC}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`MultiversX GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function egldPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${EGLD_RPC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`MultiversX POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function bech32Encode(hrp: string, data: Uint8Array): string {
  // MultiversX uses bech32 encoding with "erd" HRP
  const { bech32 } = require("bech32")
  const words = bech32.toWords(Buffer.from(data))
  return bech32.encode(hrp, words, 256)
}

function deriveKeys(mnemonic: string, index: number) {
  const seed = mnemonicToSeedSync(mnemonic)
  const path = `m/44'/508'/0'/0'/${index}'`
  const { key } = derivePath(path, seed.toString("hex"))

  // Ed25519 keypair from seed
  const nacl = require("tweetnacl")
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(key))

  const address = bech32Encode("erd", keyPair.publicKey)
  return {
    address,
    publicKey: Buffer.from(keyPair.publicKey).toString("hex"),
    privateKey: Buffer.from(keyPair.secretKey).toString("hex"),
    secretKey: keyPair.secretKey,
  }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function egldGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  // Ed25519 → no xpub. Store mnemonic.
  return { mnemonic, xpub: mnemonic }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function egldDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const { address } = deriveKeys(mnemonic, index)
  return { address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function egldDerivePrivateKey(mnemonic: string, index: number): string {
  const { privateKey } = deriveKeys(mnemonic, index)
  return privateKey
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function egldGetBalance(address: string): Promise<Balance> {
  // MultiversX API: GET /address/{address}/balance
  const result = await egldGet<{ data: { balance: string } }>(`/address/${address}/balance`)
  const raw = result.data.balance // in denomination (10^18)
  return {
    balance: (Number(BigInt(raw)) / 1e18).toString(),
    raw,
  }
}

// ─── 5. Fee estimation ───────────────────────────────────────────────────────
export async function egldEstimateFee(): Promise<{ fee: string; feeEgld: string }> {
  // MultiversX: 50000 gas price * 50000 gas limit = 2.5 billion (0.0025 EGLD for simple transfer)
  // Get network config for accurate values
  try {
    const config = await egldGet<{ data: { config: { erd_min_gas_price: number; erd_min_gas_limit: number } } }>("/network/config")
    const gasPrice = config.data.config.erd_min_gas_price
    const gasLimit = config.data.config.erd_min_gas_limit
    const feeRaw = BigInt(gasPrice) * BigInt(gasLimit)
    return {
      fee: feeRaw.toString(),
      feeEgld: (Number(feeRaw) / 1e18).toString(),
    }
  } catch {
    return { fee: "50000000000000", feeEgld: "0.00005" }
  }
}

// ─── 6. Send native ──────────────────────────────────────────────────────────
export async function egldSendNative(
  mnemonic: string,
  index: number,
  to: string,
  amount: string,
): Promise<TxResult> {
  const keys = deriveKeys(mnemonic, index)

  // Get account nonce
  const account = await egldGet<{ data: { account: { nonce: number } } }>(`/address/${keys.address}`)
  const nonce = account.data.account.nonce

  // Get network config
  const config = await egldGet<{ data: { config: { erd_chain_id: string; erd_min_gas_price: number; erd_min_gas_limit: number } } }>("/network/config")
  const { erd_chain_id, erd_min_gas_price, erd_min_gas_limit } = config.data.config

  // Amount in denomination (10^18)
  const value = BigInt(Math.floor(Number(amount) * 1e18)).toString()

  const tx = {
    nonce,
    value,
    receiver: to,
    sender: keys.address,
    gasPrice: erd_min_gas_price,
    gasLimit: erd_min_gas_limit,
    chainID: erd_chain_id,
    version: 1,
  }

  // Serialize and sign
  const txSerialized = JSON.stringify(tx)
  const nacl = require("tweetnacl")
  const signature = nacl.sign.detached(
    new TextEncoder().encode(txSerialized),
    keys.secretKey,
  )

  const signedTx = { ...tx, signature: Buffer.from(signature).toString("hex") }

  const result = await egldPost<{ data: { txHash: string } }>("/transaction/send", signedTx)
  return { txId: result.data.txHash }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function egldGetTxStatus(txHash: string) {
  try {
    const result = await egldGet<{ data: { transaction: { status: string } } }>(`/transaction/${txHash}`)
    const status = result.data.transaction.status
    return {
      status: status === "success" ? ("confirmed" as const) : ("pending" as const),
    }
  } catch {
    return { status: "pending" as const }
  }
}
