// types.ts — общие интерфейсы для всех цепей

export interface ChainWallet {
  mnemonic: string
  xpub: string       // для EVM/BTC = xpub, для Solana/XRP/XLM = base58/hex pubkey
}

export interface DerivedAddress {
  address: string
}

export interface TxResult {
  txId: string
}

export interface Balance {
  balance: string    // в человеческих единицах (ETH, TRX, BTC, SOL, XRP, etc.)
  raw: string        // в минимальных единицах (wei, sun, satoshi, lamports, drops, etc.)
}

export interface GasEstimate {
  gasLimit: string
  gasPriceGwei: string
  totalFeeEth: string
  maxPriorityFeeGwei: string
}

export interface FeeEstimate {
  fee: string
  raw: string
}

// ─── Chain families ─────────────────────────────────────────────────────────
export type ChainFamily =
  | "evm"
  | "tron"
  | "bitcoin"
  | "litecoin"
  | "dogecoin"
  | "bitcoincash"
  | "solana"
  | "xrp"
  | "stellar"
  | "algorand"
  | "near"
  | "polkadot"
  | "cardano"
  | "tezos"
  | "multiversx"
  | "vechain"
  | "cosmos"
  | "sui"
  | "ton"

// ─── EVM chains ─────────────────────────────────────────────────────────────
export type EvmChain =
  | "ethereum-mainnet" | "ethereum-sepolia"
  | "bsc-mainnet" | "bsc-testnet"
  | "polygon-mainnet" | "polygon-amoy"
  | "arbitrum-one-mainnet" | "arbitrum-one-testnet"
  | "optimism-mainnet" | "optimism-testnet"
  | "avalanche-c-mainnet" | "avalanche-c-testnet"
  | "base-mainnet" | "base-testnet"
  | "fantom-mainnet" | "fantom-testnet"
  | "celo-mainnet" | "celo-testnet"
  | "cronos-mainnet" | "cronos-testnet"
  | "gnosis-mainnet" | "gnosis-testnet"
  | "moonbeam-mainnet" | "moonbeam-testnet"
  | "kaia-mainnet" | "kaia-testnet"
  | "flare-mainnet" | "flare-testnet"
  | "zksync-mainnet" | "zksync-testnet"
  | "sonic-mainnet" | "sonic-testnet"
  | "berachain-mainnet" | "berachain-testnet"
  | "unichain-mainnet" | "unichain-testnet"
  | "ronin-mainnet" | "ronin-testnet"
  | "chiliz-mainnet" | "chiliz-testnet"
  | "aurora-mainnet" | "aurora-testnet"
  | "oasis-mainnet" | "oasis-testnet"
  | "rootstock-mainnet" | "rootstock-testnet"
  | "iota-evm-mainnet" | "iota-evm-testnet"
  | "arbitrum-nova-mainnet"
  | "lisk-mainnet" | "lisk-testnet"
  | "ethereum-classic-mainnet"
  | "xdc-mainnet" | "xdc-testnet"
  | "haqq-mainnet"
  | "vechain-mainnet" | "vechain-testnet"
  | "harmony-mainnet" | "harmony-testnet"

// ─── UTXO chains ────────────────────────────────────────────────────────────
export type UtxoChain =
  | "bitcoin-mainnet" | "bitcoin-testnet"
  | "litecoin-mainnet" | "litecoin-testnet"
  | "dogecoin-mainnet" | "dogecoin-testnet"
  | "bitcoincash-mainnet" | "bitcoincash-testnet"

// ─── Other chain types ──────────────────────────────────────────────────────
export type TronChain = "tron-mainnet" | "tron-testnet"
export type SolanaChain = "solana-mainnet" | "solana-devnet"
export type XrpChain = "xrp-mainnet" | "xrp-testnet"
export type StellarChain = "stellar-mainnet" | "stellar-testnet"
export type AlgorandChain = "algorand-mainnet" | "algorand-testnet"
export type NearChain = "near-mainnet" | "near-testnet"
export type PolkadotChain = "polkadot-mainnet" | "kusama-mainnet"
export type CardanoChain = "cardano-mainnet" | "cardano-testnet"
export type TezosChain = "tezos-mainnet" | "tezos-testnet"
export type MultiversxChain = "multiversx-mainnet" | "multiversx-testnet"
export type CosmosChain = "cosmos-mainnet" | "cosmos-testnet"
export type SuiChain = "sui-mainnet" | "sui-testnet"
export type TonChain = "ton-mainnet" | "ton-testnet"

export type Chain =
  | EvmChain
  | UtxoChain
  | TronChain
  | SolanaChain
  | XrpChain
  | StellarChain
  | AlgorandChain
  | NearChain
  | PolkadotChain
  | CardanoChain
  | TezosChain
  | MultiversxChain
  | CosmosChain
  | SuiChain
  | TonChain

// ─── Sweep types ────────────────────────────────────────────────────────────

export interface SweepInput {
  destinationAddress: string
  chain: string
  amount: string
  contractAddress?: string
  decimals?: number
  depositPrivateKey: string
  depositAddress: string
  gasPrivateKey: string
  gasAddress: string
  gasFeeMultiplier?: number
  gasMinReserve?: string
}

export type SweepResult =
  | { status: "SWEEP_SENT"; txId: string; amount: string; destination: string }
  | { status: "GAS_TOPUP_SENT"; gasTopupTxId: string; gasAmount: string; message: string }
  | { status: "ERROR"; code: SweepErrorCode; message: string; details?: unknown }

export type SweepErrorCode =
  | "GAS_ESTIMATION_FAILED"
  | "GAS_WALLET_INSUFFICIENT"
  | "GAS_TOPUP_FAILED"
  | "SWEEP_FAILED"
  | "INVALID_CHAIN"
