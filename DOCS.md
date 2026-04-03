# XSwapO RPC Service — API Documentation

> Multi-chain RPC microservice built with **Bun**, **tRPC v11**, and **Zod** validation.  
> Supports **18 chain families** and **80+ networks** through a unified API.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Supported Chains](#supported-chains)
- [Health Check](#health-check)
- [API Reference](#api-reference)
  - [wallet.generate](#walletgenerate)
  - [wallet.deriveAddress](#walletderiveaddress)
  - [wallet.derivePrivateKey](#walletderiveprivatekey)
  - [balance.native](#balancenative)
  - [balance.token](#balancetoken)
  - [fee.estimate](#feeestimate)
  - [send.native](#sendnative)
  - [send.token](#sendtoken)
  - [tx.status](#txstatus)
- [tRPC Wire Format](#trpc-wire-format)
- [Chain-Specific Notes](#chain-specific-notes)
- [Error Handling](#error-handling)
- [Security](#security)
- [Deployment](#deployment)

---

## Quick Start

```bash
# Install dependencies
bun install

# Start the server
bun run start          # production
bun run dev            # watch mode

# Run tests
bun test
bun test --watch
bun test --coverage
```

The server starts on `http://localhost:3001` by default (set `PORT` env var to change).

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│  Client (curl / SDK / tRPC client)                 │
│    POST /trpc/wallet.generate  { chain: "..." }    │
│    GET  /trpc/balance.native?input={...}           │
└───────────────────┬────────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────────┐
│  trpc/server.ts — Bun.serve() + fetchRequestHandler│
│    /health (plain GET)                             │
│    /trpc/* (tRPC adapter)                          │
└───────────────────┬────────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────────┐
│  trpc/routers/index.ts — appRouter                 │
│    ├─ wallet  (generate, deriveAddress, deriveKey)  │
│    ├─ balance (native, token)                      │
│    ├─ fee     (estimate)                           │
│    ├─ send    (native, token)                      │
│    └─ tx      (status)                             │
└───────────────────┬────────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────────┐
│  index.ts — Chain router (getFamily dispatch)      │
│    ├─ chains/evm.ts      (ETH, BSC, Polygon, ...)  │
│    ├─ chains/bitcoin.ts  (BTC, LTC, DOGE, BCH)    │
│    ├─ chains/tron.ts     (TRON mainnet/testnet)    │
│    ├─ chains/solana.ts   (SOL mainnet/devnet)      │
│    └─ chains/*.ts        (14 more families)        │
└────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Pure functions** — no classes, no singletons
- **Zod validation** — all inputs validated at the tRPC boundary
- **HD wallets** — BIP-39 mnemonic → BIP-44 derivation for all chains
- **Tatum Gateway** — RPC calls routed through Tatum for reliability

---

## Supported Chains

| Family | Mainnet | Testnet | Mnemonic | Tokens |
|--------|---------|---------|----------|--------|
| **EVM** | ethereum, bsc, polygon, arbitrum-one, optimism, avalanche-c, base, fantom, celo, cronos, gnosis, moonbeam, kaia, flare, zksync, sonic, berachain, unichain, ronin, chiliz, aurora, oasis, rootstock, iota-evm, arbitrum-nova, lisk, ethereum-classic, xdc, haqq, harmony | sepolia, bsc-testnet, polygon-amoy, + more | 12 words | ERC-20 |
| **Bitcoin** | bitcoin-mainnet | bitcoin-testnet | 24 words | — |
| **Litecoin** | litecoin-mainnet | litecoin-testnet | 24 words | — |
| **Dogecoin** | dogecoin-mainnet | dogecoin-testnet | 24 words | — |
| **Bitcoin Cash** | bitcoincash-mainnet | bitcoincash-testnet | 24 words | — |
| **TRON** | tron-mainnet | tron-testnet | 12 words | TRC-20 |
| **Solana** | solana-mainnet | solana-devnet | 24 words | SPL |
| **XRP** | xrp-mainnet | xrp-testnet | 24 words | — |
| **Stellar** | stellar-mainnet | stellar-testnet | 24 words | — |
| **Algorand** | algorand-mainnet | algorand-testnet | 24 words | — |
| **NEAR** | near-mainnet | near-testnet | 24 words | — |
| **Polkadot** | polkadot-mainnet, kusama-mainnet | — | 24 words | — |
| **Cardano** | cardano-mainnet | cardano-testnet | 24 words | — |
| **Tezos** | tezos-mainnet | tezos-testnet | 24 words | — |
| **MultiversX** | multiversx-mainnet | multiversx-testnet | 24 words | — |
| **Cosmos** | cosmos-mainnet | cosmos-testnet | 24 words | — |
| **Sui** | sui-mainnet | sui-testnet | 24 words | SPL-like |
| **TON** | ton-mainnet | ton-testnet | 24 words | — |

---

## Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "chains": [
    "ethereum-mainnet",
    "bsc-mainnet",
    "polygon-mainnet",
    "tron-mainnet",
    "bitcoin-mainnet",
    "solana-mainnet"
  ]
}
```

---

## API Reference

All procedures are served under `/trpc`. Use the [tRPC wire format](#trpc-wire-format) below.

### wallet.generate

**Type:** `mutation`

Generate a new HD wallet (mnemonic + extended public key).

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | `string` | ✅ | Chain identifier (e.g. `ethereum-mainnet`) |

**curl:**
```bash
curl -X POST http://localhost:3001/trpc/wallet.generate \
  -H "Content-Type: application/json" \
  -d '{"chain":"ethereum-mainnet"}'
```

**Response:**
```json
{
  "result": {
    "data": {
      "mnemonic": "abandon badge camera danger eagle fabric glimpse horror ivory jazz kitchen lumber",
      "xpub": "xpub6D4BDPcP2GT577..."
    }
  }
}
```

---

### wallet.deriveAddress

**Type:** `query`

Derive an address from an extended public key (or mnemonic for Ed25519 chains) at a given HD index.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `xpub` | `string` | ✅ | Extended public key (or mnemonic for Ed25519 chains) |
| `index` | `number` | ✅ | HD derivation index (0-based, coerced from string) |
| `chain` | `string` | ✅ | Chain identifier |

**curl:**
```bash
curl "http://localhost:3001/trpc/wallet.deriveAddress?input=%7B%22xpub%22%3A%22xpub6D4BDPcP2GT577...%22%2C%22index%22%3A0%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

**Response:**
```json
{
  "result": {
    "data": {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58"
    }
  }
}
```

---

### wallet.derivePrivateKey

**Type:** `query`

Derive a private key from a mnemonic at a given HD index.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mnemonic` | `string` | ✅ | BIP-39 mnemonic phrase |
| `index` | `number` | ✅ | HD derivation index (0-based) |
| `chain` | `string` | ✅ | Chain identifier |

**curl:**
```bash
curl "http://localhost:3001/trpc/wallet.derivePrivateKey?input=%7B%22mnemonic%22%3A%22abandon+badge+...%22%2C%22index%22%3A0%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

**Response:**
```json
{
  "result": {
    "data": {
      "key": "0x4c0883a6910395b1e8..."
    }
  }
}
```

---

### balance.native

**Type:** `query`

Get the native token balance for an address.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | `string` | ✅ | On-chain address |
| `chain` | `string` | ✅ | Chain identifier |

**curl:**
```bash
curl "http://localhost:3001/trpc/balance.native?input=%7B%22address%22%3A%220x742d35Cc6634C0532925a3b844Bc9e7595f2bD58%22%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

**Response:**
```json
{
  "result": {
    "data": {
      "balance": "2.0",
      "raw": "2000000000000000000"
    }
  }
}
```

---

### balance.token

**Type:** `query`

Get the balance of an ERC-20 / TRC-20 / SPL token.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | `string` | ✅ | Holder address |
| `contractAddress` | `string` | ✅ | Token contract / mint address |
| `chain` | `string` | ✅ | Chain identifier |

**curl:**
```bash
curl "http://localhost:3001/trpc/balance.token?input=%7B%22address%22%3A%220x742d...%22%2C%22contractAddress%22%3A%220xdAC17F958D2ee523a2206206994597C13D831ec7%22%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

**Response:**
```json
{
  "result": {
    "data": {
      "balance": "1500.0",
      "raw": "1500000000"
    }
  }
}
```

---

### fee.estimate

**Type:** `query`

Estimate the transaction fee (gas for EVM, fee for UTXO/others).

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | `string` | ✅ | Chain identifier |
| `from` | `string` | ✅ | Sender address |
| `to` | `string` | ✅ | Recipient address |
| `amount` | `string` | ❌ | Amount in human-readable units |
| `contractAddress` | `string` | ❌ | Token contract (for token transfers) |
| `data` | `string` | ❌ | Arbitrary calldata (EVM) |

**curl:**
```bash
curl "http://localhost:3001/trpc/fee.estimate?input=%7B%22chain%22%3A%22ethereum-mainnet%22%2C%22from%22%3A%220xABC...%22%2C%22to%22%3A%220xDEF...%22%7D"
```

**Response (EVM):**
```json
{
  "result": {
    "data": {
      "gasLimit": "21000",
      "gasPriceGwei": "25.5",
      "totalFeeEth": "0.0005355",
      "maxPriorityFeeGwei": "1.5"
    }
  }
}
```

**Response (UTXO):**
```json
{
  "result": {
    "data": {
      "fee": "0.00001",
      "raw": "1000"
    }
  }
}
```

---

### send.native

**Type:** `mutation`

Send native tokens (ETH, BTC, TRX, SOL, etc.).

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | `string` | ✅ | Chain identifier |
| `to` | `string` | ✅ | Recipient address |
| `amount` | `string` | ✅ | Amount in human-readable units |
| `privateKey` | `string` | ❌ | Private key (EVM / TRON / VeChain) |
| `mnemonic` | `string` | ❌ | Mnemonic (BTC / SOL / Ed25519 chains) |
| `fromIndex` | `number` | ❌ | HD index of sender (default: `0`) |
| `fromAddress` | `string` | ❌ | Sender address (UTXO chains) |
| `changeAddress` | `string` | ❌ | Change address (UTXO chains) |

**curl:**
```bash
curl -X POST http://localhost:3001/trpc/send.native \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "ethereum-mainnet",
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
    "amount": "0.1",
    "privateKey": "0x4c0883a6910395b1..."
  }'
```

**Response:**
```json
{
  "result": {
    "data": {
      "txId": "0xabc123def456..."
    }
  }
}
```

---

### send.token

**Type:** `mutation`

Send ERC-20 / TRC-20 / SPL tokens.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | `string` | ✅ | Chain identifier |
| `to` | `string` | ✅ | Recipient address |
| `amount` | `string` | ✅ | Amount in human-readable units |
| `contractAddress` | `string` | ✅ | Token contract / mint address |
| `privateKey` | `string` | ❌ | Private key (EVM / TRON) |
| `mnemonic` | `string` | ❌ | Mnemonic (SOL) |
| `fromIndex` | `number` | ❌ | HD index of sender (default: `0`) |
| `decimals` | `number` | ❌ | Token decimals (TRON, default: `6`) |

**curl:**
```bash
curl -X POST http://localhost:3001/trpc/send.token \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "ethereum-mainnet",
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD58",
    "amount": "100",
    "contractAddress": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "privateKey": "0x4c0883a6910395b1..."
  }'
```

**Response:**
```json
{
  "result": {
    "data": {
      "txId": "0xdef789abc012..."
    }
  }
}
```

---

### tx.status

**Type:** `query`

Check the status of a transaction.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `txId` | `string` | ✅ | Transaction hash / ID |
| `chain` | `string` | ✅ | Chain identifier |

**curl:**
```bash
curl "http://localhost:3001/trpc/tx.status?input=%7B%22txId%22%3A%220xabc123...%22%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

**Response (EVM — confirmed):**
```json
{
  "result": {
    "data": {
      "status": "confirmed",
      "blockNumber": 18500000,
      "gasUsed": "21000"
    }
  }
}
```

**Response (pending):**
```json
{
  "result": {
    "data": {
      "status": "pending"
    }
  }
}
```

---

## tRPC Wire Format

This service uses **tRPC v11** with the default transformer (no superjson).

### Queries (GET)

```
GET /trpc/{procedure}?input=<URL-encoded JSON>
```

Example:
```bash
# balance.native query
curl "http://localhost:3001/trpc/balance.native?input=%7B%22address%22%3A%220xABC%22%2C%22chain%22%3A%22ethereum-mainnet%22%7D"
```

### Mutations (POST)

```
POST /trpc/{procedure}
Content-Type: application/json

<JSON body>
```

Example:
```bash
# wallet.generate mutation
curl -X POST http://localhost:3001/trpc/wallet.generate \
  -H "Content-Type: application/json" \
  -d '{"chain":"ethereum-mainnet"}'
```

### Response Envelope

All tRPC responses follow this structure:

**Success:**
```json
{
  "result": {
    "data": { /* procedure-specific data */ }
  }
}
```

**Error:**
```json
{
  "error": {
    "message": "...",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "path": "wallet.generate"
    }
  }
}
```

### Using with tRPC Client

```typescript
import { createTRPCClient, httpBatchLink } from "@trpc/client"
import type { AppRouter } from "./trpc/routers/index"

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({ url: "http://localhost:3001/trpc" }),
  ],
})

// Fully typed calls
const wallet = await trpc.wallet.generate.mutate({ chain: "ethereum-mainnet" })
const addr   = await trpc.wallet.deriveAddress.query({ xpub: wallet.xpub, index: 0, chain: "ethereum-mainnet" })
const balance = await trpc.balance.native.query({ address: addr.address, chain: "ethereum-mainnet" })
```

---

## Chain-Specific Notes

### EVM Chains
- Mnemonic: **12 words** (ethers.js `HDNodeWallet.createRandom()`)
- xpub: Standard BIP-44 extended public key
- `deriveAddress` returns `{ address: "0x..." }` (42 chars, checksummed)
- `derivePrivateKey` returns `0x`-prefixed 66-char hex string
- Fee estimate returns `GasEstimate` with `gasLimit`, `gasPriceGwei`, `totalFeeEth`, `maxPriorityFeeGwei`

### Bitcoin / UTXO Chains
- Mnemonic: **24 words** (256-bit entropy)
- xpub: BIP-84 `zpub...` for BTC, chain-specific for LTC/DOGE/BCH
- `send.native` requires `mnemonic`, `fromAddress`, and optionally `changeAddress`
- UTXO selection and change calculation handled automatically
- Dust limit: 546 satoshis

### TRON
- Mnemonic: **12 words** (EVM-compatible derivation path)
- Addresses start with `T` (Base58Check)
- `send.native` requires `privateKey` (not mnemonic)
- Token transfers require `decimals` (default: 6 for USDT-TRC20)
- Energy estimation available via `fee.estimate` with `contractAddress`

### Solana
- Mnemonic: **24 words**
- xpub field contains the mnemonic (used for Ed25519 derivation)
- Addresses are Base58-encoded, 32–44 chars
- `send.native` requires `mnemonic` + `fromIndex`
- SPL token transfers via `send.token`

### Ed25519 Chains (XRP, Stellar, Algorand, NEAR, Polkadot, Cardano, Tezos, MultiversX, Cosmos, Sui, TON)
- Mnemonic: **24 words**
- The `xpub` field stores the mnemonic (no xpub for Ed25519)
- `deriveAddress` may return a `Promise` (async for some chains)

---

## Error Handling

tRPC automatically validates inputs against Zod schemas. Invalid inputs return HTTP 400 with a structured error:

```json
{
  "error": {
    "message": "[{\"code\":\"too_small\",\"minimum\":1,...}]",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "path": "wallet.generate"
    }
  }
}
```

Runtime errors (e.g., RPC node timeout, invalid mnemonic) return HTTP 500 with:
```json
{
  "error": {
    "message": "Descriptive error message",
    "code": -32603,
    "data": {
      "code": "INTERNAL_SERVER_ERROR",
      "httpStatus": 500
    }
  }
}
```

---

## Security

- **No private keys stored** — keys are derived on-the-fly and never persisted
- **Zod validation** — all inputs validated before reaching business logic
- **No CORS by default** — add CORS headers in production if needed
- **Environment variables** — `TATUM_API_KEY` and `PORT` loaded from `.env`
- **HTTPS recommended** — deploy behind a TLS-terminating reverse proxy

> **Warning:** The `wallet.derivePrivateKey` and `send.*` endpoints handle sensitive cryptographic material. Always use HTTPS in production and restrict access with authentication middleware.

---

## Deployment

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `TATUM_API_KEY` | — | Tatum API key for RPC gateway access |

### Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
EXPOSE 3001
CMD ["bun", "run", "start"]
```

### Health Monitoring

```bash
curl -f http://localhost:3001/health || exit 1
```

---

## Project Structure

```
├── trpc/
│   ├── init.ts              # tRPC instance + Zod schemas
│   ├── server.ts            # Bun.serve() + fetchRequestHandler
│   └── routers/
│       ├── index.ts          # Root appRouter (merges all)
│       ├── wallet.ts         # wallet.generate, deriveAddress, derivePrivateKey
│       ├── balance.ts        # balance.native, balance.token
│       ├── fee.ts            # fee.estimate
│       ├── send.ts           # send.native, send.token
│       └── tx.ts             # tx.status
├── chains/
│   ├── evm.ts               # All EVM chains (ETH, BSC, Polygon, ...)
│   ├── bitcoin.ts            # BTC, LTC, DOGE, BCH
│   ├── tron.ts               # TRON
│   ├── solana.ts             # Solana
│   └── ...                   # 12 more chain modules
├── index.ts                  # Chain router (getFamily dispatch)
├── types.ts                  # Shared TypeScript interfaces
├── gateway.ts                # Tatum RPC URL builder
├── server.ts                 # Legacy entry point (re-exports tRPC handle)
├── tests/
│   ├── server.test.ts        # tRPC endpoint tests (13 tests)
│   ├── wallet.test.ts        # Crypto wallet tests (84 tests)
│   ├── routing.test.ts       # getFamily / isTestnet / gatewayUrl (24 tests)
│   ├── bitcoin.test.ts       # UTXO-specific tests (20 tests)
│   └── validation.test.ts    # Input validation + edge cases (11 tests)
└── db/
    ├── schema.prisma         # Prisma 7 schema
    └── seeds/                # Database seed files
```
