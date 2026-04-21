# CLAUDE.md — kms (XSwapO RPC / KMS service)

Guidance for Claude when editing code in `kms/`. See `../CLAUDE.md` for monorepo-wide rules and `./DOCS.md` for the full API reference.

## Commands

```bash
bun install                    # install deps (runs `prisma generate` via postinstall)
bun run dev                    # watch mode — tRPC server on :3001
bun run start                  # production start (no watch)
bun test                       # full suite (wallet, chains, tRPC, exchange, crypto)
bun test --watch               # watch mode
bun test tests/wallet.test.ts  # single file
bun x prisma generate          # regenerate Prisma client after schema change
bun x prisma migrate dev       # new migration (dev)
bun x prisma migrate deploy    # apply migrations (prod)
```

No linter/formatter configured.

## Architecture

Multi-chain RPC + signing microservice. tRPC v11 over Bun. One HTTP surface (`POST|GET /trpc/<router>.<procedure>`) dispatches into a per-family chain module.

```
trpc/server.ts (Bun.serve) → trpc/routers/index.ts (appRouter)
  ├─ wallet   → generate, deriveAddress, derivePrivateKey
  ├─ balance  → native, token
  ├─ fee      → estimate
  ├─ send     → native, token
  ├─ tx       → status
  └─ exchange → createRequest
            │
            ▼
        index.ts (getFamily dispatch) → chains/<family>.ts
```

### Key files

| File | Responsibility |
|------|---------------|
| `trpc/server.ts` | `Bun.serve()` + `fetchRequestHandler`; exposes `GET /health` and `/trpc/*` |
| `trpc/init.ts` | tRPC instance, shared Zod schemas |
| `trpc/routers/*.ts` | Per-domain routers — thin validation + dispatch into chain modules |
| `index.ts` | `getFamily(chain)` → returns the chain module implementing the family interface |
| `chains/evm.ts` | All EVM chains (Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base, …) |
| `chains/bitcoin.ts` | BTC, LTC, DOGE, BCH (UTXO, BIP-84, bitcoinjs-lib) |
| `chains/tron.ts` | TRON + TRC-20 (tronweb) |
| `chains/solana.ts` | Solana + SPL (web3.js, Ed25519) |
| `chains/<ed25519>.ts` | XRP, Stellar, Algorand, NEAR, Polkadot, Cardano, Tezos, MultiversX, Cosmos, Sui, TON |
| `lib/crypto.ts` | AES-256-GCM mnemonic encryption (`surprise` DB field) |
| `lib/spotRate.ts` | Tatum Price API spot-rate fetcher |
| `lib/orderId.ts` | Human-readable order ID generator |
| `gateway.ts` | Tatum RPC URL builder |

### Supported families

18 families, 80+ networks. See `DOCS.md` for the full table. Family dispatch is pure: `getFamily("ethereum-mainnet")` returns the EVM module; no runtime state.

## Conventions

- **Pure functions, no classes, no singletons.** Every chain module exports a small set of free functions that match the family interface.
- **Zod validation at the tRPC boundary.** Never bypass it inside a router.
- **Never return private keys by default.** `wallet.derivePrivateKey` and `send.*` are the only procedures that touch secrets.
- **HD derivation:**
  - EVM: 12-word mnemonic, BIP-44 path `m/44'/60'/0'/0/<index>`
  - Bitcoin/UTXO: 24-word, BIP-84 `zpub`
  - Ed25519 chains: 24-word mnemonic stored in the `xpub` field (there is no xpub for Ed25519) — this is intentional, don't "fix" it.
- **All amounts are strings** at the API boundary. Internal math uses `Decimal` or `bigint` — never `number`.
- **UTXO dust limit: 546 satoshis.** Enforced in `chains/bitcoin.ts`.
- **Tatum Gateway** is the RPC provider. Use `gatewayUrl(chain)` rather than hardcoding endpoints.

## Environment variables

```
PORT=3001
TATUM_API_KEY              # Tatum API key (gateway + price + subscription)
DATABASE_URL               # Postgres
SECRET                     # AES-256-GCM key for mnemonic encryption
SALT_ROUNDS=10             # PBKDF2 iterations
TATUM_WEBHOOK_URL          # where Tatum posts ADDRESS_EVENT (consumed by webhook/)
TATUM_SUBSCRIPTION_NETWORK_TYPE=mainnet
```

Never log these. Never return them from an endpoint.

## Testing

- Bun built-in test runner. Files live in `tests/*.test.ts`.
- Unit-ish with mocked HTTP (Tatum, RPC). Real crypto / real Zod / real routing.
- When adding a new chain family: at minimum add a test in `tests/wallet.test.ts` (derivation) and `tests/routing.test.ts` (`getFamily`), plus happy-path tests in `tests/server.test.ts` for `balance`, `fee`, `send`.

## Common tasks

**Add a new EVM chain**
1. Add it to the supported-chains map in `chains/evm.ts` (RPC URL slug, chainId).
2. Add it to the `getFamily` table in `index.ts` (returns the EVM module).
3. Extend `tests/routing.test.ts` with an assertion for the new slug.
4. Run `bun test tests/routing.test.ts`.

**Add a new family**
1. Create `chains/<family>.ts` implementing: `generate`, `deriveAddress`, `derivePrivateKey`, `balanceNative`, `balanceToken?`, `feeEstimate`, `sendNative`, `sendToken?`, `txStatus`.
2. Register it in `index.ts::getFamily`.
3. Add dependency to `package.json` (only if needed).
4. Add tests to `tests/wallet.test.ts` and `tests/server.test.ts`.

**Change a tRPC procedure's input/output**
→ Update `webhook/src/services/kms.ts` in the same commit. Otherwise the contract is broken.
