/**
 * chains/algorand.ts
 * Algorand / ALGO — Ed25519, no standard HD derivation.
 *
 * Tatum: ALGO derivation is TBD/custom — we derive from seed + index
 * RPC: algorand-mainnet.gateway.tatum.io (Algod REST API)
 * Address format: 58 char base32 with checksum
 *
 * bun add algosdk
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import algosdk from "algosdk"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const ALGO_RPC = gatewayUrl("algorand-mainnet")
const ALGO_TESTNET_RPC = gatewayUrl("algorand-testnet")

// ALGO: use Ed25519 SLIP-0010 derivation like Solana
const ALGO_DERIVATION_PATH = (index: number) => `m/44'/283'/${index}'/0'`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAlgodClient(isTestnet = false): algosdk.Algodv2 {
  const url = isTestnet ? ALGO_TESTNET_RPC : ALGO_RPC
  return new algosdk.Algodv2(
    { "X-API-Key": TATUM_API_KEY } as any,
    url,
    "",
  )
}

async function algodGet<T>(path: string, isTestnet = false): Promise<T> {
  const url = isTestnet ? ALGO_TESTNET_RPC : ALGO_RPC
  const res = await fetch(`${url}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`Algorand GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function deriveAccount(mnemonic: string, index: number): algosdk.Account {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(ALGO_DERIVATION_PATH(index), seed.toString("hex"))
  // algosdk expects a 32-byte seed to generate an account
  const nacl = algosdk.secretKeyToMnemonic(new Uint8Array([...key, ...new Uint8Array(32)]))
  // Instead, manually create the keypair from the Ed25519 seed
  const secretKey = new Uint8Array(64)
  secretKey.set(key, 0)

  // Use nacl sign keypair from seed (Ed25519)
  // algosdk.Account needs the full 64-byte secret key (seed + public key)
  const keyPair = algosdk.mnemonicToSecretKey(algosdk.secretKeyToMnemonic(
    // The seed must be exactly 32 bytes for algosdk
    Uint8Array.from(key),
  ))
  return keyPair
}

// Simpler approach: derive raw Ed25519 seed, then use tweetnacl-compatible approach
function deriveKeypair(mnemonic: string, index: number): { addr: string; sk: Uint8Array } {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(ALGO_DERIVATION_PATH(index), seed.toString("hex"))
  // Generate Ed25519 keypair from 32-byte seed using algosdk's internal nacl
  // algosdk uses nacl.sign.keyPair.fromSeed
  const { nacl } = algosdk as any
  if (nacl?.sign?.keyPair?.fromSeed) {
    const kp = nacl.sign.keyPair.fromSeed(Uint8Array.from(key))
    const addr = algosdk.encodeAddress(kp.publicKey)
    return { addr, sk: kp.secretKey }
  }
  // Fallback: use the raw key bytes to encode address from public key
  // This uses the standard Ed25519 derivation
  const { publicKey, secretKey } = ed25519KeypairFromSeed(Uint8Array.from(key))
  const addr = algosdk.encodeAddress(publicKey)
  return { addr, sk: secretKey }
}

// Minimal Ed25519 keypair derivation (Bun supports crypto natively)
function ed25519KeypairFromSeed(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
  // Use Node.js crypto to get Ed25519 keypair from seed
  const crypto = require("crypto")
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"), // Ed25519 PKCS8 header
      Buffer.from(seed),
    ]),
    format: "der",
    type: "pkcs8",
  })
  const publicKey = crypto.createPublicKey(privateKey)
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
  const privRaw = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32)
  // Ed25519 secret key = seed (32) + public (32) = 64 bytes
  const secretKey = new Uint8Array(64)
  secretKey.set(privRaw, 0)
  secretKey.set(pubRaw, 32)
  return { publicKey: new Uint8Array(pubRaw), secretKey }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function algoGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  const kp = deriveKeypair(mnemonic, 0)
  return {
    mnemonic,
    xpub: kp.addr, // Algorand address at index 0
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function algoDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const kp = deriveKeypair(mnemonic, index)
  return { address: kp.addr }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function algoDerivePrivateKey(mnemonic: string, index: number): string {
  const kp = deriveKeypair(mnemonic, index)
  return Buffer.from(kp.sk).toString("hex")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function algoGetBalance(address: string, isTestnet = false): Promise<Balance> {
  const data = await algodGet<{ amount?: number }>(
    `/v2/accounts/${address}`, isTestnet,
  )
  const microAlgos = data.amount ?? 0
  return {
    balance: (microAlgos / 1e6).toString(),
    raw: microAlgos.toString(),
  }
}

// ─── 5. Send ALGO ────────────────────────────────────────────────────────────
export async function algoSendNative(params: {
  mnemonic: string
  fromIndex: number
  to: string
  amount: string // in ALGO
  isTestnet?: boolean
}): Promise<TxResult> {
  const { mnemonic, fromIndex, to, amount, isTestnet = false } = params
  const kp = deriveKeypair(mnemonic, fromIndex)
  const client = getAlgodClient(isTestnet)
  const suggestedParams = await client.getTransactionParams().do()
  const microAlgos = Math.round(Number(amount) * 1e6)

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: kp.addr,
    receiver: to,
    amount: microAlgos,
    suggestedParams,
  })

  const signedTxn = txn.signTxn(kp.sk)
  const { txid } = await client.sendRawTransaction(signedTxn).do()
  return { txId: txid }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function algoEstimateFee(isTestnet = false): Promise<{ fee: string; feeAlgo: string }> {
  const data = await algodGet<{ "min-fee"?: number }>(
    "/v2/transactions/params", isTestnet,
  )
  const minFee = data["min-fee"] ?? 1000
  return { fee: minFee.toString(), feeAlgo: (minFee / 1e6).toString() }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function algoGetTxStatus(txId: string, isTestnet = false) {
  try {
    const data = await algodGet<{ "confirmed-round"?: number }>(
      `/v2/transactions/pending/${txId}`, isTestnet,
    )
    if (data["confirmed-round"]) {
      return { status: "confirmed" as const, round: data["confirmed-round"] }
    }
    return { status: "pending" as const, round: null }
  } catch {
    return { status: "pending" as const, round: null }
  }
}
