/**
 * lib/walletResolver.ts — resolve an on-chain address to its signing material.
 *
 * The KMS is the single source of truth for private keys. External callers
 * (webhook, admin UI) never pass raw keys or plaintext mnemonics — they pass
 * the address, and this module looks up the encrypted mnemonic + HD index in
 * the KMS Postgres, decrypts locally, and returns the signer.
 *
 * Two address types are supported:
 *   - DepositAddress   → derives from MasterWallet.surprise at DepositAddress.index
 *   - GasWallet        → derives from GasWallet.surprise at index 0
 *
 * `resolveSignerByAddress` is used by send/sweep routers. `resolvePrivateKey
 * ByAddress` is a convenience wrapper that additionally derives the private
 * key for the requested chain family.
 */

import db from "../db/index"
import { decryptMnemonic } from "./crypto"
import { derivePrivateKey } from "../index"

export type ResolvedSigner = {
  mnemonic: string
  /** HD derivation index. */
  index: number
  /** Source of the signer — useful for logging. */
  source: "deposit" | "gas"
  /** The resolved address (canonical form from DB). */
  address: string
}

export class WalletResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WalletResolutionError"
  }
}

/**
 * Look up `{ mnemonic, index }` for the given on-chain address.
 *
 * Order:
 *   1. DepositAddress (joined with MasterWallet)
 *   2. GasWallet (always index 0)
 *
 * Throws WalletResolutionError if the address is unknown or its encrypted
 * mnemonic is missing.
 */
export async function resolveSignerByAddress(address: string): Promise<ResolvedSigner> {
  const trimmed = address.trim()
  if (!trimmed) {
    throw new WalletResolutionError("Address is required")
  }

  // 1. Deposit address
  const deposit = await db.depositAddress.findFirst({
    where: {
      address: {
        equals: trimmed,
        mode: "insensitive",
      },
    },
    include: {
      masterWallet: true,
    },
  })

  if (deposit) {
    const enc = deposit.masterWallet?.surprise
    if (!enc) {
      throw new WalletResolutionError(
        `Deposit address ${deposit.address} has no encrypted mnemonic on its MasterWallet`
      )
    }
    return {
      mnemonic: decryptMnemonic(enc),
      index: deposit.index,
      source: "deposit",
      address: deposit.address,
    }
  }

  // 2. Gas wallet
  const gas = await db.gasWallet.findFirst({
    where: {
      address: {
        equals: trimmed,
        mode: "insensitive",
      },
    },
  })

  if (gas) {
    if (!gas.surprise) {
      throw new WalletResolutionError(
        `GasWallet ${gas.address} has no encrypted mnemonic`
      )
    }
    return {
      mnemonic: decryptMnemonic(gas.surprise),
      index: 0,
      source: "gas",
      address: gas.address,
    }
  }

  throw new WalletResolutionError(
    `No deposit address or gas wallet found for ${trimmed}`
  )
}

/**
 * Convenience: resolve a signer and derive the private key for `chain`.
 */
export async function resolvePrivateKeyByAddress(
  address: string,
  chain: string,
): Promise<{ privateKey: string; signer: ResolvedSigner }> {
  const signer = await resolveSignerByAddress(address)
  const privateKey = derivePrivateKey(signer.mnemonic, signer.index, chain)
  return { privateKey, signer }
}
