/**
 * trpc/init.ts — tRPC instance + shared Zod schemas
 *
 * Authentication model:
 *   - Most procedures are public (read-only, safe: balance, fee, tx, rate,
 *     wallet.generate, wallet.deriveAddress, exchange.createRequest).
 *   - Dangerous procedures (send.*, sweep.*, wallet.derivePrivateKey) use
 *     `adminProcedure` which requires the `KMS_ADMIN_TOKEN` to be presented
 *     via the `Authorization: Bearer <token>` (or `x-admin-token`) header.
 *
 *   If `KMS_ADMIN_TOKEN` is not configured, the server logs a loud warning
 *   and allows all admin calls through — this keeps local development and
 *   the existing test suite working, but must never be the case in prod.
 */

import { initTRPC, TRPCError } from "@trpc/server"
import { z } from "zod"

// ─── Context ────────────────────────────────────────────────────────────────

export type KmsContext = {
  isAdmin: boolean
  /** Original incoming request, for debugging/logging. */
  req?: Request
}

const ADMIN_TOKEN = process.env.KMS_ADMIN_TOKEN?.trim() || null

if (!ADMIN_TOKEN) {
  console.warn(
    "[kms] ⚠️  KMS_ADMIN_TOKEN is NOT set — admin-only procedures (send.*, " +
    "sweep.*, wallet.derivePrivateKey) are UNPROTECTED. Configure this env " +
    "variable in production."
  )
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization")
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
  }
  const xAdmin = req.headers.get("x-admin-token")
  if (xAdmin) return xAdmin.trim()
  return null
}

export function createKmsContext(opts: { req: Request }): KmsContext {
  const token = extractBearerToken(opts.req)
  const isAdmin = ADMIN_TOKEN === null
    ? true // unprotected dev/test mode
    : token !== null && token === ADMIN_TOKEN
  return { isAdmin, req: opts.req }
}

/** Low-level helper for non-tRPC routes (e.g. /admin/notifications). */
export function requireAdmin(req: Request): void {
  if (ADMIN_TOKEN === null) return
  const token = extractBearerToken(req)
  if (token !== ADMIN_TOKEN) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Admin token required",
    })
  }
}

// ─── tRPC instance ───────────────────────────────────────────────────────────

const t = initTRPC.context<KmsContext>().create()

export const router = t.router
export const publicProcedure = t.procedure

/**
 * adminProcedure — rejects calls that do not present a valid KMS_ADMIN_TOKEN.
 * Used for every sensitive operation (signing, broadcasting, key derivation).
 *
 * When `KMS_ADMIN_TOKEN` is not configured (tests, local dev) the guard is a
 * no-op — a warning was already logged at module load time. In production the
 * variable must be set.
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (ADMIN_TOKEN === null) return next({ ctx })
  if (!ctx.isAdmin) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Admin token required",
    })
  }
  return next({ ctx })
})

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
