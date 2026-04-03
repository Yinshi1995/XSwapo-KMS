/**
 * trpc/routers/tx.ts — tx.status
 */

import { z } from "zod"
import { router, publicProcedure, ChainSchema, TxHashSchema } from "../init"
import { getTxStatus } from "../../index"

export const txRouter = router({
  status: publicProcedure
    .input(z.object({ txId: TxHashSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      return await getTxStatus(input.txId, input.chain)
    }),
})
