/**
 * trpc/routers/balance.ts — balance.native, balance.token
 */

import { z } from "zod"
import { router, publicProcedure, ChainSchema, AddressSchema, ContractAddressSchema } from "../init"
import { getBalance, getTokenBalance, getFamily } from "../../index"
import db, { DepositSource } from "../../db"
import { getExchangeProvider } from "../../pipeline/exchange"
import type { KuCoinExchangeAdapter } from "../../pipeline/exchange/kucoin/adapter"
import type { Balance } from "../../types"

/**
 * Get balance for exchange-managed coins (e.g. XMR via KuCoin).
 * Uses exchange API instead of on-chain RPC.
 */
async function getExchangeBalance(chain: string): Promise<Balance> {
  // Find the network
  const network = await db.network.findFirst({
    where: { chain: { equals: chain, mode: "insensitive" } },
  })

  if (!network) {
    throw new Error(`Network not found: ${chain}`)
  }

  if (network.depositSource !== DepositSource.KUCOIN) {
    throw new Error(`Exchange balance only supported for KUCOIN deposit source, got: ${network.depositSource}`)
  }

  // Use nativeCoin or derive from chain name (e.g. "MONERO" -> "XMR")
  const coinCode = network.nativeCoin ?? network.code.toUpperCase()

  const provider = getExchangeProvider()
  if (provider.name !== "kucoin") {
    throw new Error(`Exchange provider is not KuCoin: ${provider.name}`)
  }

  const kucoinAdapter = provider as KuCoinExchangeAdapter
  const balance = await kucoinAdapter.getBalance(coinCode, "main")

  return {
    balance,
    raw: balance, // KuCoin returns human-readable amounts
  }
}

export const balanceRouter = router({
  native: publicProcedure
    .input(z.object({ address: AddressSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      // Check if this is an exchange-managed chain
      if (getFamily(input.chain) === "exchange") {
        return await getExchangeBalance(input.chain)
      }
      return await getBalance(input.address, input.chain)
    }),

  token: publicProcedure
    .input(z.object({ address: AddressSchema, contractAddress: ContractAddressSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      return await getTokenBalance(input.address, input.contractAddress, input.chain)
    }),
})
