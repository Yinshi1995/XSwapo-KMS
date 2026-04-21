import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

// ─── Connection-pool tuning ──────────────────────────────────────────
//
// The pipeline (deposit-poller + transfer-watcher + notifications) shares a
// single PrismaClient, so a small pool is enough. A large default pool (10)
// multiplied by all services in the project quickly exhausts Postgres'
// `max_connections`, which triggers Prisma P2037 "Too many connections".
//
// Override via env if you need more throughput for the RPC workers:
//   DATABASE_POOL_MAX=5 (default)
//   DATABASE_POOL_IDLE_MS=10000
//   DATABASE_POOL_CONNECT_TIMEOUT_MS=10000

const POOL_MAX = Math.max(1, Number(process.env.DATABASE_POOL_MAX ?? 5))
const IDLE_TIMEOUT_MS = Number(process.env.DATABASE_POOL_IDLE_MS ?? 10_000)
const CONNECT_TIMEOUT_MS = Number(process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS ?? 10_000)

// Singleton guard — survives hot-reload and accidental re-imports so we never
// leak multiple pg.Pool instances into the same process.
type PgSingleton = {
  pool: pg.Pool
  db: PrismaClient
}

const globalForDb = globalThis as unknown as { __kms_db__?: PgSingleton }

function createSingleton(): PgSingleton {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: POOL_MAX,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  })

  pool.on("error", (err) => {
    console.error("[pg] idle client error:", err.message)
  })

  const adapter = new PrismaPg(pool)
  const db = new PrismaClient({ adapter })

  console.info(
    `[pg] pool initialized (max=${POOL_MAX}, idle=${IDLE_TIMEOUT_MS}ms, connect=${CONNECT_TIMEOUT_MS}ms)`,
  )

  return { pool, db }
}

const singleton = globalForDb.__kms_db__ ?? createSingleton()
if (process.env.NODE_ENV !== "production") {
  globalForDb.__kms_db__ = singleton
}

export * from "@prisma/client"
export default singleton.db
