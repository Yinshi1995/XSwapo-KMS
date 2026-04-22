/**
 * trpc/server.ts — Bun.serve() with tRPC fetchRequestHandler + /health
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "./routers/index"
import { createKmsContext, extractBearerToken } from "./init"
import { startPipeline, stopPipeline } from "../pipeline"
import { handleAdminNotificationsRequest } from "../pipeline/notifications/admin"

const PORT = Number(process.env.PORT ?? 3001)
const PIPELINE_ENABLED = process.env.PIPELINE_DISABLED !== "1"
const ADMIN_TOKEN = process.env.KMS_ADMIN_TOKEN?.trim() || null

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "Admin token required" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  )
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)

  // ── Health check (plain GET, outside tRPC) ──────────────────────────────
  if (req.method === "GET" && url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        pipeline: PIPELINE_ENABLED,
        authEnabled: ADMIN_TOKEN !== null,
        chains: [
          "ethereum-mainnet", "bsc-mainnet", "polygon-mainnet",
          "tron-mainnet", "bitcoin-mainnet", "solana-mainnet",
        ],
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )
  }

  // ── Admin notifications API ─────────────────────────────────────────────
  if (url.pathname.startsWith("/admin/notifications")) {
    if (ADMIN_TOKEN !== null && extractBearerToken(req) !== ADMIN_TOKEN) {
      return unauthorized()
    }
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID()
    return handleAdminNotificationsRequest(req, requestId)
  }

  // ── tRPC handler ────────────────────────────────────────────────────────
  if (url.pathname.startsWith("/trpc")) {
    return fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => createKmsContext({ req }),
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

if (PIPELINE_ENABLED) {
  void startPipeline()

  const shutdown = async () => {
    console.log("\n[server] graceful shutdown initiated")
    await stopPipeline()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
} else {
  console.log("[server] pipeline disabled via PIPELINE_DISABLED=1")
}
