/**
 * trpc/server.ts — Bun.serve() with tRPC fetchRequestHandler + /health
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "./routers/index"

const PORT = Number(process.env.PORT ?? 3001)

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)

  // ── Health check (plain GET, outside tRPC) ──────────────────────────────
  if (req.method === "GET" && url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        chains: [
          "ethereum-mainnet", "bsc-mainnet", "polygon-mainnet",
          "tron-mainnet", "bitcoin-mainnet", "solana-mainnet",
        ],
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }

  // ── tRPC handler ────────────────────────────────────────────────────────
  if (url.pathname.startsWith("/trpc")) {
    return fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => ({}),
    })
  }

  // ── Fallback ────────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({ error: `Unknown route: ${url.pathname}` }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  )
}

console.log(`🚀 RPC microservice running on http://localhost:${PORT}`)
console.log(`   tRPC endpoint: /trpc`)
console.log(`   Health check:  GET /health`)
console.log(`   Chains: ETH | BSC | POLYGON | TRON | BTC | SOL + 12 more`)

Bun.serve({
  port: PORT,
  fetch: handle,
})
