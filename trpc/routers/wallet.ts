/**
 * trpc/routers/wallet.ts — wallet.generate, wallet.deriveAddress, wallet.derivePrivateKey
 */

import { z } from "zod"
import {
  router, publicProcedure, adminProcedure,
  ChainSchema, XpubSchema, IndexSchema, MnemonicSchema,
} from "../init"
import { generateWallet, deriveAddress, derivePrivateKey } from "../../index"

export const walletRouter = router({
  generate: publicProcedure
    .input(z.object({ chain: ChainSchema }))
    .mutation(({ input }) => {
      return generateWallet(input.chain)
    }),

  deriveAddress: publicProcedure
    .input(z.object({ xpub: XpubSchema, index: IndexSchema, chain: ChainSchema }))
    .query(async ({ input }) => {
      return await deriveAddress(input.xpub, input.index, input.chain)
    }),

  /** Admin-only: exposes a raw private key. Never call this from client code. */
  derivePrivateKey: adminProcedure
    .input(z.object({ mnemonic: MnemonicSchema, index: IndexSchema, chain: ChainSchema }))
    .query(({ input }) => {
      return { key: derivePrivateKey(input.mnemonic, input.index, input.chain) }
    }),
})
