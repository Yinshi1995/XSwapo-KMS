<div align="center">

# 🌐 xswapo-rpc-service

**Multi-chain RPC microservice — direct blockchain access without third-party wallet APIs**

[![Bun](https://img.shields.io/badge/runtime-Bun_1.3-f9f1e1?logo=bun&logoColor=000)](https://bun.sh)
[![tRPC](https://img.shields.io/badge/API-tRPC_v11-398CCB?logo=trpc&logoColor=fff)](https://trpc.io)
[![Prisma](https://img.shields.io/badge/ORM-Prisma_7-2D3748?logo=prisma&logoColor=fff)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL-4169E1?logo=postgresql&logoColor=fff)](https://www.postgresql.org)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-152_passing-brightgreen?logo=checkmarx&logoColor=fff)](#testing)
[![License](https://img.shields.io/badge/license-Private-red)](#)

> Полная замена Tatum v3 REST API. Генерация кошельков, деривация адресов, отправка транзакций и проверка балансов — всё через прямые RPC/SDK вызовы к блокчейнам.

</div>

---

## ⚡ Поддерживаемые сети

<table>
<tr>
<td width="50%" valign="top">

### 🔵 Tier 1 — Production ready
| Сеть | Chain | Тип |
|:-----|:------|:----|
| <img src="https://blockchains.tatum.io/assets/img/ethereum.svg" width="16"> Ethereum | `ETH` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/bsc.svg" width="16"> BNB Smart Chain | `BSC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/tron.svg" width="16"> Tron | `TRON` | TRON |
| <img src="https://blockchains.tatum.io/assets/img/polygon.svg" width="16"> Polygon | `MATIC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/bitcoin.svg" width="16"> Bitcoin | `BTC` | UTXO |
| <img src="https://blockchains.tatum.io/assets/img/solana.svg" width="16"> Solana | `SOL` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/avalanche.svg" width="16"> Avalanche | `AVAX` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/ripple.svg" width="16"> Ripple | `XRP` | secp256k1 |
| <img src="https://blockchains.tatum.io/assets/img/stellar.svg" width="16"> Stellar | `XLM` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/litecoin.svg" width="16"> Litecoin | `LTC` | UTXO |
| <img src="https://blockchains.tatum.io/assets/img/dogecoin.svg" width="16"> Dogecoin | `DOGE` | UTXO |
| <img src="https://blockchains.tatum.io/assets/img/arbitrum-one.svg" width="16"> Arbitrum | `ARBITRUM` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/optimism.svg" width="16"> Optimism | `OPTIMISM` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/base.svg" width="16"> Base | `BASE` | EVM |

</td>
<td width="50%" valign="top">

### 🟢 Tier 2 — Full support
| Сеть | Chain | Тип |
|:-----|:------|:----|
| <img src="https://blockchains.tatum.io/assets/img/algorand.svg" width="16"> Algorand | `ALGO` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/bitcoin-cash.svg" width="16"> Bitcoin Cash | `BCH` | UTXO |
| <img src="https://blockchains.tatum.io/assets/img/cardano.svg" width="16"> Cardano | `ADA` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/polkadot.svg" width="16"> Polkadot | `DOT` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/near.svg" width="16"> NEAR | `NEAR` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/tezos.svg" width="16"> Tezos | `XTZ` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/multiversx.svg" width="16"> MultiversX | `EGLD` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/sui.svg" width="16"> SUI | `SUI` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/ton.svg" width="16"> TON | `TON` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/cosmos.svg" width="16"> Cosmos | `COSMOS` | secp256k1 |
| <img src="https://blockchains.tatum.io/assets/img/vechain.svg" width="16"> VeChain | `VET` | secp256k1 |
| <img src="https://blockchains.tatum.io/assets/img/fantom.svg" width="16"> Fantom | `FTM` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/cronos.svg" width="16"> Cronos | `CRO` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/moonbeam.svg" width="16"> Moonbeam | `MOONBEAM` | EVM |

</td>
</tr>
</table>

<details>
<summary><b>🟡 Tier 3 — ещё 24 сети</b> (нажми чтобы раскрыть)</summary>

| Сеть | Chain | Тип |
|:-----|:------|:----|
| <img src="https://blockchains.tatum.io/assets/img/sonic.svg" width="16"> Sonic | `SONIC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/berachain.svg" width="16"> Berachain | `BERA` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/monad.svg" width="16"> Monad | `MONAD` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/zksync.svg" width="16"> ZKsync | `ZKSYNC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/flare.svg" width="16"> Flare | `FLARE` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/kaia.svg" width="16"> Kaia | `KAIA` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/ronin.svg" width="16"> Ronin | `RONIN` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/gnosis.svg" width="16"> Gnosis | `GNOSIS` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/aurora.svg" width="16"> Aurora | `AURORA` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/rootstock.svg" width="16"> Rootstock | `ROOTSTOCK` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/hyperevm.svg" width="16"> HyperEVM | `HYPEREVM` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/abstract.svg" width="16"> Abstract | `ABSTRACT` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/plume.svg" width="16"> Plume | `PLUME` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/lisk.svg" width="16"> Lisk | `LISK` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/oasis.svg" width="16"> Oasis | `OASIS` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/harmony.svg" width="16"> Harmony | `HARMONY` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/haqq.svg" width="16"> HAQQ | `HAQQ` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/kucoin.svg" width="16"> KuCoin Chain | `KCC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/kusama.svg" width="16"> Kusama | `KUSAMA` | Ed25519 |
| <img src="https://blockchains.tatum.io/assets/img/mantra.svg" width="16"> MANTRA | `MANTRA` | Cosmos |
| <img src="https://blockchains.tatum.io/assets/img/iota.svg" width="16"> IOTA EVM | `IOTA` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/xinfin.svg" width="16"> XinFin | `XDC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/ethereum-classic.svg" width="16"> Ethereum Classic | `ETC` | EVM |
| <img src="https://blockchains.tatum.io/assets/img/chiliz.svg" width="16"> Chiliz | `CHILIZ` | EVM |

</details>

> **Итого: 18 chain families · 65 сетей · 51 монета**

---

## 🏗 Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                        tRPC v11 Server                         │
│                     Bun.serve() :3001                          │
├────────┬──────────┬─────────┬──────────┬───────────────────────┤
│ wallet │ balance  │   fee   │   send   │          tx           │
│ router │  router  │ router  │  router  │        router         │
├────────┴──────────┴─────────┴──────────┴───────────────────────┤
│                     index.ts — Chain Router                     │
│            getFamily(chain) → dispatch to implementation        │
├──────┬───────┬───────┬───────┬─────────┬───────┬───────┬───────┤
│ EVM  │Bitcoin│ Tron  │Solana │   XRP   │Stellar│ ALGO  │ NEAR  │
│30+net│BTC/LTC│       │       │         │       │       │       │
│      │DOGE   │       │       │         │       │       │       │
├──────┼───────┼───────┼───────┼─────────┼───────┼───────┼───────┤
│ DOT  │  ADA  │  XTZ  │ EGLD  │   VET   │Cosmos │  SUI  │  TON  │
│Kusama│       │       │       │         │MANTRA │       │       │
├──────┴───────┴───────┴───────┴─────────┴───────┴───────┴───────┤
│                    PostgreSQL + Prisma 7                        │
│        Coins · Networks · Mappings · Wallets · Txns            │
└─────────────────────────────────────────────────────────────────┘
```

### Структура проекта

```
xswapo-rpc-service/
├── index.ts                 # Chain router — единая точка входа
├── types.ts                 # Общие интерфейсы (ChainWallet, Balance, …)
├── server.ts                # HTTP-сервер entry point
│
├── chains/                  # 16 chain-specific реализаций
│   ├── evm.ts               #   Ethereum, BSC, Polygon, Arbitrum, +27 EVM сетей
│   ├── bitcoin.ts           #   BTC, LTC, DOGE, BCH (UTXO/BIP-84)
│   ├── tron.ts              #   TRON (TRX + TRC-20)
│   ├── solana.ts            #   Solana (SOL + SPL tokens)
│   ├── xrp.ts               #   XRP Ledger
│   ├── stellar.ts           #   Stellar (XLM)
│   ├── algorand.ts          #   Algorand (ALGO)
│   ├── near.ts              #   NEAR Protocol
│   ├── polkadot.ts          #   Polkadot + Kusama
│   ├── cardano.ts           #   Cardano (ADA)
│   ├── tezos.ts             #   Tezos (XTZ)
│   ├── multiversx.ts        #   MultiversX (EGLD)
│   ├── vechain.ts           #   VeChain (VET)
│   ├── cosmos.ts            #   Cosmos + MANTRA
│   ├── sui.ts               #   SUI
│   └── ton.ts               #   TON
│
├── trpc/                    # tRPC v11 API layer
│   ├── server.ts            #   Bun.serve HTTP handler
│   ├── init.ts              #   tRPC router & context
│   └── routers/
│       ├── wallet.ts        #   generate, deriveAddress, derivePrivateKey
│       ├── balance.ts       #   native, token
│       ├── fee.ts           #   estimate
│       ├── send.ts          #   native, token
│       └── tx.ts            #   status
│
├── db/                      # Prisma 7 + PostgreSQL
│   ├── index.ts             #   PrismaClient с PrismaPg adapter
│   ├── schema.prisma        #   13 моделей
│   └── seeds/
│       └── networks.ts      #   51 Coins + 65 Networks + 65 Mappings
│
└── tests/                   # 152 теста (bun:test)
    ├── wallet.test.ts       #   84 теста — wallet ops для всех chain families
    ├── routing.test.ts      #   24 теста — getFamily() routing
    ├── bitcoin.test.ts      #   20 тестов — UTXO-specific
    ├── server.test.ts       #   13 тестов — tRPC HTTP layer
    └── validation.test.ts   #   11 тестов — input validation
```

---

## 🚀 Быстрый старт

### Требования

- [Bun](https://bun.sh) ≥ 1.3
- PostgreSQL (Railway, Supabase, local)
- Node.js ≥ 18 (для native addons)

### Установка

```bash
git clone https://github.com/Yinshi1995/XSwapo-KMS.git && cd xswapo-rpc-service
bun install
```

### Настройка окружения

```env
# .env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
TATUM_API_KEY=your_tatum_api_key     # для RPC gateway доступа к блокчейнам
```

### Запуск

```bash
# Генерация Prisma Client
bun x prisma generate

# Миграция и seed БД
bun x prisma migrate deploy
bun run db/seeds/networks.ts

# Запуск сервера
bun run start          # production
bun run dev            # development (watch mode)
```

Сервер запустится на `http://localhost:3001`.

---

## 📡 API Reference

### Endpoints

| Метод | Endpoint | Описание |
|:------|:---------|:---------|
| `POST` | `/trpc/wallet.generate` | Создать HD-кошелёк |
| `GET` | `/trpc/wallet.deriveAddress` | Получить адрес по xpub + index |
| `GET` | `/trpc/wallet.derivePrivateKey` | Получить приватный ключ |
| `GET` | `/trpc/balance.native` | Баланс нативной монеты |
| `GET` | `/trpc/balance.token` | Баланс токена (ERC-20, TRC-20, SPL) |
| `GET` | `/trpc/fee.estimate` | Оценка комиссии |
| `POST` | `/trpc/send.native` | Отправить нативную монету |
| `POST` | `/trpc/send.token` | Отправить токен |
| `GET` | `/trpc/tx.status` | Статус транзакции |
| `GET` | `/trpc/rate.getCryptoRate` | Курс криптовалюты к фиату или другой крипте |
| `GET` | `/trpc/rate.getCryptoRatio` | Соотношение двух криптовалют через USD |
| `GET` | `/health` | Health check |

---

### `wallet.generate`

Создаёт HD-кошелёк для указанной сети. Для secp256k1 цепей возвращает xpub, для Ed25519 — Base58-encoded public key.

```bash
curl -X POST http://localhost:3001/trpc/wallet.generate \
  -H "Content-Type: application/json" \
  -d '{"chain":"ETH"}'
```

```json
{
  "result": {
    "data": {
      "mnemonic": "abandon ability able about above absent ...",
      "xpub": "xpub6D4BDPcP2GT577Vvch3R8wDkScZWz..."
    }
  }
}
```

### `wallet.deriveAddress`

```bash
# EVM / BTC / TRON — xpub + index
curl "http://localhost:3001/trpc/wallet.deriveAddress?input={\"xpub\":\"xpub6D4B...\",\"index\":0,\"chain\":\"ETH\"}"

# Ed25519 (SOL, DOT, SUI, ...) — mnemonic вместо xpub
curl "http://localhost:3001/trpc/wallet.deriveAddress?input={\"xpub\":\"abandon ability ...\",\"index\":0,\"chain\":\"SOL\"}"
```

### `balance.native`

```bash
curl "http://localhost:3001/trpc/balance.native?input={\"address\":\"0xd8dA6BF...\",\"chain\":\"ETH\"}"
```

```json
{
  "result": {
    "data": {
      "balance": "1.234567",
      "raw": "1234567000000000000"
    }
  }
}
```

### `send.native`

```bash
curl -X POST http://localhost:3001/trpc/send.native \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "ETH",
    "privateKey": "0xabc...",
    "to": "0xRecipient...",
    "amount": "0.1"
  }'
```

```json
{
  "result": {
    "data": {
      "txId": "0x123abc..."
    }
  }
}
```

---

### `rate.getCryptoRate`

Возвращает актуальный курс криптовалюты. По умолчанию базовая пара — USD.
Данные агрегируются из 10+ CEX и 100+ DEX через Tatum Price API.

```bash
# ETH → USD
curl "http://localhost:3001/trpc/rate.getCryptoRate?input={\"symbol\":\"ETH\"}"

# BTC → EUR
curl "http://localhost:3001/trpc/rate.getCryptoRate?input={\"symbol\":\"BTC\",\"basePair\":\"EUR\"}"
```

```json
{
  "result": {
    "data": {
      "symbol": "ETH",
      "basePair": "USD",
      "value": 3412.55,
      "source": "CoinGecko",
      "timestamp": "2026-04-05T14:32:00.000Z"
    }
  }
}
```

---

### `rate.getCryptoRatio`

Возвращает соотношение двух криптовалют через USD как промежуточную базу.

```bash
# ETH / BTC
curl "http://localhost:3001/trpc/rate.getCryptoRatio?input={\"from\":\"ETH\",\"to\":\"BTC\"}"
```

```json
{
  "result": {
    "data": {
      "from": "ETH",
      "to": "BTC",
      "ratio": 0.03142857,
      "fromPriceUsd": 3412.55,
      "toPriceUsd": 108600.00,
      "timestamp": "2026-04-05T14:32:00.000Z"
    }
  }
}
```

---

## 🔑 Криптография: два режима деривации

```
 ┌──────────────────────────────────┐    ┌──────────────────────────────────┐
 │    secp256k1 (Type A)           │    │      Ed25519 (Type B)            │
 │                                  │    │                                  │
 │  mnemonic                        │    │  mnemonic                        │
 │     ↓                            │    │     ↓                            │
 │  BIP-32/44 derivation            │    │  SLIP-0010 derivation            │
 │     ↓                            │    │     ↓                            │
 │  xpub (extended public key)      │    │  pubkey per index                │
 │     ↓                            │    │  (no standard xpub)              │
 │  xpub + index → address          │    │     ↓                            │
 │  (mnemonic NOT needed)           │    │  mnemonic + index → address      │
 │                                  │    │  (mnemonic REQUIRED each time)   │
 │  ETH · BTC · LTC · DOGE · BCH   │    │  SOL · DOT · ADA · ALGO · NEAR  │
 │  TRON · XRP · VET · COSMOS      │    │  XTZ · EGLD · SUI · TON · XLM   │
 └──────────────────────────────────┘    └──────────────────────────────────┘
```

| Chain Family | Derivation Path | Mnemonic | xpub field stores |
|:-------------|:----------------|:---------|:------------------|
| EVM | `m/44'/60'/0'/0/{i}` | 12 words | Extended public key |
| Bitcoin | `m/84'/0'/0'/0/{i}` | 24 words | zpub (BIP-84) |
| Litecoin | `m/84'/2'/0'/0/{i}` | 24 words | ltub |
| TRON | `m/44'/195'/0'/0/{i}` | 12 words | Extended public key |
| XRP | `m/44'/144'/0'/0/{i}` | 24 words | Extended public key |
| Cosmos | `m/44'/118'/0'/0/{i}` | 24 words | Extended public key |
| VeChain | `m/44'/818'/0'/0/{i}` | 24 words | Extended public key |
| Solana | `m/44'/501'/{i}'/0'` | 24 words | **Mnemonic** |
| Algorand | `m/44'/283'/{i}'/0'` | 24 words | **Mnemonic** |
| NEAR | `m/44'/397'/{i}'` | 24 words | **Mnemonic** |
| Polkadot | `m/44'/354'/0'/0'/{i}` | 24 words | **Mnemonic** |
| Cardano | `m/1852'/1815'/0'/0/{i}` | 24 words | **Mnemonic** |
| Tezos | `m/44'/1729'/{i}'/0'` | 24 words | **Mnemonic** |
| MultiversX | `m/44'/508'/0'/0'/{i}'` | 24 words | **Mnemonic** |
| SUI | `m/44'/784'/{i}'/0'/0'` | 24 words | **Mnemonic** |
| TON | `m/44'/607'/{i}'/0'` | 24 words | **Mnemonic** |
| Stellar | `m/44'/148'/{i}'` | 24 words | **Mnemonic** |

---

## 🗄 База данных

```
┌──────────┐     ┌───────────┐     ┌────────────────────┐
│   Coin   │────<│ CoinNet   │>────│     Network        │
│          │     │ Mapping   │     │                    │
│ code     │     │           │     │ code               │
│ name     │     │ contract  │     │ chain → getFamily()│
│ fees     │     │ decimals  │     │ tatumWalletSlug    │
│ limits   │     │ isActive  │     │ explorerUrl        │
└──────────┘     └───────────┘     └────────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
       ┌──────┴──────┐  ┌──────┴──────┐
       │MasterWallet │  │DepositAddr  │
       │             │  │             │
       │ xpub        │  │ address     │
       │ surprise    │  │ index       │
       │ currentIdx  │  │ userId      │
       └─────────────┘  └─────────────┘
```

**13 моделей Prisma:** `User` · `Session` · `Token` · `Coin` · `Network` · `CoinNetworkMapping` · `MasterWallet` · `DepositAddress` · `GasWallet` · `Transaction` · `ExchangeRequest` · `Subscription` · `SystemLog`

**Seeded data:** 51 монета · 65 сетей · 65 маппингов (coin ↔ network)

---

## 🧪 Тестирование {#testing}

```bash
bun test                # запуск всех тестов
bun test --watch        # watch mode
bun test --coverage     # с покрытием
```

```
 152 pass · 0 fail · 205 expect() calls

 tests/wallet.test.ts      84 tests   wallet ops for all chain families
 tests/routing.test.ts     24 tests   getFamily() chain routing
 tests/bitcoin.test.ts     20 tests   UTXO-specific (fee calc, BIP-84)
 tests/server.test.ts      13 tests   tRPC HTTP layer
 tests/validation.test.ts  11 tests   input validation & error handling
```

---

## 📦 Стек технологий

| Категория | Технология |
|:----------|:-----------|
| Runtime | Bun 1.3 |
| API Framework | tRPC v11 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Database | PostgreSQL |
| Validation | Zod |
| Testing | `bun:test` |
| **EVM** | ethers v6 |
| **Bitcoin/UTXO** | bitcoinjs-lib v7, bip32, bip39, tiny-secp256k1 |
| **Tron** | tronweb v6 |
| **Solana** | @solana/web3.js, @solana/spl-token, ed25519-hd-key |
| **XRP** | xrpl v4 |
| **Stellar** | @stellar/stellar-sdk v12 |
| **Algorand** | algosdk v3 |
| **NEAR** | near-api-js v5 |
| **Polkadot** | @polkadot/api v14, @polkadot/keyring |
| **Cardano** | @emurgo/cardano-serialization-lib-nodejs v12 |
| **Tezos** | @taquito/taquito v21 |
| **MultiversX** | ed25519-hd-key + blakejs |
| **Cosmos** | @cosmjs/stargate, @cosmjs/proto-signing |
| **SUI** | @mysten/sui v1 |
| **TON** | @ton/ton v15, @ton/core, @ton/crypto |
| **VeChain** | ethers v6 (EVM-compatible) |

---

## 🔧 Использование как библиотеки

Помимо tRPC API, можно импортировать функции напрямую:

```typescript
import {
  generateWallet,
  deriveAddress,
  derivePrivateKey,
  getBalance,
  getTokenBalance,
  estimateFee,
  sendNative,
  sendToken,
  getTxStatus,
  getFamily,
} from "./index"

// Генерация кошелька
const wallet = generateWallet("ETH")
// { mnemonic: "...", xpub: "xpub6D4B..." }

// Деривация адреса
const addr = deriveAddress(wallet.xpub, 0, "ETH")
// { address: "0x..." }

// Баланс
const bal = await getBalance("0x...", "ETH")
// { balance: "1.5", raw: "1500000000000000000" }

// Отправка
const tx = await sendNative({
  chain: "ETH",
  privateKey: "0x...",
  to: "0xRecipient...",
  amount: "0.1",
})
// { txId: "0xabc..." }
```

### Прямой доступ к chain-модулям

```typescript
import { evm, btc, sol, tron } from "./index"

// EVM-specific
const gas = await evm.evmEstimateGas({ chain: "ETH", from: "0x...", to: "0x..." })

// Bitcoin-specific
const fee = await btc.btcEstimateFee(false)  // mainnet

// Solana-specific
const tokenBal = await sol.solGetTokenBalance("addr", "mintAddr", false)
```

---

## 📋 Матрица возможностей

| Операция | EVM | BTC | LTC/DOGE/BCH | TRON | SOL | XRP | XLM | ALGO | NEAR | DOT | ADA | XTZ | EGLD | VET | COSMOS | SUI | TON |
|:---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Generate wallet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Derive address | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Derive priv key | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Get balance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Get token balance | ✅ | — | — | ✅ | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✅ | ⏳ |
| Estimate fee | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send native | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏳ | ⏳ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send token | ✅ | — | — | ✅ | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Tx status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> ✅ Реализовано &nbsp;·&nbsp; ⏳ Планируется &nbsp;·&nbsp; — Не применимо
