/**
 * chains/stellar.ts
 * Stellar / XLM — Ed25519, no HD xpub.
 *
 * Derivation: m/44'/148'/{index}' (SLIP-0010 Ed25519)
 * RPC: Tatum proxies Horizon API at stellar-mainnet.gateway.tatum.io
 * Address format: G... (56 char base32)
 *
 * bun add @stellar/stellar-sdk
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import {
  Keypair, Networks, TransactionBuilder, Operation, Asset, Horizon,
} from "@stellar/stellar-sdk"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const XLM_RPC = gatewayUrl("stellar-mainnet")
const XLM_TESTNET_RPC = gatewayUrl("stellar-testnet")

// Tatum: XLM derivation path
const XLM_DERIVATION_PATH = (index: number) => `m/44'/148'/${index}'`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getHorizon(isTestnet = false): Horizon.Server {
  const url = isTestnet ? XLM_TESTNET_RPC : XLM_RPC
  return new Horizon.Server(url, {
    headers: { "x-api-key": TATUM_API_KEY },
  } as any)
}

async function horizonGet<T>(path: string, isTestnet = false): Promise<T> {
  const url = isTestnet ? XLM_TESTNET_RPC : XLM_RPC
  const res = await fetch(`${url}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`Stellar GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function deriveKeypair(mnemonic: string, index: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(XLM_DERIVATION_PATH(index), seed.toString("hex"))
  return Keypair.fromRawEd25519Seed(Buffer.from(key))
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
// Stellar uses Ed25519 — no xpub, mnemonic needed for each derivation
export function xlmGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  const kp = deriveKeypair(mnemonic, 0)
  return {
    mnemonic,
    xpub: kp.publicKey(), // G... public key at index 0
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
// Stellar has no xpub-based derivation, so xpub = mnemonic (decrypted)
export function xlmDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const kp = deriveKeypair(mnemonic, index)
  return { address: kp.publicKey() }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function xlmDerivePrivateKey(mnemonic: string, index: number): string {
  const kp = deriveKeypair(mnemonic, index)
  return kp.secret()
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function xlmGetBalance(address: string, isTestnet = false): Promise<Balance> {
  try {
    const data = await horizonGet<{ balances: Array<{ asset_type: string; balance: string }> }>(
      `/accounts/${address}`, isTestnet,
    )
    const native = data.balances.find(b => b.asset_type === "native")
    const bal = native?.balance ?? "0"
    // XLM has 7 decimal places, 1 XLM = 10^7 stroops
    const stroops = Math.round(Number(bal) * 1e7).toString()
    return { balance: bal, raw: stroops }
  } catch {
    return { balance: "0", raw: "0" }
  }
}

// ─── 5. Send XLM ─────────────────────────────────────────────────────────────
export async function xlmSendNative(params: {
  secretKey: string // S...
  to: string
  amount: string // in XLM
  memo?: string
  isTestnet?: boolean
}): Promise<TxResult> {
  const { secretKey, to, amount, memo, isTestnet = false } = params
  const server = getHorizon(isTestnet)
  const kp = Keypair.fromSecret(secretKey)
  const account = await server.loadAccount(kp.publicKey())
  const networkPassphrase = isTestnet ? Networks.TESTNET : Networks.PUBLIC

  let builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase,
  }).addOperation(
    Operation.payment({ destination: to, asset: Asset.native(), amount }),
  )

  if (memo) {
    const { Memo } = await import("@stellar/stellar-sdk")
    builder = builder.addMemo(Memo.text(memo))
  }

  const tx = builder.setTimeout(30).build()
  tx.sign(kp)

  const result = await server.submitTransaction(tx) as any
  return { txId: result.hash }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function xlmEstimateFee(isTestnet = false): Promise<{ fee: string; feeXlm: string }> {
  const data = await horizonGet<{ last_ledger_base_fee?: string }>(
    "/fee_stats", isTestnet,
  )
  const fee = data.last_ledger_base_fee ?? "100"
  return { fee, feeXlm: (Number(fee) / 1e7).toFixed(7) }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function xlmGetTxStatus(txHash: string, isTestnet = false) {
  try {
    const data = await horizonGet<{ successful: boolean; ledger: number }>(
      `/transactions/${txHash}`, isTestnet,
    )
    return {
      status: data.successful ? "confirmed" as const : "failed" as const,
      ledger: data.ledger,
    }
  } catch {
    return { status: "pending" as const, ledger: null }
  }
}
