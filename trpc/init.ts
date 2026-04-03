/**
 * trpc/init.ts — tRPC instance + shared Zod schemas
 */

import { initTRPC } from "@trpc/server"
import { z } from "zod"

// ─── tRPC instance ───────────────────────────────────────────────────────────

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

// ─── Shared Zod schemas ─────────────────────────────────────────────────────

export const ChainSchema = z
  .string()
  .min(1, "chain is required")
  .describe("Chain identifier, e.g. ethereum-mainnet, bitcoin-testnet")

export const AddressSchema = z
  .string()
  .min(1, "address is required")
  .describe("On-chain address")

export const IndexSchema = z
  .number({ coerce: true })
  .int()
  .min(0)
  .describe("HD derivation index (0-based)")

export const AmountSchema = z
  .string()
  .min(1, "amount is required")
  .describe("Amount in human-readable units (ETH, BTC, etc.)")

export const TxHashSchema = z
  .string()
  .min(1, "txId is required")
  .describe("Transaction hash / ID")

export const PrivateKeySchema = z
  .string()
  .min(1)
  .describe("Private key (hex or base58 depending on chain)")

export const MnemonicSchema = z
  .string()
  .min(1)
  .describe("BIP-39 mnemonic phrase")

export const XpubSchema = z
  .string()
  .min(1)
  .describe("Extended public key or mnemonic (for Ed25519 chains)")

export const ContractAddressSchema = z
  .string()
  .min(1, "contractAddress is required")
  .describe("Token contract / mint address")
