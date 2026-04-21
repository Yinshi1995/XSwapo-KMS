/**
 * pipeline/kms-local.ts — in-process drop-in replacement for the old
 * `services/kms.ts` HTTP client from the standalone webhook service.
 *
 * Now that the pipeline lives inside the KMS process, we invoke the chain
 * operations directly instead of round-tripping through tRPC.
 */

import {
  derivePrivateKey as kmsDerivePrivateKey,
  getBalance as kmsGetNativeBalance,
  getTokenBalance as kmsGetTokenBalance,
  getTxStatus as kmsGetTxStatus,
} from "../index"
import { performSweepToExchange } from "../lib/sweep"

export type {
  SweepResult,
  SweepErrorCode,
  SweepToExchangeParams,
} from "../lib/sweep"

// ─── Sweep ───────────────────────────────────────────────────────────

export async function sweepToExchange(
  params: import("../lib/sweep").SweepToExchangeParams,
  requestId?: string,
): Promise<import("../lib/sweep").SweepResult> {
  const tag = requestId ? `[kms-local:${requestId}]` : "[kms-local]"
  console.info(`${tag} sweep.toExchange (in-process)`)
  return performSweepToExchange(params)
}

// ─── Derive private key ──────────────────────────────────────────────

export interface DerivePrivateKeyParams {
  mnemonic: string
  index: number
  chain: string
}

export async function derivePrivateKey(
  params: DerivePrivateKeyParams,
  _requestId?: string,
): Promise<string> {
  return kmsDerivePrivateKey(params.mnemonic, params.index, params.chain)
}

// ─── Balance ─────────────────────────────────────────────────────────

export interface GetBalanceParams {
  address: string
  chain: string
  contractAddress?: string
  decimals?: number
}

export interface GetBalanceResult {
  balance: string
  raw?: string
}

export async function getBalance(
  params: GetBalanceParams,
  _requestId?: string,
): Promise<GetBalanceResult> {
  if (params.contractAddress) {
    const result = await kmsGetTokenBalance(
      params.address,
      params.contractAddress,
      params.chain,
    )
    return { balance: result.balance, raw: (result as { raw?: string }).raw }
  }

  const result = await kmsGetNativeBalance(params.address, params.chain)
  return { balance: result.balance, raw: (result as { raw?: string }).raw }
}

// ─── Transaction status ──────────────────────────────────────────────

export type TxStatusKind = "confirmed" | "failed" | "pending"

export interface GetTxStatusResult {
  status: TxStatusKind
  blockNumber?: number | null
  raw: unknown
}

/**
 * Normalize chain-specific getTxStatus() return shapes into a common
 * { status } envelope the watcher can switch on.
 */
export async function getTxStatus(
  txId: string,
  chain: string,
): Promise<GetTxStatusResult> {
  const raw = (await kmsGetTxStatus(txId, chain)) as {
    status?: string
    blockNumber?: number | null
  }
  const status: TxStatusKind =
    raw.status === "confirmed" || raw.status === "failed"
      ? raw.status
      : "pending"
  return { status, blockNumber: raw.blockNumber ?? null, raw }
}
