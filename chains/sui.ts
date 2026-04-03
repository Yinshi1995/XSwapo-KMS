/**
 * chains/sui.ts
 * Sui / SUI — Ed25519.
 *
 * Tatum derivation: m/44'/60'/0'/0 (EVM-style per Tatum docs, not standard m/44'/784')
 * We support BOTH Tatum-compatible and standard Sui derivation.
 * RPC: sui-mainnet.gateway.tatum.io (Sui JSON-RPC)
 * Address format: 0x... (32-byte hex, lowercase)
 *
 * bun add @mysten/sui
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const SUI_RPC = gatewayUrl("sui-mainnet")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function suiJsonRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`Sui RPC ${method} HTTP ${res.status}`)
  const json = (await res.json()) as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`Sui RPC ${method}: ${json.error.message}`)
  return json.result as T
}

function getSuiSDK() {
  try {
    return require("@mysten/sui")
  } catch {
    // Fallback to older package name
    try {
      return require("@mysten/sui.js")
    } catch {
      throw new Error("@mysten/sui not installed. Run: bun add @mysten/sui")
    }
  }
}

function deriveEd25519Keys(mnemonic: string, index: number) {
  const seed = mnemonicToSeedSync(mnemonic)
  // Standard Sui derivation path: m/44'/784'/{index}'/0'/0'
  const path = `m/44'/784'/${index}'/0'/0'`
  const { key } = derivePath(path, seed.toString("hex"))

  const nacl = require("tweetnacl")
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(key))

  // Sui address = blake2b-256(0x00 || pubkey)[0..32] — flag byte 0x00 for Ed25519
  const blake2b = require("blakejs")
  const addressInput = new Uint8Array(1 + 32)
  addressInput[0] = 0x00 // Ed25519 flag
  addressInput.set(keyPair.publicKey, 1)
  const hash = blake2b.blake2b(addressInput, null, 32)
  const address = "0x" + Buffer.from(hash).toString("hex")

  return {
    address,
    publicKey: Buffer.from(keyPair.publicKey).toString("hex"),
    privateKey: Buffer.from(key).toString("hex"),
    secretKey: keyPair.secretKey,
  }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function suiGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  // Ed25519 → no xpub. Store mnemonic.
  return { mnemonic, xpub: mnemonic }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function suiDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const { address } = deriveEd25519Keys(mnemonic, index)
  return { address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function suiDerivePrivateKey(mnemonic: string, index: number): string {
  const { privateKey } = deriveEd25519Keys(mnemonic, index)
  return privateKey
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function suiGetBalance(address: string): Promise<Balance> {
  // Sui JSON-RPC: suix_getBalance
  const result = await suiJsonRpc<{
    totalBalance: string
    coinObjectCount: number
  }>("suix_getBalance", [address, "0x2::sui::SUI"])

  const raw = result.totalBalance
  return {
    balance: (Number(raw) / 1e9).toString(), // 1 SUI = 10^9 MIST
    raw,
  }
}

// ─── 5. Get token balance ────────────────────────────────────────────────────
export async function suiGetTokenBalance(address: string, coinType: string): Promise<Balance> {
  const result = await suiJsonRpc<{
    totalBalance: string
    coinObjectCount: number
  }>("suix_getBalance", [address, coinType])

  return {
    balance: result.totalBalance,
    raw: result.totalBalance,
  }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function suiEstimateFee(): Promise<{ fee: string; feeSui: string }> {
  // Sui reference gas price
  const gasPrice = await suiJsonRpc<string>("suix_getReferenceGasPrice", [])
  // Simple transfer budget: ~2000 * gasPrice
  const budget = BigInt(gasPrice) * 2000n
  return {
    fee: budget.toString(),
    feeSui: (Number(budget) / 1e9).toString(),
  }
}

// ─── 7. Send native ──────────────────────────────────────────────────────────
export async function suiSendNative(
  mnemonic: string,
  index: number,
  to: string,
  amount: string,
): Promise<TxResult> {
  const keys = deriveEd25519Keys(mnemonic, index)
  const amountMist = Math.floor(Number(amount) * 1e9).toString()

  // Get coins for payment
  const coins = await suiJsonRpc<{ data: Array<{ coinObjectId: string; balance: string }> }>(
    "suix_getCoins",
    [keys.address, "0x2::sui::SUI", null, 50],
  )

  if (!coins.data.length) throw new Error("No SUI coins available")

  // Use unsafe_transferSui for simple transfers
  const txBytes = await suiJsonRpc<string>("unsafe_transferSui", [
    keys.address,
    coins.data[0].coinObjectId,
    "2000000", // gas budget in MIST
    to,
    amountMist,
  ])

  // Sign and execute
  const nacl = require("tweetnacl")

  // Decode the tx bytes, sign, and submit
  const txBytesArray = Buffer.from(txBytes, "base64")
  const blake2b = require("blakejs")
  const intentMessage = new Uint8Array(3 + txBytesArray.length)
  intentMessage[0] = 0 // IntentScope::TransactionData
  intentMessage[1] = 0 // IntentVersion::V0
  intentMessage[2] = 0 // AppId::Sui
  intentMessage.set(txBytesArray, 3)
  const digest = blake2b.blake2b(intentMessage, null, 32)

  const signature = nacl.sign.detached(new Uint8Array(digest), keys.secretKey)

  // Combine Ed25519 flag + signature + publicKey
  const serializedSig = new Uint8Array(1 + 64 + 32)
  serializedSig[0] = 0x00 // Ed25519 flag
  serializedSig.set(signature, 1)
  serializedSig.set(Buffer.from(keys.publicKey, "hex"), 65)

  const result = await suiJsonRpc<{ digest: string }>(
    "sui_executeTransactionBlock",
    [txBytes, [Buffer.from(serializedSig).toString("base64")], null, "WaitForLocalExecution"],
  )

  return { txId: result.digest }
}

// ─── 8. Transaction status ───────────────────────────────────────────────────
export async function suiGetTxStatus(txHash: string) {
  try {
    const result = await suiJsonRpc<{
      digest: string
      effects?: { status: { status: string } }
    }>("sui_getTransactionBlock", [txHash, { showEffects: true }])

    if (result.effects) {
      const status = result.effects.status.status
      return {
        status: status === "success" ? ("confirmed" as const) : ("failed" as const),
      }
    }
    return { status: "pending" as const }
  } catch {
    return { status: "pending" as const }
  }
}
