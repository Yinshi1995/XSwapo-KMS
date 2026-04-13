import db from "../index"
import { generateWallet, deriveAddress } from "../../index"
import { encryptMnemonic } from "../../lib/crypto"

// ─── Data ────────────────────────────────────────────────────────────────────

interface CoinDef {
  code: string
  name: string
  imageUrl: string | null
}

interface NetworkDef {
  code: string
  name: string
  chain: string
  tatumWalletSlug: string | null
  nativeCoinCode: string
  decimals: number
  explorerUrl: string | null
  imageUrl: string | null
}

// Unique coins (de-duplicated). A coin that is native on multiple networks
// appears here only once.
const COINS: CoinDef[] = [
  // Tier 1
  { code: "ETH",  name: "Ethereum",        imageUrl: "https://blockchains.tatum.io/assets/img/ethereum.svg" },
  { code: "BNB",  name: "BNB",             imageUrl: "https://blockchains.tatum.io/assets/img/bsc.svg" },
  { code: "TRX",  name: "Tron",            imageUrl: "https://blockchains.tatum.io/assets/img/tron.svg" },
  { code: "POL",  name: "Polygon",         imageUrl: "https://blockchains.tatum.io/assets/img/polygon.svg" },
  { code: "BTC",  name: "Bitcoin",         imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin.svg" },
  { code: "SOL",  name: "Solana",          imageUrl: "https://blockchains.tatum.io/assets/img/solana.svg" },
  { code: "AVAX", name: "Avalanche",       imageUrl: "https://blockchains.tatum.io/assets/img/avalanche.svg" },
  { code: "XRP",  name: "Ripple",          imageUrl: "https://blockchains.tatum.io/assets/img/ripple.svg" },
  { code: "XLM",  name: "Stellar",         imageUrl: "https://blockchains.tatum.io/assets/img/stellar.svg" },
  { code: "LTC",  name: "Litecoin",        imageUrl: "https://blockchains.tatum.io/assets/img/litecoin.svg" },
  { code: "DOGE", name: "Dogecoin",        imageUrl: "https://blockchains.tatum.io/assets/img/dogecoin.svg" },
  { code: "FLR",  name: "Flare",           imageUrl: "https://blockchains.tatum.io/assets/img/flare.svg" },
  { code: "KAIA", name: "Kaia",            imageUrl: "https://blockchains.tatum.io/assets/img/kaia.svg" },
  // Tier 2
  { code: "ALGO", name: "Algorand",        imageUrl: "https://blockchains.tatum.io/assets/img/algorand.svg" },
  { code: "BCH",  name: "Bitcoin Cash",    imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin-cash.svg" },
  { code: "ADA",  name: "Cardano",         imageUrl: "https://blockchains.tatum.io/assets/img/cardano.svg" },
  { code: "CELO", name: "Celo",            imageUrl: "https://blockchains.tatum.io/assets/img/celo.svg" },
  { code: "DOT",  name: "Polkadot",        imageUrl: "https://blockchains.tatum.io/assets/img/polkadot.svg" },
  { code: "NEAR", name: "Near",            imageUrl: "https://blockchains.tatum.io/assets/img/near.svg" },
  { code: "XTZ",  name: "Tezos",           imageUrl: "https://blockchains.tatum.io/assets/img/tezos.svg" },
  { code: "EGLD", name: "MultiversX",      imageUrl: "https://blockchains.tatum.io/assets/img/multiversx.svg" },
  { code: "FTM",  name: "Fantom",          imageUrl: "https://blockchains.tatum.io/assets/img/fantom.svg" },
  { code: "CRO",  name: "Cronos",          imageUrl: "https://blockchains.tatum.io/assets/img/cronos.svg" },
  { code: "GLMR", name: "Moonbeam",        imageUrl: "https://blockchains.tatum.io/assets/img/moonbeam.svg" },
  { code: "S",    name: "Sonic",            imageUrl: "https://blockchains.tatum.io/assets/img/sonic.svg" },
  { code: "BERA", name: "Berachain",       imageUrl: "https://blockchains.tatum.io/assets/img/berachain.svg" },
  { code: "MON",  name: "Monad",           imageUrl: "https://blockchains.tatum.io/assets/img/monad.svg" },
  { code: "SUI",  name: "SUI",             imageUrl: "https://blockchains.tatum.io/assets/img/sui.svg" },
  { code: "TON",  name: "TON",             imageUrl: "https://blockchains.tatum.io/assets/img/ton.svg" },
  { code: "ZEC",  name: "Zcash",           imageUrl: "https://blockchains.tatum.io/assets/img/zcash.svg" },
  { code: "XDC",  name: "XinFin",          imageUrl: "https://blockchains.tatum.io/assets/img/xinfin.svg" },
  { code: "ETC",  name: "Ethereum Classic", imageUrl: "https://blockchains.tatum.io/assets/img/ethereum-classic.svg" },
  { code: "CHZ",  name: "Chiliz",          imageUrl: "https://blockchains.tatum.io/assets/img/chiliz.svg" },
  { code: "LUMIA", name: "Lumia",          imageUrl: "https://blockchains.tatum.io/assets/img/lumia.svg" },
  { code: "IOTA", name: "IOTA",            imageUrl: "https://blockchains.tatum.io/assets/img/iota.svg" },
  // Tier 3
  { code: "RON",  name: "Ronin",           imageUrl: "https://blockchains.tatum.io/assets/img/ronin.svg" },
  { code: "ROSE", name: "Oasis",           imageUrl: "https://blockchains.tatum.io/assets/img/oasis.svg" },
  { code: "RBTC", name: "Rootstock",       imageUrl: "https://blockchains.tatum.io/assets/img/rootstock.svg" },
  { code: "xDAI", name: "Gnosis",          imageUrl: "https://blockchains.tatum.io/assets/img/gnosis.svg" },
  { code: "ISLM", name: "HAQQ",            imageUrl: "https://blockchains.tatum.io/assets/img/haqq.svg" },
  { code: "ONE",  name: "Harmony",         imageUrl: "https://blockchains.tatum.io/assets/img/harmony.svg" },
  { code: "KCS",  name: "Kucoin",          imageUrl: "https://blockchains.tatum.io/assets/img/kucoin.svg" },
  { code: "HYPE", name: "HyperEVM",        imageUrl: "https://blockchains.tatum.io/assets/img/hyperevm.svg" },
  { code: "MOCA", name: "Moca Chain",      imageUrl: "https://blockchains.tatum.io/assets/img/mocachain.svg" },
  { code: "ATOM", name: "Cosmos",          imageUrl: "https://blockchains.tatum.io/assets/img/cosmos.svg" },
  { code: "KSM",  name: "Kusama",          imageUrl: "https://blockchains.tatum.io/assets/img/kusama.svg" },
  { code: "VET",  name: "VeChain",         imageUrl: "https://blockchains.tatum.io/assets/img/vechain.svg" },
  { code: "ZIL",  name: "Zilliqa",         imageUrl: "https://blockchains.tatum.io/assets/img/zilliqa.svg" },
  { code: "CSPR", name: "Casper",          imageUrl: "https://blockchains.tatum.io/assets/img/casper.svg" },
  { code: "EOS",  name: "EOS",             imageUrl: "https://blockchains.tatum.io/assets/img/eos.svg" },
  { code: "OM",   name: "MANTRA",          imageUrl: "https://blockchains.tatum.io/assets/img/mantra.svg" },
  // Stablecoins (tokens, not native — mapped via TOKEN_MAPPINGS below)
  { code: "USDT", name: "Tether USD",      imageUrl: "https://assets.coingecko.com/coins/images/325/small/Tether.png" },
  { code: "USDC", name: "USD Coin",        imageUrl: "https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
]

// Token ↔ Network mappings with verified mainnet contract addresses.
// Only coins that are NOT the native coin for a given network need an entry here.
interface TokenMappingDef {
  coinCode: string
  networkCode: string
  contractAddress: string
  decimals: number
}

const TOKEN_MAPPINGS: TokenMappingDef[] = [
  // ── USDT ──────────────────────────────────────────────────────────────────
  { coinCode: "USDT", networkCode: "ETH",   contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6  },
  { coinCode: "USDT", networkCode: "BSC",   contractAddress: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  { coinCode: "USDT", networkCode: "TRX",   contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",       decimals: 6  },
  { coinCode: "USDT", networkCode: "MATIC", contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6  },
  { coinCode: "USDT", networkCode: "ARB",   contractAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6  },
  { coinCode: "USDT", networkCode: "OP",    contractAddress: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6  },
  { coinCode: "USDT", networkCode: "AVAX",  contractAddress: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6  },
  { coinCode: "USDT", networkCode: "SOL",   contractAddress: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6  },

  // ── USDC ──────────────────────────────────────────────────────────────────
  { coinCode: "USDC", networkCode: "ETH",   contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6  },
  { coinCode: "USDC", networkCode: "BSC",   contractAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  { coinCode: "USDC", networkCode: "TRX",   contractAddress: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",       decimals: 6  },
  { coinCode: "USDC", networkCode: "MATIC", contractAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6  },
  { coinCode: "USDC", networkCode: "ARB",   contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6  },
  { coinCode: "USDC", networkCode: "OP",    contractAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6  },
  { coinCode: "USDC", networkCode: "BASE",  contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6  },
  { coinCode: "USDC", networkCode: "AVAX",  contractAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6  },
  { coinCode: "USDC", networkCode: "SOL",   contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6  },
]

// Every network and which native coin it uses (by Coin.code).
const NETWORKS: NetworkDef[] = [
  // ── Tier 1 ──────────────────────────────────────────────────────────────
  { code: "ETH",     name: "Ethereum",         chain: "ethereum",      tatumWalletSlug: "ETH",      nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://etherscan.io",                imageUrl: "https://blockchains.tatum.io/assets/img/ethereum.svg" },
  { code: "BSC",     name: "BNB Smart Chain",   chain: "bsc",           tatumWalletSlug: "BSC",      nativeCoinCode: "BNB",  decimals: 18, explorerUrl: "https://bscscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/bsc.svg" },
  { code: "TRX",     name: "Tron",              chain: "tron",          tatumWalletSlug: "TRON",     nativeCoinCode: "TRX",  decimals: 6,  explorerUrl: "https://tronscan.org",                 imageUrl: "https://blockchains.tatum.io/assets/img/tron.svg" },
  { code: "MATIC",   name: "Polygon",           chain: "polygon",       tatumWalletSlug: "MATIC",    nativeCoinCode: "POL",  decimals: 18, explorerUrl: "https://polygonscan.com",              imageUrl: "https://blockchains.tatum.io/assets/img/polygon.svg" },
  { code: "BTC",     name: "Bitcoin",            chain: "bitcoin",       tatumWalletSlug: "BTC",      nativeCoinCode: "BTC",  decimals: 8,  explorerUrl: "https://blockstream.info",             imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin.svg" },
  { code: "SOL",     name: "Solana",             chain: "solana",        tatumWalletSlug: "SOL",      nativeCoinCode: "SOL",  decimals: 9,  explorerUrl: "https://solscan.io",                   imageUrl: "https://blockchains.tatum.io/assets/img/solana.svg" },
  { code: "ARB",     name: "Arbitrum One",       chain: "arbitrum-one",  tatumWalletSlug: "ETH_ARB",  nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://arbiscan.io",                  imageUrl: "https://blockchains.tatum.io/assets/img/arbitrum-one.svg" },
  { code: "OP",      name: "Optimism",           chain: "optimism",      tatumWalletSlug: "ETH_OP",   nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://optimistic.etherscan.io",      imageUrl: "https://blockchains.tatum.io/assets/img/optimism.svg" },
  { code: "BASE",    name: "Base",               chain: "base",          tatumWalletSlug: "ETH_BASE", nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://basescan.org",                 imageUrl: "https://blockchains.tatum.io/assets/img/base.svg" },
  { code: "AVAX",    name: "Avalanche",          chain: "avalanche-c",   tatumWalletSlug: "avax-mainnet", nativeCoinCode: "AVAX", decimals: 18, explorerUrl: "https://snowtrace.io",                 imageUrl: "https://blockchains.tatum.io/assets/img/avalanche.svg" },
  { code: "XRP",     name: "Ripple",             chain: "xrp",           tatumWalletSlug: "XRP",      nativeCoinCode: "XRP",  decimals: 6,  explorerUrl: "https://xrpscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/ripple.svg" },
  { code: "XLM",     name: "Stellar",            chain: "xlm",           tatumWalletSlug: null,        nativeCoinCode: "XLM",  decimals: 7,  explorerUrl: "https://stellar.expert",               imageUrl: "https://blockchains.tatum.io/assets/img/stellar.svg" },
  { code: "LTC",     name: "Litecoin",           chain: "litecoin",      tatumWalletSlug: "LTC",      nativeCoinCode: "LTC",  decimals: 8,  explorerUrl: "https://blockchair.com/litecoin",      imageUrl: "https://blockchains.tatum.io/assets/img/litecoin.svg" },
  { code: "DOGE",    name: "Dogecoin",           chain: "dogecoin",      tatumWalletSlug: "DOGE",     nativeCoinCode: "DOGE", decimals: 8,  explorerUrl: "https://dogechain.info",               imageUrl: "https://blockchains.tatum.io/assets/img/dogecoin.svg" },
  { code: "ZK",      name: "ZKsync",             chain: "zksync",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.zksync.io",           imageUrl: "https://blockchains.tatum.io/assets/img/zksync.svg" },
  { code: "FLR",     name: "Flare",              chain: "flare",         tatumWalletSlug: "FLR",      nativeCoinCode: "FLR",  decimals: 18, explorerUrl: "https://flarescan.com",                imageUrl: "https://blockchains.tatum.io/assets/img/flare.svg" },
  { code: "KAIA",    name: "Kaia",               chain: "kaia",          tatumWalletSlug: "KAIA",     nativeCoinCode: "KAIA", decimals: 18, explorerUrl: "https://kaiascope.com",                imageUrl: "https://blockchains.tatum.io/assets/img/kaia.svg" },

  // ── Tier 2 ──────────────────────────────────────────────────────────────
  { code: "ALGO",    name: "Algorand",           chain: "algorand",      tatumWalletSlug: null,        nativeCoinCode: "ALGO", decimals: 6,  explorerUrl: "https://algoexplorer.io",              imageUrl: "https://blockchains.tatum.io/assets/img/algorand.svg" },
  { code: "BCH",     name: "Bitcoin Cash",       chain: "bch",           tatumWalletSlug: "BCH",       nativeCoinCode: "BCH",  decimals: 8,  explorerUrl: "https://blockchair.com/bitcoin-cash",  imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin-cash.svg" },
  { code: "ADA",     name: "Cardano",            chain: "cardano",       tatumWalletSlug: null,        nativeCoinCode: "ADA",  decimals: 6,  explorerUrl: "https://cardanoscan.io",               imageUrl: "https://blockchains.tatum.io/assets/img/cardano.svg" },
  { code: "CELO",    name: "Celo",               chain: "celo",          tatumWalletSlug: "CELO",     nativeCoinCode: "CELO", decimals: 18, explorerUrl: "https://explorer.celo.org",            imageUrl: "https://blockchains.tatum.io/assets/img/celo.svg" },
  { code: "DOT",     name: "Polkadot",           chain: "polkadot",      tatumWalletSlug: null,        nativeCoinCode: "DOT",  decimals: 10, explorerUrl: "https://polkadot.subscan.io",          imageUrl: "https://blockchains.tatum.io/assets/img/polkadot.svg" },
  { code: "NEAR",    name: "Near",               chain: "near",          tatumWalletSlug: null,        nativeCoinCode: "NEAR", decimals: 24, explorerUrl: "https://nearblocks.io",                imageUrl: "https://blockchains.tatum.io/assets/img/near.svg" },
  { code: "XTZ",     name: "Tezos",              chain: "tezos",         tatumWalletSlug: "TEZOS",    nativeCoinCode: "XTZ",  decimals: 6,  explorerUrl: "https://tzstats.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/tezos.svg" },
  { code: "EGLD",    name: "MultiversX",         chain: "multiversx",    tatumWalletSlug: null,        nativeCoinCode: "EGLD", decimals: 18, explorerUrl: "https://explorer.multiversx.com",      imageUrl: "https://blockchains.tatum.io/assets/img/multiversx.svg" },
  { code: "FTM",     name: "Fantom",             chain: "fantom",        tatumWalletSlug: "FTM",      nativeCoinCode: "FTM",  decimals: 18, explorerUrl: "https://ftmscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/fantom.svg" },
  { code: "CRO",     name: "Cronos",             chain: "cronos",        tatumWalletSlug: "CRO",      nativeCoinCode: "CRO",  decimals: 18, explorerUrl: "https://cronoscan.com",                imageUrl: "https://blockchains.tatum.io/assets/img/cronos.svg" },
  { code: "GLMR",    name: "Moonbeam",           chain: "moonbeam",      tatumWalletSlug: null,        nativeCoinCode: "GLMR", decimals: 18, explorerUrl: "https://moonbeam.moonscan.io",         imageUrl: "https://blockchains.tatum.io/assets/img/moonbeam.svg" },
  { code: "S",       name: "Sonic",              chain: "sonic",         tatumWalletSlug: null,        nativeCoinCode: "S",    decimals: 18, explorerUrl: "https://explorer.soniclabs.com",       imageUrl: "https://blockchains.tatum.io/assets/img/sonic.svg" },
  { code: "BERA",    name: "Berachain",          chain: "berachain",     tatumWalletSlug: "BERA",      nativeCoinCode: "BERA", decimals: 18, explorerUrl: "https://berascan.com",                 imageUrl: "https://blockchains.tatum.io/assets/img/berachain.svg" },
  { code: "UNI_L2",  name: "Unichain",           chain: "unichain",      tatumWalletSlug: "ETH_UNI",  nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://uniscan.xyz",                  imageUrl: "https://blockchains.tatum.io/assets/img/unichain.svg" },
  { code: "MON",     name: "Monad",              chain: "monad",         tatumWalletSlug: "MON",      nativeCoinCode: "MON",  decimals: 18, explorerUrl: "https://explorer.monad.xyz",           imageUrl: "https://blockchains.tatum.io/assets/img/monad.svg" },
  { code: "SUI",     name: "SUI",                chain: "sui",           tatumWalletSlug: null,        nativeCoinCode: "SUI",  decimals: 9,  explorerUrl: "https://suiexplorer.com",              imageUrl: "https://blockchains.tatum.io/assets/img/sui.svg" },
  { code: "TON",     name: "TON",                chain: "ton",           tatumWalletSlug: null,        nativeCoinCode: "TON",  decimals: 9,  explorerUrl: "https://tonscan.org",                  imageUrl: "https://blockchains.tatum.io/assets/img/ton.svg" },
  { code: "ZEC",     name: "Zcash",              chain: "zcash",         tatumWalletSlug: null,        nativeCoinCode: "ZEC",  decimals: 8,  explorerUrl: "https://zcashblockexplorer.com",       imageUrl: "https://blockchains.tatum.io/assets/img/zcash.svg" },
  { code: "XDC",     name: "XinFin",             chain: "xdc",           tatumWalletSlug: null,        nativeCoinCode: "XDC",  decimals: 18, explorerUrl: "https://explorer.xinfin.network",      imageUrl: "https://blockchains.tatum.io/assets/img/xinfin.svg" },
  { code: "DOT_AH",  name: "Polkadot Asset Hub", chain: "polkadot-assethub", tatumWalletSlug: null,                    nativeCoinCode: "DOT",  decimals: 10, explorerUrl: "https://assethub-polkadot.subscan.io", imageUrl: "https://blockchains.tatum.io/assets/img/polkadot-assethub.svg" },
  { code: "ETC",     name: "Ethereum Classic",   chain: "ethereum-classic", tatumWalletSlug: null,                  nativeCoinCode: "ETC",  decimals: 18, explorerUrl: "https://blockscout.com/etc/mainnet",   imageUrl: "https://blockchains.tatum.io/assets/img/ethereum-classic.svg" },
  { code: "CHZ",     name: "Chiliz",             chain: "chiliz",        tatumWalletSlug: "CHZ",      nativeCoinCode: "CHZ",  decimals: 18, explorerUrl: "https://explorer.chiliz.com",          imageUrl: "https://blockchains.tatum.io/assets/img/chiliz.svg" },
  { code: "LUMIA",   name: "Lumia",              chain: "lumia",         tatumWalletSlug: null,        nativeCoinCode: "LUMIA", decimals: 18, explorerUrl: "https://explorer.lumia.org",           imageUrl: "https://blockchains.tatum.io/assets/img/lumia.svg" },
  { code: "IOTA",    name: "IOTA EVM",           chain: "iota-evm",      tatumWalletSlug: null,        nativeCoinCode: "IOTA", decimals: 18, explorerUrl: "https://explorer.iota.org",            imageUrl: "https://blockchains.tatum.io/assets/img/iota.svg" },

  // ── Tier 3 ──────────────────────────────────────────────────────────────
  { code: "ARBNOVA", name: "Arbitrum Nova",       chain: "arbitrum-nova", tatumWalletSlug: null,              nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://nova.arbiscan.io",             imageUrl: "https://blockchains.tatum.io/assets/img/arbitrum-nova.svg" },
  { code: "AURORA",  name: "Aurora",              chain: "aurora",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.aurora.dev",           imageUrl: "https://blockchains.tatum.io/assets/img/aurora.svg" },
  { code: "RON",     name: "Ronin",               chain: "ronin",         tatumWalletSlug: null,        nativeCoinCode: "RON",  decimals: 18, explorerUrl: "https://app.roninchain.com/explorer",  imageUrl: "https://blockchains.tatum.io/assets/img/ronin.svg" },
  { code: "ROSE",    name: "Oasis",               chain: "oasis",         tatumWalletSlug: null,        nativeCoinCode: "ROSE", decimals: 18, explorerUrl: "https://explorer.oasis.io",            imageUrl: "https://blockchains.tatum.io/assets/img/oasis.svg" },
  { code: "RBTC",    name: "Rootstock",            chain: "rootstock",     tatumWalletSlug: null,        nativeCoinCode: "RBTC", decimals: 18, explorerUrl: "https://explorer.rsk.co",              imageUrl: "https://blockchains.tatum.io/assets/img/rootstock.svg" },
  { code: "GNO",     name: "Gnosis",              chain: "gnosis",        tatumWalletSlug: null,        nativeCoinCode: "xDAI", decimals: 18, explorerUrl: "https://gnosisscan.io",                imageUrl: "https://blockchains.tatum.io/assets/img/gnosis.svg" },
  { code: "ISLM",    name: "HAQQ",                chain: "haqq",          tatumWalletSlug: null,        nativeCoinCode: "ISLM", decimals: 18, explorerUrl: "https://explorer.haqq.network",        imageUrl: "https://blockchains.tatum.io/assets/img/haqq.svg" },
  { code: "ONE",     name: "Harmony",             chain: "harmony",       tatumWalletSlug: null,        nativeCoinCode: "ONE",  decimals: 18, explorerUrl: "https://explorer.harmony.one",         imageUrl: "https://blockchains.tatum.io/assets/img/harmony.svg" },
  { code: "KCS",     name: "Kucoin",              chain: "kucoin",        tatumWalletSlug: null,        nativeCoinCode: "KCS",  decimals: 18, explorerUrl: "https://explorer.kcc.io",              imageUrl: "https://blockchains.tatum.io/assets/img/kucoin.svg" },
  { code: "LSK",     name: "Lisk",                chain: "lisk",          tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://blockscout.lisk.com",          imageUrl: "https://blockchains.tatum.io/assets/img/lisk.svg" },
  { code: "HYPEREVM", name: "HyperEVM",           chain: "hyperevm",      tatumWalletSlug: null,        nativeCoinCode: "HYPE", decimals: 18, explorerUrl: "https://explorer.hyperliquid.xyz",     imageUrl: "https://blockchains.tatum.io/assets/img/hyperevm.svg" },
  { code: "MEGAETH", name: "MegaETH",             chain: "megaeth",       tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://megaexplorer.xyz",             imageUrl: "https://blockchains.tatum.io/assets/img/megaeth.svg" },
  { code: "MOCA",    name: "Moca Chain",           chain: "mocachain",     tatumWalletSlug: "MOCA",     nativeCoinCode: "MOCA", decimals: 18, explorerUrl: null,                                   imageUrl: "https://blockchains.tatum.io/assets/img/mocachain.svg" },
  { code: "PLASMA",  name: "Plasma",              chain: "plasma",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: null,                                   imageUrl: "https://blockchains.tatum.io/assets/img/plasma.svg" },
  { code: "PLUME",   name: "Plume",               chain: "plume",         tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.plumenetwork.xyz",    imageUrl: "https://blockchains.tatum.io/assets/img/plume.svg" },
  { code: "ABSTRACT", name: "Abstract",           chain: "abstract",      tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.abs.xyz",             imageUrl: "https://blockchains.tatum.io/assets/img/abstract.svg" },
  { code: "ATOM",    name: "Cosmos",              chain: "cosmos",        tatumWalletSlug: null,        nativeCoinCode: "ATOM", decimals: 6,  explorerUrl: "https://www.mintscan.io/cosmos",       imageUrl: "https://blockchains.tatum.io/assets/img/cosmos.svg" },
  { code: "KSM",     name: "Kusama",              chain: "kusama",        tatumWalletSlug: null,        nativeCoinCode: "KSM",  decimals: 12, explorerUrl: "https://kusama.subscan.io",            imageUrl: "https://blockchains.tatum.io/assets/img/kusama.svg" },
  { code: "KSM_AH",  name: "Kusama Asset Hub",    chain: "kusama-assethub", tatumWalletSlug: null,                    nativeCoinCode: "KSM",  decimals: 12, explorerUrl: "https://assethub-kusama.subscan.io",   imageUrl: "https://blockchains.tatum.io/assets/img/kusama-assethub.svg" },
  { code: "VET",     name: "VeChain",             chain: "vechain",       tatumWalletSlug: null,        nativeCoinCode: "VET",  decimals: 18, explorerUrl: "https://explore.vechain.org",          imageUrl: "https://blockchains.tatum.io/assets/img/vechain.svg" },
  { code: "ZIL",     name: "Zilliqa",             chain: "zilliqa",       tatumWalletSlug: null,        nativeCoinCode: "ZIL",  decimals: 12, explorerUrl: "https://viewblock.io/zilliqa",         imageUrl: "https://blockchains.tatum.io/assets/img/zilliqa.svg" },
  { code: "CSPR",    name: "Casper",              chain: "casper",        tatumWalletSlug: null,        nativeCoinCode: "CSPR", decimals: 9,  explorerUrl: "https://cspr.live",                    imageUrl: "https://blockchains.tatum.io/assets/img/casper.svg" },
  { code: "EOS",     name: "EOS",                 chain: "eos",           tatumWalletSlug: null,        nativeCoinCode: "EOS",  decimals: 4,  explorerUrl: "https://bloks.io",                     imageUrl: "https://blockchains.tatum.io/assets/img/eos.svg" },
  { code: "OM",      name: "MANTRA Chain",        chain: "mantrachain",   tatumWalletSlug: null,              nativeCoinCode: "OM",   decimals: 6,  explorerUrl: "https://explorer.mantrachain.io",      imageUrl: "https://blockchains.tatum.io/assets/img/mantra.svg" },
]

// ─── Seed function ───────────────────────────────────────────────────────────

export async function seedNetworks() {
  // ── 0. Clean up all existing data (FK-safe order) ─────────────────────────
  console.log("Cleaning existing data...")
  const delSub  = await db.subscription.deleteMany({})
  const delTx   = await db.transaction.deleteMany({})
  const delReq  = await db.exchangeRequest.deleteMany({})
  const delAddr = await db.depositAddress.deleteMany({})
  const delMw   = await db.masterWallet.deleteMany({})
  const delGw   = await db.gasWallet.deleteMany({})
  const delMap  = await db.coinNetworkMapping.deleteMany({})
  const delNet  = await db.network.deleteMany({})
  const delCoin = await db.coin.deleteMany({})
  console.log(
    `  ✔ Deleted: ${delSub.count} subscriptions, ${delTx.count} transactions, ` +
    `${delReq.count} exchange requests, ${delAddr.count} deposit addresses, ` +
    `${delMw.count} master wallets, ${delGw.count} gas wallets, ` +
    `${delMap.count} mappings, ${delNet.count} networks, ${delCoin.count} coins`
  )

  // ── 1. Create Coins ──────────────────────────────────────────────────────
  console.log("Seeding coins...")
  let coinCount = 0
  const coinIdByCode = new Map<string, string>()

  for (const coin of COINS) {
    const row = await db.coin.create({
      data: {
        code: coin.code,
        name: coin.name,
        imageUrl: coin.imageUrl,
        status: "ACTIVE",
        floatFeePercent: 0,
        fixedFeePercent: 0,
        minimumFee: 0,
        minDepositAmount: 0,
        maxDepositAmount: null,
      },
    })
    coinIdByCode.set(coin.code, row.id)
    coinCount++
  }
  console.log(`  ✔ ${coinCount} coins upserted`)

  // ── 2. Create Networks ────────────────────────────────────────────────────
  console.log("Seeding networks...")
  let networkCount = 0
  const networkIdByCode = new Map<string, string>()

  for (const net of NETWORKS) {
    const row = await db.network.create({
      data: {
        code: net.code,
        name: net.name,
        chain: net.chain,
        tatumWalletSlug: net.tatumWalletSlug,
        status: "ACTIVE",
        isDepositEnabled: true,
        isWithdrawEnabled: true,
        explorerUrl: net.explorerUrl,
        nativeCoin: net.nativeCoinCode,
        imageUrl: net.imageUrl,
        kucoinChainCode: null,
      },
    })
    networkIdByCode.set(net.code, row.id)
    networkCount++
  }
  console.log(`  ✔ ${networkCount} networks upserted`)

  // ── 3. Create CoinNetworkMappings (native coin ↔ network) ─────────────
  console.log("Seeding coin-network mappings...")
  let mappingCount = 0

  for (const net of NETWORKS) {
    const coinId = coinIdByCode.get(net.nativeCoinCode)
    const networkId = networkIdByCode.get(net.code)

    if (!coinId) throw new Error(`Coin "${net.nativeCoinCode}" not found for network "${net.code}"`)
    if (!networkId) throw new Error(`Network "${net.code}" id not found`)

    await db.coinNetworkMapping.create({
      data: {
        coinId,
        networkId,
        contractAddress: null,
        decimals: net.decimals,
        isActive: true,
        depositEnabled: true,
        withdrawEnabled: true,
        tatumChainCode: null,
        binanceNetworkCode: null,
      },
    })
    mappingCount++
  }
  console.log(`  ✔ ${mappingCount} coin-network mappings upserted`)

  // ── 4. Create CoinNetworkMappings (token ↔ network, e.g. USDT on ETH) ──
  console.log("Seeding token-network mappings...")
  let tokenMappingCount = 0

  for (const tm of TOKEN_MAPPINGS) {
    const coinId = coinIdByCode.get(tm.coinCode)
    const networkId = networkIdByCode.get(tm.networkCode)

    if (!coinId) throw new Error(`Coin "${tm.coinCode}" not found for token mapping`)
    if (!networkId) throw new Error(`Network "${tm.networkCode}" not found for token mapping`)

    await db.coinNetworkMapping.create({
      data: {
        coinId,
        networkId,
        contractAddress: tm.contractAddress,
        decimals: tm.decimals,
        isActive: true,
        depositEnabled: true,
        withdrawEnabled: true,
        tatumChainCode: null,
        binanceNetworkCode: null,
      },
    })
    tokenMappingCount++
  }
  console.log(`  ✔ ${tokenMappingCount} token-network mappings upserted`)

  // ── 5. Create GasWallets (one per network) ────────────────────────────
  console.log("Seeding gas wallets...")
  let gasWalletCount = 0
  let gasWalletErrors = 0

  for (const net of NETWORKS) {
    const networkId = networkIdByCode.get(net.code)
    if (!networkId) continue

    try {
      const wallet = generateWallet(net.chain)
      const addr = await deriveAddress(wallet.xpub, 0, net.chain)
      const surprise = encryptMnemonic(wallet.mnemonic)

      await db.gasWallet.create({
        data: {
          networkId,
          address: addr.address,
          xpub: wallet.xpub,
          surprise,
          type: "MASTER",
          status: "ACTIVE",
          balance: 0,
          minBalance: 0,
          targetBalance: 0,
          isPrimary: true,
        },
      })
      gasWalletCount++
    } catch (err) {
      gasWalletErrors++
      console.error(`  ✗ Gas wallet for ${net.code} (${net.chain}):`, (err as Error).message)
    }
  }
  console.log(`  ✔ ${gasWalletCount} gas wallets created${gasWalletErrors ? `, ${gasWalletErrors} errors` : ""}`)

  console.log(`\nDone — ${coinCount} coins, ${networkCount} networks, ${mappingCount + tokenMappingCount} mappings, ${gasWalletCount} gas wallets`)
}

// Allow standalone execution: bun run db/seeds/networks.ts
if (import.meta.main) {
  seedNetworks()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err)
      process.exit(1)
    })
}
