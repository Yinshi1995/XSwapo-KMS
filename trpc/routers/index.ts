/**
 * trpc/routers/index.ts — root appRouter merging all sub-routers
 */

import { router } from "../init"
import { walletRouter } from "./wallet"
import { balanceRouter } from "./balance"
import { feeRouter } from "./fee"
import { sendRouter } from "./send"
import { txRouter } from "./tx"

export const appRouter = router({
  wallet: walletRouter,
  balance: balanceRouter,
  fee: feeRouter,
  send: sendRouter,
  tx: txRouter,
})

export type AppRouter = typeof appRouter
