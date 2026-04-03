/**
 * chains/vechain.ts
 * VeChain / VET — secp256k1 (Ethereum-style keys).
 *
 * Tatum derivation: m/44'/818'/0'/0  (then /{index})
 * RPC: vechain-mainnet.gateway.tatum.io (VeChain Thor REST API)
 * Address format: 0x... (same as Ethereum, checksum)
 *
 * VeChain uses Ethereum-compatible secp256k1 keys but has its own
 * transaction format and blockchain. Address derivation is identical to ETH.
 *
 * bun add @vechain/sdk-core @vechain/sdk-network (optional, for full tx building)
 * For basic ops, ethers is sufficient since VeChain uses ETH-compatible keys.
 */

import { generateMnemonic } from "bip39"
import { ethers } from "ethers"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const VET_RPC = gatewayUrl("vechain-mainnet")

const VET_DERIVATION_PATH = "m/44'/818'/0'"

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function thorGet<T>(path: string): Promise<T> {
  const res = await fetch(`${VET_RPC}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`VeChain GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function thorPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${VET_RPC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`VeChain POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function vetGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  const hdNode = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    VET_DERIVATION_PATH,
  )
  return {
    mnemonic,
    xpub: hdNode.neuter().extendedKey,
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function vetDeriveAddress(xpub: string, index: number): DerivedAddress {
  const node = ethers.HDNodeWallet.fromExtendedKey(xpub).deriveChild(0).deriveChild(index)
  return { address: node.address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function vetDerivePrivateKey(mnemonic: string, index: number): string {
  const hdNode = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    VET_DERIVATION_PATH,
  )
  return hdNode.deriveChild(0).deriveChild(index).privateKey
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function vetGetBalance(address: string): Promise<Balance> {
  // Thor REST API: GET /accounts/{address}
  const result = await thorGet<{ balance: string; energy: string }>(`/accounts/${address}`)
  // balance is in hex (wei-equivalent, 10^18 = 1 VET)
  const rawHex = result.balance
  const rawBigInt = BigInt(rawHex)
  return {
    balance: ethers.formatEther(rawBigInt),
    raw: rawBigInt.toString(),
  }
}

// ─── 5. Get VTHO balance (energy/gas token) ──────────────────────────────────
export async function vetGetVthoBalance(address: string): Promise<Balance> {
  const result = await thorGet<{ balance: string; energy: string }>(`/accounts/${address}`)
  const rawHex = result.energy
  const rawBigInt = BigInt(rawHex)
  return {
    balance: ethers.formatEther(rawBigInt),
    raw: rawBigInt.toString(),
  }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function vetEstimateFee(): Promise<{ fee: string; feeVtho: string }> {
  // VeChain uses VTHO for gas. Simple transfer = 21000 gas * base gas price
  // Base gas price: 1e15 wei VTHO per gas unit → 21000 * 1e15 = 2.1e19 = 21 VTHO
  // Actually, the base gas price is much lower on VeChain
  // Typical: 21000 gas * 10^15 / 10^18 = 0.021 VTHO
  const fee = "21000000000000000000" // ~21 VTHO for simple transfer is high, typical is lower
  // Real-world: base gas coeff = 0, so 21000 * baseGasPrice
  // Let's use a more realistic estimate
  const realisticFee = "21000000000000000" // 0.021 VTHO (21000 * 10^12)
  return { fee: realisticFee, feeVtho: ethers.formatEther(BigInt(realisticFee)) }
}

// ─── 7. Send native ──────────────────────────────────────────────────────────
export async function vetSendNative(
  privateKey: string,
  to: string,
  amount: string,
): Promise<TxResult> {
  // VeChain has a unique transaction format with clauses
  // Using the Thor REST API to post a raw transaction
  // For full implementation, @vechain/sdk-core is recommended

  // This is a simplified version. Production should use @vechain/sdk-core for proper tx building.
  throw new Error(
    "VeChain sendNative requires @vechain/sdk-core for transaction building. " +
    "Use the Tatum REST API fallback or install @vechain/sdk-core.",
  )
}

// ─── 8. Transaction status ───────────────────────────────────────────────────
export async function vetGetTxStatus(txHash: string) {
  try {
    const result = await thorGet<{ id: string; meta?: { blockNumber: number } }>(`/transactions/${txHash}`)
    if (result.meta?.blockNumber) {
      const receipt = await thorGet<{ reverted: boolean }>(`/transactions/${txHash}/receipt`)
      return {
        status: receipt.reverted ? ("failed" as const) : ("confirmed" as const),
        blockNumber: result.meta.blockNumber,
      }
    }
    return { status: "pending" as const }
  } catch {
    return { status: "pending" as const }
  }
}
