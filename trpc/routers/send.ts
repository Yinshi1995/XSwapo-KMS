/**
 * trpc/routers/send.ts — send.native, send.token
 */

import { z } from "zod"
import {
  router, publicProcedure,
  ChainSchema, AddressSchema, AmountSchema,
  PrivateKeySchema, MnemonicSchema, IndexSchema, ContractAddressSchema,
} from "../init"
import { sendNative, sendToken } from "../../index"

export const sendRouter = router({
  native: publicProcedure
    .input(
      z.object({
        chain: ChainSchema,
        to: AddressSchema,
        amount: AmountSchema,
        privateKey: PrivateKeySchema.optional(),
        mnemonic: MnemonicSchema.optional(),
        fromIndex: IndexSchema.optional().default(0),
        fromAddress: AddressSchema.optional(),
        changeAddress: AddressSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await sendNative(input)
    }),

  token: publicProcedure
    .input(
      z.object({
        chain: ChainSchema,
        to: AddressSchema,
        amount: AmountSchema,
        contractAddress: ContractAddressSchema,
        privateKey: PrivateKeySchema.optional(),
        mnemonic: MnemonicSchema.optional(),
        fromIndex: IndexSchema.optional().default(0),
        decimals: z.number({ coerce: true }).int().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await sendToken(input)
    }),
})
