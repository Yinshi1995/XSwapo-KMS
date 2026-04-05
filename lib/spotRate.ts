/**
 * lib/spotRate.ts — Spot rate helper using Tatum Price API
 *
 * Fetches USD prices for both coins via Tatum and computes the ratio.
 */

import { fetchSingleRate } from "../trpc/lib/tatumClient"

export async function getSpotRate(fromCode: string, toCode: string): Promise<number> {
  const [fromRate, toRate] = await Promise.all([
    fetchSingleRate(fromCode, "USD"),
    fetchSingleRate(toCode, "USD"),
  ])

  const fromPrice = parseFloat(fromRate.value)
  const toPrice = parseFloat(toRate.value)

  if (!fromPrice || !toPrice) {
    throw new Error(`Cannot determine exchange rate for ${fromCode}→${toCode}: missing price data`)
  }

  return parseFloat((fromPrice / toPrice).toFixed(8))
}
