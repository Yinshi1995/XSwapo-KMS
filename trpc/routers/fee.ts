/**
 * trpc/routers/fee.ts — fee.estimate
 */

import { z } from "zod"
import { router, publicProcedure, ChainSchema, AddressSchema, AmountSchema, ContractAddressSchema } from "../init"
import { estimateFee } from "../../index"

export const feeRouter = router({
  estimate: publicProcedure
    .input(
      z.object({
        chain: ChainSchema,
        from: AddressSchema,
        to: AddressSchema,
        amount: AmountSchema.optional(),
        contractAddress: ContractAddressSchema.optional(),
        data: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await estimateFee(input)
    }),
})
