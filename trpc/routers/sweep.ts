/**
 * trpc/routers/sweep.ts — sweep.toExchange
 *
 * Thin tRPC wrapper around the reusable `performSweepToExchange` helper in
 * lib/sweep.ts. The wrapper exists for backwards compatibility with external
 * callers; the polling pipeline itself invokes `performSweepToExchange` in-
 * process to avoid a network round-trip to this server.
 */

import { z } from "zod"
import {
  router, publicProcedure,
  ChainSchema, AddressSchema, AmountSchema, PrivateKeySchema,
} from "../init"
import { performSweepToExchange, type SweepResult } from "../../lib/sweep"

export {
  extractFeeNative,
  toBigScale,
  fromBigScale,
  multiplyScaled,
  performSweepToExchange,
} from "../../lib/sweep"
export type { SweepResult } from "../../lib/sweep"

export const sweepRouter = router({
  toExchange: publicProcedure
    .input(
      z.object({
        destinationAddress: AddressSchema,
        chain: ChainSchema,
        amount: AmountSchema,
        contractAddress: z.string().min(1).optional(),
        decimals: z.number({ coerce: true }).int().optional(),
        depositPrivateKey: PrivateKeySchema,
        depositAddress: AddressSchema,
        gasPrivateKey: PrivateKeySchema,
        gasAddress: AddressSchema,
        gasFeeMultiplier: z.number().positive().optional(),
        gasMinReserve: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<SweepResult> => {
      return await performSweepToExchange(input)
    }),
})
