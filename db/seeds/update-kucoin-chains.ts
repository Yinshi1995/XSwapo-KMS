/**
 * Seed: update kucoinChainCode for all networks.
 * Pure SQL via pg — no Prisma client needed.
 */
import pg from "pg"

export async function seedKucoinChains() {
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

  // code → kucoinChainCode (null = not on KuCoin)
  const mapping: [string, string | null][] = [
    // Tier 1
  ["ETH",      "eth"],
  ["BSC",      "bsc"],
  ["TRX",      "trx"],
  ["MATIC",    "matic"],
  ["BTC",      "btc"],
  ["SOL",      "sol"],
  ["ARB",      "arbitrum"],
  ["OP",       "optimism"],
  ["BASE",     "base"],
  ["AVAX",     "avaxc"],
  ["XRP",      "xrp"],
  ["XLM",      "xlm"],
  ["LTC",      "ltc"],
  ["DOGE",     "doge"],
  ["ZK",       null],
  ["FLR",      "flare"],
  ["KAIA",     "klay"],
  // Tier 2
  ["ALGO",     "algo"],
  ["BCH",      "bchn"],
  ["ADA",      "ada"],
  ["CELO",     "celo"],
  ["DOT",      "statemint"],
  ["NEAR",     "near"],
  ["XTZ",      "xtz"],
  ["EGLD",     "egld"],
  ["FTM",      "ftm"],
  ["CRO",      null],
  ["GLMR",     "glmr"],
  ["S",        "sonic"],
  ["BERA",     "bera"],
  ["UNI_L2",   null],
  ["MON",      "monad"],
  ["SUI",      "sui"],
  ["TON",      "ton"],
  ["ZEC",      "zec"],
  ["XDC",      "xdc"],
  ["DOT_AH",   "statemint"],
  ["ETC",      "etc"],
  ["CHZ",      null],
  ["LUMIA",    "lumia"],
  ["IOTA",     "iotamainnet"],
  // Tier 3
  ["ARBNOVA",  null],
  ["AURORA",   null],
  ["RON",      null],
  ["ROSE",     "oasis"],
  ["RBTC",     null],
  ["GNO",      null],
  ["ISLM",     "haqq"],
  ["ONE",      "one"],
  ["KCS",      "kcc"],
  ["LSK",      null],
  ["HYPEREVM", "hyperevm"],
  ["MEGAETH",  null],
  ["MOCA",     null],
  ["PLASMA",   null],
  ["PLUME",    null],
  ["ABSTRACT", null],
  ["ATOM",     "atom"],
  ["KSM",      "statemine"],
  ["KSM_AH",  "statemine"],
  ["VET",      "vet"],
  ["ZIL",      "zil"],
  ["CSPR",     "cspr"],
  ["EOS",      "eos"],
    ["OM",       "mantra"],
  ]

  let updated = 0
  let skipped = 0

  for (const [code, chainCode] of mapping) {
    const res = await client.query(
      `UPDATE "Network" SET "kucoinChainCode" = $1, "updatedAt" = now() WHERE code = $2`,
      [chainCode, code],
    )
    if (res.rowCount && res.rowCount > 0) {
      console.log(`  ✔ ${code}: → ${chainCode ?? "NULL"}`)
      updated++
    } else {
      skipped++
    }
  }

  console.log(`\nDone — ${updated} updated, ${skipped} unchanged`)
  await client.end()
}
