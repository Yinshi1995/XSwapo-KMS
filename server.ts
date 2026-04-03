/**
 * server.ts — HTTP сервер микросервиса (tRPC v11)
 *
 * Запуск: bun run server.ts
 *
 * tRPC endpoint: /trpc
 * Health check:  GET /health
 *
 * Procedures:
 *   wallet.generate          (mutation)
 *   wallet.deriveAddress     (query)
 *   wallet.derivePrivateKey  (query)
 *   balance.native           (query)
 *   balance.token            (query)
 *   fee.estimate             (query)
 *   send.native              (mutation)
 *   send.token               (mutation)
 *   tx.status                (query)
 */

// Re-export handle from tRPC server for backward compatibility (tests)
export { handle } from "./trpc/server"

// Re-export requireFields for tests
export function requireFields<T extends Record<string, any>>(
  body: T,
  fields: string[]
): T {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === "") {
      throw new Error(`Missing required field: "${f}"`)
    }
  }
  return body
}