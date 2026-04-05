/**
 * chains/xrp.ts
 * XRP Ledger — unique consensus, not EVM/UTXO.
 *
 * Derivation: m/44'/144'/0'/0/{index} (secp256k1, BIP-44)
 * RPC: xrp-mainnet.gateway.tatum.io (rippled JSON-RPC)
 * Address format: r... (base58 with XRP alphabet)
 *
 * bun add xrpl
 */

import { HDNodeWallet, Mnemonic } from "ethers"
import { Client, xrpToDrops, dropsToXrp } from "xrpl"
import { deriveAddress as xrpDeriveClassicAddress } from "ripple-keypairs"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const XRP_RPC = gatewayUrl("ripple-mainnet")
const XRP_TESTNET_RPC = gatewayUrl("ripple-testnet")

// Tatum uses m/44'/144'/0'/0 — account-level path
const XRP_DERIVATION_PATH = "m/44'/144'/0'"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpcUrl(isTestnet = false): string {
  return isTestnet ? XRP_TESTNET_RPC : XRP_RPC
}

async function getClient(isTestnet = false): Promise<Client> {
  const url = getRpcUrl(isTestnet)
  const client = new Client(url, {
    connectionTimeout: 10000,
    headers: { "x-api-key": TATUM_API_KEY },
  } as any)
  await client.connect()
  return client
}

async function rpc<T>(method: string, params: unknown[], isTestnet = false): Promise<T> {
  const url = getRpcUrl(isTestnet)
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ method, params: [params[0] ?? {}] }),
  })
  const data = await res.json() as { result?: T; error?: string }
  if (data.error) throw new Error(`XRP RPC ${method}: ${data.error}`)
  return data.result as T
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
// XRP uses secp256k1 like Ethereum, but different derivation path
// We derive the master key locally and store xpub for address derivation
export function xrpGenerateWallet(): ChainWallet {
  const w = HDNodeWallet.createRandom()
  if (!w.mnemonic) throw new Error("XRP mnemonic generation failed")
  const hd = HDNodeWallet.fromMnemonic(w.mnemonic, XRP_DERIVATION_PATH)
  return { mnemonic: w.mnemonic.phrase, xpub: hd.neuter().extendedKey }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
// Derive secp256k1 public key → XRP address (r...)
export function xrpDeriveAddress(xpub: string, index: number): DerivedAddress {
  const hd = HDNodeWallet.fromExtendedKey(xpub)
  const child = hd.deriveChild(0).deriveChild(index)
  // Get compressed public key from the derived child
  const pubKeyHex = child.publicKey.replace("0x", "")
  // Use ripple-keypairs to derive the classic address from the public key
  const address = xrpDeriveClassicAddress(pubKeyHex)
  return { address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function xrpDerivePrivateKey(mnemonic: string, index: number): string {
  const hd = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), XRP_DERIVATION_PATH)
  return hd.deriveChild(0).deriveChild(index).privateKey!.replace("0x", "")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function xrpGetBalance(address: string, isTestnet = false): Promise<Balance> {
  const result = await rpc<{ account_data?: { Balance?: string } }>(
    "account_info",
    [{ account: address, ledger_index: "validated" }],
    isTestnet,
  )
  const drops = result.account_data?.Balance ?? "0"
  return {
    balance: dropsToXrp(drops).toString(),
    raw: drops,
  }
}

// ─── 5. Send XRP ─────────────────────────────────────────────────────────────
export async function xrpSendNative(params: {
  privateKey: string
  to: string
  amount: string // in XRP
  isTestnet?: boolean
}): Promise<TxResult> {
  const { privateKey, to, amount, isTestnet = false } = params
  const client = await getClient(isTestnet)
  try {
    const wallet = XrplWallet.fromSeed(privateKey)
    const prepared = await client.autofill({
      TransactionType: "Payment",
      Account: wallet.classicAddress,
      Destination: to,
      Amount: xrpToDrops(amount),
    })
    const signed = wallet.sign(prepared)
    const result = await client.submitAndWait(signed.tx_blob)
    const txId = typeof result.result.hash === "string" ? result.result.hash : signed.hash
    return { txId }
  } finally {
    await client.disconnect()
  }
}

// ─── 6. Fee estimation ───────────────────────────────────────────────────────
export async function xrpEstimateFee(isTestnet = false): Promise<{ fee: string; feeXrp: string }> {
  const result = await rpc<{ drops?: { open_ledger_fee?: string; minimum_fee?: string } }>(
    "fee", [{}], isTestnet,
  )
  const drops = result.drops?.open_ledger_fee ?? result.drops?.minimum_fee ?? "12"
  return { fee: drops, feeXrp: dropsToXrp(drops).toString() }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function xrpGetTxStatus(txHash: string, isTestnet = false) {
  const result = await rpc<{ meta?: { TransactionResult?: string }; validated?: boolean }>(
    "tx", [{ transaction: txHash }], isTestnet,
  )
  const txResult = result.meta?.TransactionResult
  if (!result.validated) return { status: "pending" as const }
  return {
    status: txResult === "tesSUCCESS" ? "confirmed" as const : "failed" as const,
    result: txResult,
  }
}
