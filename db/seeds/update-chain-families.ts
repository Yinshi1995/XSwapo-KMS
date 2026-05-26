/**
 * Seed: update chainFamily for all networks.
 * Pure SQL via pg — UPDATE only, does not replace any other columns.
 */
import pg from "pg"

export async function seedChainFamilies() {
  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set")
    process.exit(1)
  }

  console.log("Connecting to DB...")
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  // code → chainFamily
  const mapping: [string, string][] = [
    // EVM chains
    ["ETH",      "evm"],
    ["BSC",      "evm"],
    ["MATIC",    "evm"],
    ["ARB",      "evm"],
    ["OP",       "evm"],
    ["BASE",     "evm"],
    ["AVAX",     "evm"],
    ["FTM",      "evm"],
    ["CRO",      "evm"],
    ["CELO",     "evm"],
    ["GLMR",     "evm"],
    ["ZK",       "evm"],
    ["FLR",      "evm"],
    ["KAIA",     "evm"],
    ["S",        "evm"],
    ["BERA",     "evm"],
    ["UNI_L2",   "evm"],
    ["MON",      "evm"],
    ["ZEC",      "evm"],
    ["XDC",      "evm"],
    ["ETC",      "evm"],
    ["CHZ",      "evm"],
    ["LUMIA",    "evm"],
    ["IOTA",     "evm"],
    ["ARBNOVA",  "evm"],
    ["AURORA",   "evm"],
    ["RON",      "evm"],
    ["ROSE",     "evm"],
    ["RBTC",     "evm"],
    ["GNO",      "evm"],
    ["ISLM",     "evm"],
    ["ONE",      "evm"],
    ["KCS",      "evm"],
    ["LSK",      "evm"],
    ["HYPEREVM", "evm"],
    ["MEGAETH",  "evm"],
    ["MOCA",     "evm"],
    ["PLASMA",   "evm"],
    ["PLUME",    "evm"],
    ["ABSTRACT", "evm"],
    ["ZIL",      "evm"],
    ["CSPR",     "evm"],
    ["EOS",      "evm"],
    ["OM",       "evm"],
    // UTXO chains
    ["BTC",      "bitcoin"],
    ["LTC",      "litecoin"],
    ["DOGE",     "dogecoin"],
    ["BCH",      "bitcoincash"],
    // Other L1s
    ["TRX",      "tron"],
    ["SOL",      "solana"],
    ["XRP",      "xrp"],
    ["XLM",      "stellar"],
    ["ALGO",     "algorand"],
    ["NEAR",     "near"],
    ["DOT",      "polkadot"],
    ["DOT_AH",   "polkadot"],
    ["KSM",      "polkadot"],
    ["KSM_AH",   "polkadot"],
    ["ADA",      "cardano"],
    ["XTZ",      "tezos"],
    ["EGLD",     "multiversx"],
    ["VET",      "vechain"],
    ["ATOM",     "cosmos"],
    ["SUI",      "sui"],
    ["TON",      "ton"],
    // Exchange-managed (no on-chain RPC)
    ["XMR",      "exchange"],
  ]

  let updated = 0
  let skipped = 0

  for (const [code, family] of mapping) {
    const res = await client.query(
      `UPDATE "Network" SET chainfamily = $1, "updatedAt" = now() WHERE code = $2`,
      [family, code],
    )
    if (res.rowCount && res.rowCount > 0) {
      console.log(`  ✔ ${code}: → ${family}`)
      updated++
    } else {
      skipped++
    }
  }

  console.log(`\nDone — ${updated} updated, ${skipped} not found in DB`)
  await client.end()
}
