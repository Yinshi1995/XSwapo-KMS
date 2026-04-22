/**
 * trpc/routers/send.ts — send.native, send.token
 *
 * Both procedures are admin-only. The caller supplies the *source address*
 * (a DepositAddress or GasWallet stored in KMS); the server resolves the
 * encrypted mnemonic + HD index from Postgres, decrypts locally, derives the
 * private key, signs and broadcasts. Private keys never leave the KMS
 * process.
 *
 * For backwards compatibility, the legacy `privateKey` / `mnemonic` /
 * `fromIndex` / `fromAddress` inputs are still accepted (admin-only). If
 * neither a signer identifier (`from`) nor raw keys are present, the
 * procedure errors.
 */

import { z } from "zod"
import { TRPCError } from "@trpc/server"
import {
  router, adminProcedure,
  ChainSchema, AddressSchema, AmountSchema,
  PrivateKeySchema, MnemonicSchema, IndexSchema, ContractAddressSchema,
} from "../init"
import { sendNative, sendToken } from "../../index"
import { resolveSignerByAddress, WalletResolutionError } from "../../lib/walletResolver"

async function resolveSigner(
  from: string | undefined,
  explicitAddress?: string,
): Promise<{ mnemonic: string; fromIndex: number; fromAddress: string } | null> {
  const address = from ?? explicitAddress
  if (!address) return null
  try {
    const signer = await resolveSignerByAddress(address)
    return {
      mnemonic: signer.mnemonic,
      fromIndex: signer.index,
      fromAddress: signer.address,
    }
  } catch (err) {
    if (err instanceof WalletResolutionError) {
      throw new TRPCError({ code: "NOT_FOUND", message: err.message })
    }
    throw err
  }
}

// A caller must identify the source of funds somehow: either by managed
// address (`from`) — the recommended flow — or by supplying raw key material
// explicitly (legacy). Catching this at the Zod boundary turns a late
// `EVM sendNative requires privateKey` 500 into a crisp 400 with an
// actionable message.
const SIGNER_SOURCE_REQUIRED =
  "Missing signer source: pass `from` (managed wallet address), " +
  "or `privateKey`, or `mnemonic` (+ `fromIndex`, and `fromAddress` for UTXO chains)."

const NativeSendInput = z
  .object({
    chain: ChainSchema,
    to: AddressSchema,
    amount: AmountSchema,
    /** Address of the KMS-managed wallet to spend from. KMS resolves it. */
    from: AddressSchema.optional(),
    changeAddress: AddressSchema.optional(),
    // Legacy escape hatches — still honored for admin callers.
    privateKey: PrivateKeySchema.optional(),
    mnemonic: MnemonicSchema.optional(),
    fromIndex: IndexSchema.optional().default(0),
    fromAddress: AddressSchema.optional(),
  })
  .refine(
    (i) => Boolean(i.from ?? i.privateKey ?? i.mnemonic ?? i.fromAddress),
    { message: SIGNER_SOURCE_REQUIRED, path: ["from"] },
  )

const TokenSendInput = z
  .object({
    chain: ChainSchema,
    to: AddressSchema,
    amount: AmountSchema,
    contractAddress: ContractAddressSchema,
    from: AddressSchema.optional(),
    decimals: z.number({ coerce: true }).int().optional(),
    privateKey: PrivateKeySchema.optional(),
    mnemonic: MnemonicSchema.optional(),
    fromIndex: IndexSchema.optional().default(0),
  })
  .refine(
    (i) => Boolean(i.from ?? i.privateKey ?? i.mnemonic),
    { message: SIGNER_SOURCE_REQUIRED, path: ["from"] },
  )

export const sendRouter = router({
  native: adminProcedure
    .input(NativeSendInput)
    .mutation(async ({ input }) => {
      const resolved = await resolveSigner(input.from, input.fromAddress)

      return await sendNative({
        chain: input.chain,
        to: input.to,
        amount: input.amount,
        changeAddress: input.changeAddress,
        privateKey: input.privateKey,
        mnemonic: input.mnemonic ?? resolved?.mnemonic,
        fromIndex: input.mnemonic ? input.fromIndex : resolved?.fromIndex ?? input.fromIndex,
        fromAddress: input.fromAddress ?? resolved?.fromAddress,
      })
    }),

  token: adminProcedure
    .input(TokenSendInput)
    .mutation(async ({ input }) => {
      const resolved = await resolveSigner(input.from)

      return await sendToken({
        chain: input.chain,
        to: input.to,
        amount: input.amount,
        contractAddress: input.contractAddress,
        decimals: input.decimals,
        privateKey: input.privateKey,
        mnemonic: input.mnemonic ?? resolved?.mnemonic,
        fromIndex: input.mnemonic ? input.fromIndex : resolved?.fromIndex ?? input.fromIndex,
      })
    }),
})
