/**
 * chains/cosmos.ts
 * Cosmos Hub / ATOM — secp256k1, BIP-44.
 *
 * Tatum derivation: m/44'/118'/0'/0/0 (standard Cosmos BIP-44)
 * Account-level: m/44'/118'/0'  then /0/{index}
 * RPC: cosmos-mainnet.gateway.tatum.io (Tendermint/CometBFT RPC or REST LCD)
 * Address format: cosmos1... (Bech32 with "cosmos" HRP)
 *
 * bun add @cosmjs/stargate @cosmjs/proto-signing @cosmjs/crypto @cosmjs/encoding
 */

import { generateMnemonic } from "bip39"
import { ethers } from "ethers"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const ATOM_RPC = gatewayUrl("cosmos-mainnet")

const COSMOS_DERIVATION_PATH = "m/44'/118'/0'"

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function cosmosGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ATOM_RPC}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`Cosmos GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function getCosmJS() {
  try {
    const { DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing")
    const { SigningStargateClient, StargateClient } = require("@cosmjs/stargate")
    const { stringToPath } = require("@cosmjs/crypto")
    return { DirectSecp256k1HdWallet, SigningStargateClient, StargateClient, stringToPath }
  } catch {
    throw new Error("@cosmjs/proto-signing, @cosmjs/stargate, @cosmjs/crypto not installed")
  }
}

// ─── 1. Wallet generation ────────────────────────────────────────────────────
export function atomGenerateWallet(): ChainWallet {
  const mnemonic = generateMnemonic(256)
  // Cosmos uses secp256k1, but Bech32 addresses are derived differently than ETH.
  // We can still use ethers for the xpub (secp256k1 HD key), but addresses need CosmJS.
  const hdNode = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    COSMOS_DERIVATION_PATH,
  )
  return {
    mnemonic,
    xpub: hdNode.neuter().extendedKey,
  }
}

// ─── 2. Address derivation ───────────────────────────────────────────────────
export async function atomDeriveAddress(mnemonic: string, index: number): Promise<DerivedAddress> {
  const { DirectSecp256k1HdWallet, stringToPath } = getCosmJS()
  const path = stringToPath(`m/44'/118'/0'/0/${index}`)
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [path],
    prefix: "cosmos",
  })
  const [account] = await wallet.getAccounts()
  return { address: account.address }
}

// ─── 3. Private key derivation ───────────────────────────────────────────────
export function atomDerivePrivateKey(mnemonic: string, index: number): string {
  // Use ethers to derive the secp256k1 private key (same curve as Cosmos)
  const hdNode = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    COSMOS_DERIVATION_PATH,
  )
  return hdNode.deriveChild(0).deriveChild(index).privateKey
}

// ─── 4. Balance ──────────────────────────────────────────────────────────────
export async function atomGetBalance(address: string): Promise<Balance> {
  // Cosmos LCD REST: /cosmos/bank/v1beta1/balances/{address}
  const result = await cosmosGet<{
    balances: Array<{ denom: string; amount: string }>
  }>(`/cosmos/bank/v1beta1/balances/${address}`)

  const atomBalance = result.balances.find(b => b.denom === "uatom")
  const raw = atomBalance?.amount ?? "0"
  return {
    balance: (Number(raw) / 1e6).toString(), // 1 ATOM = 10^6 uatom
    raw,
  }
}

// ─── 5. Fee estimation ───────────────────────────────────────────────────────
export async function atomEstimateFee(): Promise<{ fee: string; feeAtom: string }> {
  // Cosmos Hub typical gas: 80000 gas * 0.025 uatom/gas = 2000 uatom = 0.002 ATOM
  const fee = "5000" // uatom — reasonable default for a simple send
  return { fee, feeAtom: (Number(fee) / 1e6).toString() }
}

// ─── 6. Send native ──────────────────────────────────────────────────────────
export async function atomSendNative(
  mnemonic: string,
  index: number,
  to: string,
  amount: string,
): Promise<TxResult> {
  const { DirectSecp256k1HdWallet, SigningStargateClient, stringToPath } = getCosmJS()

  const path = stringToPath(`m/44'/118'/0'/0/${index}`)
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [path],
    prefix: "cosmos",
  })
  const [account] = await wallet.getAccounts()

  // Connect to the RPC endpoint
  const client = await SigningStargateClient.connectWithSigner(ATOM_RPC, wallet, {
    // Custom headers for Tatum
  })

  const uatomAmount = Math.floor(Number(amount) * 1e6).toString()
  const result = await client.sendTokens(
    account.address,
    to,
    [{ denom: "uatom", amount: uatomAmount }],
    { amount: [{ denom: "uatom", amount: "5000" }], gas: "200000" },
  )

  return { txId: result.transactionHash }
}

// ─── 7. Transaction status ───────────────────────────────────────────────────
export async function atomGetTxStatus(txHash: string) {
  try {
    const result = await cosmosGet<{
      tx_response?: { code: number; height: string; txhash: string }
    }>(`/cosmos/tx/v1beta1/txs/${txHash}`)

    if (result.tx_response) {
      const code = result.tx_response.code
      return {
        status: code === 0 ? ("confirmed" as const) : ("failed" as const),
        blockHeight: result.tx_response.height,
      }
    }
    return { status: "pending" as const }
  } catch {
    return { status: "pending" as const }
  }
}
