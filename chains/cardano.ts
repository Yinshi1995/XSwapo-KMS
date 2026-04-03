/**
 * chains/cardano.ts
 * Cardano / ADA — Shelley era, Ed25519-BIP32 (extended keys).
 *
 * Tatum derivation: m/1852'/1815'/0'
 * RPC: cardano-mainnet.gateway.tatum.io (Rosetta API)
 * Address format: addr1... (Bech32, Shelley)
 *
 * NOTE: Cardano's cryptographic requirements (Ed25519-BIP32) are complex.
 * We implement wallet generation using the standard BIP39 → PBKDF2 → Ed25519-Bip32 chain.
 * For production, @emurgo/cardano-serialization-lib-nodejs is recommended.
 *
 * bun add @emurgo/cardano-serialization-lib-nodejs
 */

import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const ADA_RPC = gatewayUrl("cardano-mainnet")
const ADA_TESTNET_RPC = gatewayUrl("cardano-testnet")

// Cardano Shelley: m/1852'/1815'/0'
// Account key → m/1852'/1815'/0'/0/{index} for payment keys
// m/1852'/1815'/0'/2/0 for stake key

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpcUrl(isTestnet = false): string {
  return isTestnet ? ADA_TESTNET_RPC : ADA_RPC
}

async function rosettaPost<T>(path: string, body: unknown, isTestnet = false): Promise<T> {
  const url = getRpcUrl(isTestnet)
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Cardano POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

// Lazy-load cardano-serialization-lib
let CSL: any = null
function getCSL() {
  if (!CSL) {
    try {
      CSL = require("@emurgo/cardano-serialization-lib-nodejs")
    } catch {
      throw new Error("@emurgo/cardano-serialization-lib-nodejs not installed. Run: bun add @emurgo/cardano-serialization-lib-nodejs")
    }
  }
  return CSL
}

function deriveCardanoKeys(mnemonic: string, index: number, isTestnet = false) {
  const csl = getCSL()
  const entropy = mnemonicToSeedSync(mnemonic).subarray(0, 32)
  const rootKey = csl.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy),
    Buffer.from(""),
  )

  // m/1852'/1815'/0'
  const accountKey = rootKey
    .derive(1852 | 0x80000000)
    .derive(1815 | 0x80000000)
    .derive(0 | 0x80000000)

  // Payment key: m/1852'/1815'/0'/0/{index}
  const paymentKey = accountKey.derive(0).derive(index)
  const paymentPub = paymentKey.to_public()

  // Stake key: m/1852'/1815'/0'/2/0
  const stakeKey = accountKey.derive(2).derive(0)
  const stakePub = stakeKey.to_public()

  // Build base address (payment + stake)
  const networkId = isTestnet ? csl.NetworkInfo.testnet().network_id() : csl.NetworkInfo.mainnet().network_id()
  const baseAddr = csl.BaseAddress.new(
    networkId,
    csl.Credential.from_keyhash(paymentPub.to_raw_key().hash()),
    csl.Credential.from_keyhash(stakePub.to_raw_key().hash()),
  )

  return {
    address: baseAddr.to_address().to_bech32(),
    paymentKey,
    accountKey,
  }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function adaGenerateWallet(isTestnet = false): ChainWallet {
  const mnemonic = generateMnemonic(256) // 24 words
  const { address } = deriveCardanoKeys(mnemonic, 0, isTestnet)
  return {
    mnemonic,
    xpub: address, // Bech32 address at index 0 (we need mnemonic for derivation)
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export function adaDeriveAddress(mnemonic: string, index: number, isTestnet = false): DerivedAddress {
  const { address } = deriveCardanoKeys(mnemonic, index, isTestnet)
  return { address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function adaDerivePrivateKey(mnemonic: string, index: number): string {
  const csl = getCSL()
  const entropy = mnemonicToSeedSync(mnemonic).subarray(0, 32)
  const rootKey = csl.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy),
    Buffer.from(""),
  )
  const paymentKey = rootKey
    .derive(1852 | 0x80000000)
    .derive(1815 | 0x80000000)
    .derive(0 | 0x80000000)
    .derive(0)
    .derive(index)

  return Buffer.from(paymentKey.to_raw_key().as_bytes()).toString("hex")
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function adaGetBalance(address: string, isTestnet = false): Promise<Balance> {
  // Using Rosetta /account/balance
  const result = await rosettaPost<{
    balances?: Array<{ value: string; currency: { symbol: string; decimals: number } }>
  }>(
    "/account/balance",
    {
      network_identifier: {
        blockchain: "cardano",
        network: isTestnet ? "testnet" : "mainnet",
      },
      account_identifier: { address },
    },
    isTestnet,
  )

  const adaBalance = result.balances?.find(b => b.currency.symbol === "ADA")
  const lovelace = adaBalance?.value ?? "0"
  return {
    balance: (Number(lovelace) / 1e6).toString(),
    raw: lovelace,
  }
}

// ─── 5. Fee estimation ───────────────────────────────────────────────────────
export async function adaEstimateFee(isTestnet = false): Promise<{ fee: string; feeAda: string }> {
  // Cardano min fee: ~0.17 ADA for a simple transfer
  const minFee = "170000" // lovelace
  return { fee: minFee, feeAda: (Number(minFee) / 1e6).toString() }
}

// ─── 6. Transaction status ───────────────────────────────────────────────────
export async function adaGetTxStatus(txHash: string, isTestnet = false) {
  try {
    const result = await rosettaPost<{
      transaction?: { transaction_identifier: { hash: string } }
    }>(
      "/block/transaction",
      {
        network_identifier: {
          blockchain: "cardano",
          network: isTestnet ? "testnet" : "mainnet",
        },
        block_identifier: { index: 0 }, // latest
        transaction_identifier: { hash: txHash },
      },
      isTestnet,
    )
    if (result.transaction) return { status: "confirmed" as const }
    return { status: "pending" as const }
  } catch {
    return { status: "pending" as const }
  }
}
