/**
 * trpc/routers/balance.ts — balance.native, balance.token
 */

import { z } from "zod"
import { router, publicProcedure, ChainSchema, AddressSchema, ContractAddressSchema } from "../init"
import { getBalance, getTokenBalance } from "../../index"

export const balanceRouter = router({
  native: publicProcedure
    .input(z.object({ address: AddressSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      return await getBalance(input.address, input.chain)
    }),

  token: publicProcedure
    .input(z.object({ address: AddressSchema, contractAddress: ContractAddressSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      return await getTokenBalance(input.address, input.contractAddress, input.chain)
    }),
})
