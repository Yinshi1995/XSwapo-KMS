/**
 * chains/ton.ts
 * TON (The Open Network) — Ed25519.
 *
 * Tatum derivation: m/44'/60'/0'/0 (EVM-style per Tatum docs)
 * However, standard TON uses m/44'/607'/0' with Ed25519
 * We support standard TON derivation for wallet generation.
 * RPC: ton-mainnet.gateway.tatum.io (TON HTTP API / TON Center compatible)
 * Address format: EQ... or UQ... (Base64url, bounceable/non-bounceable)
 *
 * bun add @ton/ton @ton/crypto @ton/core
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const TON_RPC = gatewayUrl("ton-mainnet")

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function tonApiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${TON_RPC}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`TON GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function tonApiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TON_RPC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`TON POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function getTonLibs() {
  try {
    const tonCore = require("@ton/core")
    const tonCrypto = require("@ton/crypto")
    const ton = require("@ton/ton")
    return { ...tonCore, ...tonCrypto, ...ton }
  } catch {
    throw new Error("@ton/ton, @ton/core, @ton/crypto not installed. Run: bun add @ton/ton @ton/core @ton/crypto")
  }
}

function deriveEd25519Keys(mnemonic: string, index: number) {
  const seed = mnemonicToSeedSync(mnemonic)
  // Use SLIP-0010 Ed25519 derivation
  const path = `m/44'/607'/${index}'/0'`
  const { key } = derivePath(path, seed.toString("hex"))
  return Buffer.from(key)
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function tonGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  // Ed25519 → no xpub. Store mnemonic.
  return { mnemonic, xpub: mnemonic }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function tonDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const libs = getTonLibs()
  const secretKey = deriveEd25519Keys(mnemonic, index)

  const nacl = require("tweetnacl")
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(secretKey))

  // Create WalletV4 contract address from public key
  const workchain = 0
  const wallet = libs.WalletContractV4.create({
    workchain,
    publicKey: Buffer.from(keyPair.publicKey),
  })

  return { address: wallet.address.toString({ bounceable: false }) }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function tonDerivePrivateKey(mnemonic: string, index: number): string {
  const secretKey = deriveEd25519Keys(mnemonic, index)
  return secretKey.toString("hex")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function tonGetBalance(address: string): Promise<Balance> {
  // Tatum TON gateway: GET /getAddressBalance?address=...
  const data = await tonApiGet<{ ok: boolean; result: string }>(
    `/getAddressBalance?address=${encodeURIComponent(address)}`
  )
  const raw = data.result ?? "0"
  return {
    balance: (Number(raw) / 1e9).toString(),
    raw,
  }
}

// ─── 5. Fee estimation ───────────────────────────────────────────────────────
export async function tonEstimateFee(): Promise<{ fee: string; feeTon: string }> {
  // TON simple transfer fee is typically ~0.005-0.01 TON
  const fee = "10000000" // 0.01 TON in nanoTON
  return { fee, feeTon: (Number(fee) / 1e9).toString() }
}

// ─── 6. Send native ──────────────────────────────────────────────────────────
export async function tonSendNative(
  mnemonic: string,
  index: number,
  to: string,
  amount: string,
): Promise<TxResult> {
  const libs = getTonLibs()
  const secretKey = deriveEd25519Keys(mnemonic, index)

  const nacl = require("tweetnacl")
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(secretKey))

  const wallet = libs.WalletContractV4.create({
    workchain: 0,
    publicKey: Buffer.from(keyPair.publicKey),
  })

  // Create internal message
  // Get seqno from the wallet contract
  const seqnoResult = await tonApiGet<{ result: { stack: Array<[string, string]> } }>(
    `/api/v2/runGetMethod?address=${wallet.address.toString()}&method=seqno`,
  )
  const seqno = parseInt(seqnoResult.result.stack[0]?.[1] ?? "0", 16)

  const nanoAmount = BigInt(Math.floor(Number(amount) * 1e9))

  // Build transfer
  const transfer = wallet.createTransfer({
    seqno,
    secretKey: Buffer.from(keyPair.secretKey),
    messages: [
      libs.internal({
        to: libs.Address.parse(to),
        value: nanoAmount,
        bounce: false,
      }),
    ],
  })

  // Serialize to BOC
  const boc = libs.beginCell().store(libs.storeMessage(transfer)).endCell().toBoc()
  const bocBase64 = boc.toString("base64")

  // Send via API
  const result = await tonApiPost<{ result: { hash: string } }>("/api/v2/sendBoc", {
    boc: bocBase64,
  })

  return { txId: result.result?.hash ?? bocBase64.slice(0, 64) }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function tonGetTxStatus(txHash: string) {
  try {
    // TON uses a different transaction identification system (lt + hash)
    // For now, we try to look up by hash
    const result = await tonApiGet<{
      result: Array<{ transaction_id: { hash: string }; utime: number }>
    }>(`/api/v2/getTransactions?hash=${txHash}&limit=1`)

    if (result.result?.length > 0) {
      return { status: "confirmed" as const }
    }
    return { status: "pending" as const }
  } catch {
    return { status: "pending" as const }
  }
}
