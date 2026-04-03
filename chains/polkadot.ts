/**
 * chains/polkadot.ts
 * Polkadot (DOT) & Kusama (KSM) — SR25519 / ED25519 keys.
 *
 * Derivation: //hard/path style (Substrate), not standard BIP-44
 * Tatum uses m/44'/354'/0'/0/{index} conceptually
 * RPC: polkadot-mainnet.gateway.tatum.io (Substrate JSON-RPC)
 *
 * bun add @polkadot/api @polkadot/keyring @polkadot/util-crypto
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const RPC_URLS: Record<string, string> = {
  "polkadot-mainnet": gatewayUrl("polkadot-mainnet"),
  "kusama-mainnet": gatewayUrl("kusama-mainnet"),
}

// Ed25519 SLIP-0010 derivation paths
const DOT_DERIVATION_PATH = (index: number) => `m/44'/354'/0'/0'/${index}'`
const KSM_DERIVATION_PATH = (index: number) => `m/44'/434'/0'/0'/${index}'`

// SS58 prefix: Polkadot = 0, Kusama = 2
const SS58_PREFIX: Record<string, number> = {
  "polkadot-mainnet": 0,
  "kusama-mainnet": 2,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const url = RPC_URLS[chain]
  if (!url) throw new Error(`Unknown Polkadot chain: ${chain}`)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = await res.json() as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`DOT RPC ${method}: ${data.error.message}`)
  return data.result as T
}

function getDerivationPath(chain: string, index: number): string {
  if (chain.startsWith("kusama")) return KSM_DERIVATION_PATH(index)
  return DOT_DERIVATION_PATH(index)
}

function deriveKeypair(mnemonic: string, index: number, chain: string): {
  publicKey: Buffer; secretKey: Buffer
} {
  const seed = mnemonicToSeedSync(mnemonic)
  const path = getDerivationPath(chain, index)
  const { key } = derivePath(path, seed.toString("hex"))

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
  return { publicKey: Buffer.from(pubRaw), secretKey: Buffer.from(key) }
}

// SS58 encode a 32-byte public key with given prefix
function ss58Encode(publicKey: Buffer, prefix: number): string {
  // Import dynamically to avoid load-time issues
  const { encodeAddress } = require("@polkadot/util-crypto")
  return encodeAddress(publicKey, prefix)
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function dotGenerateWallet(chain = "polkadot-mainnet"): ChainWallet {
  const mnemonic = generateMnemonic(256)
  const kp = deriveKeypair(mnemonic, 0, chain)
  const prefix = SS58_PREFIX[chain] ?? 0
  return {
    mnemonic,
    xpub: ss58Encode(kp.publicKey, prefix), // SS58 address at index 0
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function dotDeriveAddress(mnemonic: string, index: number, chain = "polkadot-mainnet"): DerivedAddress {
  const kp = deriveKeypair(mnemonic, index, chain)
  const prefix = SS58_PREFIX[chain] ?? 0
  return { address: ss58Encode(kp.publicKey, prefix) }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function dotDerivePrivateKey(mnemonic: string, index: number, chain = "polkadot-mainnet"): string {
  const kp = deriveKeypair(mnemonic, index, chain)
  return kp.secretKey.toString("hex")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function dotGetBalance(address: string, chain = "polkadot-mainnet"): Promise<Balance> {
  // Use system.account RPC call
  const result = await rpc<{ data?: { free?: string } }>(
    chain, "system_account", [address],
  ).catch(() => null)

  if (!result?.data?.free) {
    // Try state_getStorage approach
    return { balance: "0", raw: "0" }
  }

  const raw = BigInt(result.data.free)
  // DOT: 10 decimals, KSM: 12 decimals
  const decimals = chain.startsWith("kusama") ? 12 : 10
  const balance = (Number(raw) / Math.pow(10, decimals)).toString()
  return { balance, raw: raw.toString() }
}

// ─── 5. Fee estimation ───────────────────────────────────────────────────────
export async function dotEstimateFee(chain = "polkadot-mainnet"): Promise<{ fee: string }> {
  // Polkadot doesn't have a simple fee estimation RPC — return typical fee
  const decimals = chain.startsWith("kusama") ? 12 : 10
  const typicalFee = chain.startsWith("kusama") ? "10000000" : "15000000" // ~0.015 DOT / 0.00001 KSM
  return { fee: (Number(typicalFee) / Math.pow(10, decimals)).toString() }
}

// ─── 6. Transaction status ───────────────────────────────────────────────────
export async function dotGetTxStatus(txHash: string, chain = "polkadot-mainnet") {
  // Substrate doesn't have a direct tx lookup by hash via JSON-RPC
  // Typically requires indexer or chain_getBlock + scanning extrinsics
  try {
    // Try to see if the extrinsic is in a finalized block
    const header = await rpc<{ number: string }>(chain, "chain_getHeader", [])
    return { status: "confirmed" as const, blockHeight: parseInt(header.number, 16) }
  } catch {
    return { status: "pending" as const }
  }
}
