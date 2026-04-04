/**
 * trpc/routers/rate.ts — rate.getCryptoRate, rate.getCryptoRatio
 */

import { z } from "zod"
import { router, publicProcedure } from "../init"
import { fetchSingleRate, fetchBatchRates } from "../lib/tatumClient"

export const rateRouter = router({
  getCryptoRate: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
        basePair: z
          .string()
          .min(1)
          .max(10)
          .transform((s) => s.toUpperCase())
          .default("USD"),
      }),
    )
    .query(async ({ input }) => {
      const data = await fetchSingleRate(input.symbol, input.basePair)
      return {
        symbol: data.symbol,
        basePair: data.basePair,
        value: parseFloat(data.value),
        source: data.source,
        timestamp: new Date(data.timestamp).toISOString(),
      }
    }),

  getCryptoRatio: publicProcedure
    .input(
      z.object({
        from: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
        to: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
      }),
    )
    .query(async ({ input }) => {
      const [fromRate, toRate] = await fetchBatchRates([
        { currency: input.from, basePair: "USD" },
        { currency: input.to, basePair: "USD" },
      ])
      const fromPrice = parseFloat(fromRate.value)
      const toPrice = parseFloat(toRate.value)
      return {
        from: input.from,
        to: input.to,
        ratio: parseFloat((fromPrice / toPrice).toFixed(8)),
        fromPriceUsd: fromPrice,
        toPriceUsd: toPrice,
        timestamp: new Date().toISOString(),
      }
    }),
})
