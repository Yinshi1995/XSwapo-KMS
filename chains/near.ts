/**
 * chains/near.ts
 * NEAR Protocol — Ed25519, implicit accounts.
 *
 * Derivation: m/44'/397'/0' (SLIP-0010 Ed25519)
 * RPC: near-mainnet.gateway.tatum.io (NEAR JSON-RPC)
 * Address format: hex public key (implicit) or named account
 *
 * bun add near-api-js
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import * as nearAPI from "near-api-js"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const NEAR_RPC = gatewayUrl("near-mainnet")
const NEAR_TESTNET_RPC = gatewayUrl("near-testnet")

const NEAR_DERIVATION_PATH = (index: number) => `m/44'/397'/${index}'`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpcUrl(isTestnet = false): string {
  return isTestnet ? NEAR_TESTNET_RPC : NEAR_RPC
}

async function rpc<T>(method: string, params: unknown, isTestnet = false): Promise<T> {
  const url = getRpcUrl(isTestnet)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = await res.json() as { result?: T; error?: { data?: string; message?: string } }
  if (data.error) throw new Error(`NEAR RPC ${method}: ${data.error.message ?? JSON.stringify(data.error)}`)
  return data.result as T
}

function deriveKeypair(mnemonic: string, index: number): { publicKey: string; secretKey: Uint8Array } {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(NEAR_DERIVATION_PATH(index), seed.toString("hex"))
  // Generate Ed25519 keypair from seed
  const crypto = require("crypto")
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(key),
    ]),
    format: "der",
    type: "pkcs8",
  })
  const publicKey = crypto.createPublicKey(privateKey)
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
  return {
    publicKey: Buffer.from(pubRaw).toString("hex"),
    secretKey: Uint8Array.from(key),
  }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function nearGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  const kp = deriveKeypair(mnemonic, 0)
  return {
    mnemonic,
    xpub: kp.publicKey, // hex encoded public key at index 0
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
// NEAR implicit accounts = hex public key (64 chars)
export function nearDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const kp = deriveKeypair(mnemonic, index)
  return { address: kp.publicKey }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function nearDerivePrivateKey(mnemonic: string, index: number): string {
  const kp = deriveKeypair(mnemonic, index)
  return Buffer.from(kp.secretKey).toString("hex")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function nearGetBalance(address: string, isTestnet = false): Promise<Balance> {
  const result = await rpc<{ amount: string }>(
    "query",
    { request_type: "view_account", finality: "final", account_id: address },
    isTestnet,
  )
  const yocto = result.amount // 1 NEAR = 10^24 yoctoNEAR
  const near = (BigInt(yocto) / BigInt(1e12)) // intermediate step for precision
  const nearStr = (Number(near) / 1e12).toString()
  return { balance: nearStr, raw: yocto }
}

// ─── 5. Send NEAR ────────────────────────────────────────────────────────────
export async function nearSendNative(params: {
  mnemonic: string
  fromIndex: number
  to: string
  amount: string // in NEAR
  isTestnet?: boolean
}): Promise<TxResult> {
  const { mnemonic, fromIndex, to, amount, isTestnet = false } = params
  const kp = deriveKeypair(mnemonic, fromIndex)
  const from = kp.publicKey // implicit account

  // Convert NEAR to yoctoNEAR
  const yocto = BigInt(Math.round(Number(amount) * 1e12)) * BigInt(1e12)

  // Get access key / nonce
  const accessKey = await rpc<{ nonce: number; block_hash: string }>(
    "query",
    {
      request_type: "view_access_key",
      finality: "final",
      account_id: from,
      public_key: `ed25519:${Buffer.from(kp.publicKey, "hex").toString("base64")}`,
    },
    isTestnet,
  )

  // Build transaction using near-api-js
  const nonce = accessKey.nonce + 1
  const blockHash = nearAPI.utils.serialize.base_decode(accessKey.block_hash)
  const publicKey = nearAPI.utils.PublicKey.fromString(`ed25519:${Buffer.from(kp.publicKey, "hex").toString("base64")}`)

  const actions = [nearAPI.transactions.transfer(yocto)]
  const tx = nearAPI.transactions.createTransaction(from, publicKey, to, nonce, actions, blockHash)

  // Sign
  const serialized = nearAPI.utils.serialize.serialize(nearAPI.transactions.SCHEMA.Transaction, tx)
  const crypto = require("crypto")
  const hash = crypto.createHash("sha256").update(serialized).digest()

  const privKeyPkcs8 = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(kp.secretKey),
    ]),
    format: "der",
    type: "pkcs8",
  })
  const signature = crypto.sign(null, hash, privKeyPkcs8)

  const signedTx = new nearAPI.transactions.SignedTransaction({
    transaction: tx,
    signature: new nearAPI.transactions.Signature({
      keyType: 0,
      data: signature,
    }),
  })

  const bytes = signedTx.encode()
  const base64Tx = Buffer.from(bytes).toString("base64")

  const result = await rpc<{
    status?: { SuccessValue?: string; Failure?: unknown }
    transaction?: { hash: string }
  }>(
    "broadcast_tx_commit",
    [base64Tx],
    isTestnet,
  )

  return { txId: result.transaction?.hash ?? "" }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function nearEstimateFee(isTestnet = false): Promise<{ fee: string; feeNear: string }> {
  const result = await rpc<{ gas_price: string }>(
    "gas_price", [null], isTestnet,
  )
  return { fee: result.gas_price, feeNear: (Number(result.gas_price) / 1e24).toString() }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function nearGetTxStatus(txHash: string, isTestnet = false) {
  try {
    const result = await rpc<{
      status?: { SuccessValue?: string; Failure?: unknown }
    }>(
      "EXPERIMENTAL_tx_status",
      { tx_hash: txHash, wait_until: "EXECUTED" },
      isTestnet,
    )
    if (result.status?.Failure) return { status: "failed" as const }
    return { status: "confirmed" as const }
  } catch {
    return { status: "pending" as const }
  }
}
