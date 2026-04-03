import db from "../index"

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
]

// Every network and which native coin it uses (by Coin.code).
const NETWORKS: NetworkDef[] = [
  // ── Tier 1 ──────────────────────────────────────────────────────────────
  { code: "ETH",     name: "Ethereum",         chain: "ETH",           tatumWalletSlug: "ethereum",  nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://etherscan.io",                imageUrl: "https://blockchains.tatum.io/assets/img/ethereum.svg" },
  { code: "BSC",     name: "BNB Smart Chain",   chain: "BSC",           tatumWalletSlug: "bsc",       nativeCoinCode: "BNB",  decimals: 18, explorerUrl: "https://bscscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/bsc.svg" },
  { code: "TRX",     name: "Tron",              chain: "TRON",          tatumWalletSlug: "tron",      nativeCoinCode: "TRX",  decimals: 6,  explorerUrl: "https://tronscan.org",                 imageUrl: "https://blockchains.tatum.io/assets/img/tron.svg" },
  { code: "MATIC",   name: "Polygon",           chain: "MATIC",         tatumWalletSlug: "polygon",   nativeCoinCode: "POL",  decimals: 18, explorerUrl: "https://polygonscan.com",              imageUrl: "https://blockchains.tatum.io/assets/img/polygon.svg" },
  { code: "BTC",     name: "Bitcoin",            chain: "BTC",           tatumWalletSlug: "bitcoin",   nativeCoinCode: "BTC",  decimals: 8,  explorerUrl: "https://blockstream.info",             imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin.svg" },
  { code: "SOL",     name: "Solana",             chain: "SOL",           tatumWalletSlug: "solana",    nativeCoinCode: "SOL",  decimals: 9,  explorerUrl: "https://solscan.io",                   imageUrl: "https://blockchains.tatum.io/assets/img/solana.svg" },
  { code: "ARB",     name: "Arbitrum One",       chain: "ARBITRUM",      tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://arbiscan.io",                  imageUrl: "https://blockchains.tatum.io/assets/img/arbitrum-one.svg" },
  { code: "OP",      name: "Optimism",           chain: "OPTIMISM",      tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://optimistic.etherscan.io",      imageUrl: "https://blockchains.tatum.io/assets/img/optimism.svg" },
  { code: "BASE",    name: "Base",               chain: "BASE",          tatumWalletSlug: "base",      nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://basescan.org",                 imageUrl: "https://blockchains.tatum.io/assets/img/base.svg" },
  { code: "AVAX",    name: "Avalanche",          chain: "AVAX",          tatumWalletSlug: "avalanche", nativeCoinCode: "AVAX", decimals: 18, explorerUrl: "https://snowtrace.io",                 imageUrl: "https://blockchains.tatum.io/assets/img/avalanche.svg" },
  { code: "XRP",     name: "Ripple",             chain: "XRP",           tatumWalletSlug: "xrp",       nativeCoinCode: "XRP",  decimals: 6,  explorerUrl: "https://xrpscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/ripple.svg" },
  { code: "XLM",     name: "Stellar",            chain: "XLM",           tatumWalletSlug: "xlm",       nativeCoinCode: "XLM",  decimals: 7,  explorerUrl: "https://stellar.expert",               imageUrl: "https://blockchains.tatum.io/assets/img/stellar.svg" },
  { code: "LTC",     name: "Litecoin",           chain: "LTC",           tatumWalletSlug: "litecoin",  nativeCoinCode: "LTC",  decimals: 8,  explorerUrl: "https://blockchair.com/litecoin",      imageUrl: "https://blockchains.tatum.io/assets/img/litecoin.svg" },
  { code: "DOGE",    name: "Dogecoin",           chain: "DOGE",          tatumWalletSlug: "dogecoin",  nativeCoinCode: "DOGE", decimals: 8,  explorerUrl: "https://dogechain.info",               imageUrl: "https://blockchains.tatum.io/assets/img/dogecoin.svg" },
  { code: "ZK",      name: "ZKsync",             chain: "ZKSYNC",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.zksync.io",           imageUrl: "https://blockchains.tatum.io/assets/img/zksync.svg" },
  { code: "FLR",     name: "Flare",              chain: "FLARE",         tatumWalletSlug: null,        nativeCoinCode: "FLR",  decimals: 18, explorerUrl: "https://flarescan.com",                imageUrl: "https://blockchains.tatum.io/assets/img/flare.svg" },
  { code: "KAIA",    name: "Kaia",               chain: "KAIA",          tatumWalletSlug: null,        nativeCoinCode: "KAIA", decimals: 18, explorerUrl: "https://kaiascope.com",                imageUrl: "https://blockchains.tatum.io/assets/img/kaia.svg" },

  // ── Tier 2 ──────────────────────────────────────────────────────────────
  { code: "ALGO",    name: "Algorand",           chain: "ALGORAND",      tatumWalletSlug: "algorand",  nativeCoinCode: "ALGO", decimals: 6,  explorerUrl: "https://algoexplorer.io",              imageUrl: "https://blockchains.tatum.io/assets/img/algorand.svg" },
  { code: "BCH",     name: "Bitcoin Cash",       chain: "BCH",           tatumWalletSlug: "bcash",     nativeCoinCode: "BCH",  decimals: 8,  explorerUrl: "https://blockchair.com/bitcoin-cash",  imageUrl: "https://blockchains.tatum.io/assets/img/bitcoin-cash.svg" },
  { code: "ADA",     name: "Cardano",            chain: "ADA",           tatumWalletSlug: "cardano",   nativeCoinCode: "ADA",  decimals: 6,  explorerUrl: "https://cardanoscan.io",               imageUrl: "https://blockchains.tatum.io/assets/img/cardano.svg" },
  { code: "CELO",    name: "Celo",               chain: "CELO",          tatumWalletSlug: "celo",      nativeCoinCode: "CELO", decimals: 18, explorerUrl: "https://explorer.celo.org",            imageUrl: "https://blockchains.tatum.io/assets/img/celo.svg" },
  { code: "DOT",     name: "Polkadot",           chain: "DOT",           tatumWalletSlug: "dot",       nativeCoinCode: "DOT",  decimals: 10, explorerUrl: "https://polkadot.subscan.io",          imageUrl: "https://blockchains.tatum.io/assets/img/polkadot.svg" },
  { code: "NEAR",    name: "Near",               chain: "NEAR",          tatumWalletSlug: "near",      nativeCoinCode: "NEAR", decimals: 24, explorerUrl: "https://nearblocks.io",                imageUrl: "https://blockchains.tatum.io/assets/img/near.svg" },
  { code: "XTZ",     name: "Tezos",              chain: "XTZ",           tatumWalletSlug: "xtz",       nativeCoinCode: "XTZ",  decimals: 6,  explorerUrl: "https://tzstats.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/tezos.svg" },
  { code: "EGLD",    name: "MultiversX",         chain: "EGLD",          tatumWalletSlug: "egld",      nativeCoinCode: "EGLD", decimals: 18, explorerUrl: "https://explorer.multiversx.com",      imageUrl: "https://blockchains.tatum.io/assets/img/multiversx.svg" },
  { code: "FTM",     name: "Fantom",             chain: "FANTOM",        tatumWalletSlug: null,        nativeCoinCode: "FTM",  decimals: 18, explorerUrl: "https://ftmscan.com",                  imageUrl: "https://blockchains.tatum.io/assets/img/fantom.svg" },
  { code: "CRO",     name: "Cronos",             chain: "CRONOS",        tatumWalletSlug: null,        nativeCoinCode: "CRO",  decimals: 18, explorerUrl: "https://cronoscan.com",                imageUrl: "https://blockchains.tatum.io/assets/img/cronos.svg" },
  { code: "GLMR",    name: "Moonbeam",           chain: "MOONBEAM",      tatumWalletSlug: null,        nativeCoinCode: "GLMR", decimals: 18, explorerUrl: "https://moonbeam.moonscan.io",         imageUrl: "https://blockchains.tatum.io/assets/img/moonbeam.svg" },
  { code: "S",       name: "Sonic",              chain: "SONIC",         tatumWalletSlug: null,        nativeCoinCode: "S",    decimals: 18, explorerUrl: "https://explorer.soniclabs.com",       imageUrl: "https://blockchains.tatum.io/assets/img/sonic.svg" },
  { code: "BERA",    name: "Berachain",          chain: "BERACHAIN",     tatumWalletSlug: null,        nativeCoinCode: "BERA", decimals: 18, explorerUrl: "https://berascan.com",                 imageUrl: "https://blockchains.tatum.io/assets/img/berachain.svg" },
  { code: "UNI_L2",  name: "Unichain",           chain: "UNICHAIN",      tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://uniscan.xyz",                  imageUrl: "https://blockchains.tatum.io/assets/img/unichain.svg" },
  { code: "MON",     name: "Monad",              chain: "MONAD",         tatumWalletSlug: null,        nativeCoinCode: "MON",  decimals: 18, explorerUrl: "https://explorer.monad.xyz",           imageUrl: "https://blockchains.tatum.io/assets/img/monad.svg" },
  { code: "SUI",     name: "SUI",                chain: "SUI",           tatumWalletSlug: null,        nativeCoinCode: "SUI",  decimals: 9,  explorerUrl: "https://suiexplorer.com",              imageUrl: "https://blockchains.tatum.io/assets/img/sui.svg" },
  { code: "TON",     name: "TON",                chain: "TON",           tatumWalletSlug: null,        nativeCoinCode: "TON",  decimals: 9,  explorerUrl: "https://tonscan.org",                  imageUrl: "https://blockchains.tatum.io/assets/img/ton.svg" },
  { code: "ZEC",     name: "Zcash",              chain: "ZEC",           tatumWalletSlug: "zcash",     nativeCoinCode: "ZEC",  decimals: 8,  explorerUrl: "https://zcashblockexplorer.com",       imageUrl: "https://blockchains.tatum.io/assets/img/zcash.svg" },
  { code: "XDC",     name: "XinFin",             chain: "XDC",           tatumWalletSlug: "xinfin",    nativeCoinCode: "XDC",  decimals: 18, explorerUrl: "https://explorer.xinfin.network",      imageUrl: "https://blockchains.tatum.io/assets/img/xinfin.svg" },
  { code: "DOT_AH",  name: "Polkadot Asset Hub", chain: "DOT_AH",       tatumWalletSlug: null,        nativeCoinCode: "DOT",  decimals: 10, explorerUrl: "https://assethub-polkadot.subscan.io", imageUrl: "https://blockchains.tatum.io/assets/img/polkadot-assethub.svg" },
  { code: "ETC",     name: "Ethereum Classic",   chain: "ETC",           tatumWalletSlug: "ethereumclassic", nativeCoinCode: "ETC",  decimals: 18, explorerUrl: "https://blockscout.com/etc/mainnet",   imageUrl: "https://blockchains.tatum.io/assets/img/ethereum-classic.svg" },
  { code: "CHZ",     name: "Chiliz",             chain: "CHILIZ",        tatumWalletSlug: null,        nativeCoinCode: "CHZ",  decimals: 18, explorerUrl: "https://explorer.chiliz.com",          imageUrl: "https://blockchains.tatum.io/assets/img/chiliz.svg" },
  { code: "LUMIA",   name: "Lumia",              chain: "LUMIA",         tatumWalletSlug: null,        nativeCoinCode: "LUMIA", decimals: 18, explorerUrl: "https://explorer.lumia.org",           imageUrl: "https://blockchains.tatum.io/assets/img/lumia.svg" },
  { code: "IOTA",    name: "IOTA EVM",           chain: "IOTA",          tatumWalletSlug: null,        nativeCoinCode: "IOTA", decimals: 18, explorerUrl: "https://explorer.iota.org",            imageUrl: "https://blockchains.tatum.io/assets/img/iota.svg" },

  // ── Tier 3 ──────────────────────────────────────────────────────────────
  { code: "ARBNOVA", name: "Arbitrum Nova",       chain: "ARBITRUM_NOVA", tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://nova.arbiscan.io",             imageUrl: "https://blockchains.tatum.io/assets/img/arbitrum-nova.svg" },
  { code: "AURORA",  name: "Aurora",              chain: "AURORA",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.aurora.dev",           imageUrl: "https://blockchains.tatum.io/assets/img/aurora.svg" },
  { code: "RON",     name: "Ronin",               chain: "RONIN",         tatumWalletSlug: null,        nativeCoinCode: "RON",  decimals: 18, explorerUrl: "https://app.roninchain.com/explorer",  imageUrl: "https://blockchains.tatum.io/assets/img/ronin.svg" },
  { code: "ROSE",    name: "Oasis",               chain: "OASIS",         tatumWalletSlug: null,        nativeCoinCode: "ROSE", decimals: 18, explorerUrl: "https://explorer.oasis.io",            imageUrl: "https://blockchains.tatum.io/assets/img/oasis.svg" },
  { code: "RBTC",    name: "Rootstock",            chain: "ROOTSTOCK",     tatumWalletSlug: null,        nativeCoinCode: "RBTC", decimals: 18, explorerUrl: "https://explorer.rsk.co",              imageUrl: "https://blockchains.tatum.io/assets/img/rootstock.svg" },
  { code: "GNO",     name: "Gnosis",              chain: "GNOSIS",        tatumWalletSlug: null,        nativeCoinCode: "xDAI", decimals: 18, explorerUrl: "https://gnosisscan.io",                imageUrl: "https://blockchains.tatum.io/assets/img/gnosis.svg" },
  { code: "ISLM",    name: "HAQQ",                chain: "HAQQ",          tatumWalletSlug: null,        nativeCoinCode: "ISLM", decimals: 18, explorerUrl: "https://explorer.haqq.network",        imageUrl: "https://blockchains.tatum.io/assets/img/haqq.svg" },
  { code: "ONE",     name: "Harmony",             chain: "HARMONY",       tatumWalletSlug: null,        nativeCoinCode: "ONE",  decimals: 18, explorerUrl: "https://explorer.harmony.one",         imageUrl: "https://blockchains.tatum.io/assets/img/harmony.svg" },
  { code: "KCS",     name: "Kucoin",              chain: "KCC",           tatumWalletSlug: null,        nativeCoinCode: "KCS",  decimals: 18, explorerUrl: "https://explorer.kcc.io",              imageUrl: "https://blockchains.tatum.io/assets/img/kucoin.svg" },
  { code: "LSK",     name: "Lisk",                chain: "LISK",          tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://blockscout.lisk.com",          imageUrl: "https://blockchains.tatum.io/assets/img/lisk.svg" },
  { code: "HYPEREVM", name: "HyperEVM",           chain: "HYPEREVM",      tatumWalletSlug: null,        nativeCoinCode: "HYPE", decimals: 18, explorerUrl: "https://explorer.hyperliquid.xyz",     imageUrl: "https://blockchains.tatum.io/assets/img/hyperevm.svg" },
  { code: "MEGAETH", name: "MegaETH",             chain: "MEGAETH",       tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://megaexplorer.xyz",             imageUrl: "https://blockchains.tatum.io/assets/img/megaeth.svg" },
  { code: "MOCA",    name: "Moca Chain",           chain: "MOCACHAIN",     tatumWalletSlug: null,        nativeCoinCode: "MOCA", decimals: 18, explorerUrl: null,                                   imageUrl: "https://blockchains.tatum.io/assets/img/mocachain.svg" },
  { code: "PLASMA",  name: "Plasma",              chain: "PLASMA",        tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: null,                                   imageUrl: "https://blockchains.tatum.io/assets/img/plasma.svg" },
  { code: "PLUME",   name: "Plume",               chain: "PLUME",         tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.plumenetwork.xyz",    imageUrl: "https://blockchains.tatum.io/assets/img/plume.svg" },
  { code: "ABSTRACT", name: "Abstract",           chain: "ABSTRACT",      tatumWalletSlug: null,        nativeCoinCode: "ETH",  decimals: 18, explorerUrl: "https://explorer.abs.xyz",             imageUrl: "https://blockchains.tatum.io/assets/img/abstract.svg" },
  { code: "ATOM",    name: "Cosmos",              chain: "COSMOS",        tatumWalletSlug: null,        nativeCoinCode: "ATOM", decimals: 6,  explorerUrl: "https://www.mintscan.io/cosmos",       imageUrl: "https://blockchains.tatum.io/assets/img/cosmos.svg" },
  { code: "KSM",     name: "Kusama",              chain: "KUSAMA",        tatumWalletSlug: null,        nativeCoinCode: "KSM",  decimals: 12, explorerUrl: "https://kusama.subscan.io",            imageUrl: "https://blockchains.tatum.io/assets/img/kusama.svg" },
  { code: "KSM_AH",  name: "Kusama Asset Hub",    chain: "KUSAMA_AH",     tatumWalletSlug: null,        nativeCoinCode: "KSM",  decimals: 12, explorerUrl: "https://assethub-kusama.subscan.io",   imageUrl: "https://blockchains.tatum.io/assets/img/kusama-assethub.svg" },
  { code: "VET",     name: "VeChain",             chain: "VET",           tatumWalletSlug: "vechain",   nativeCoinCode: "VET",  decimals: 18, explorerUrl: "https://explore.vechain.org",          imageUrl: "https://blockchains.tatum.io/assets/img/vechain.svg" },
  { code: "ZIL",     name: "Zilliqa",             chain: "ZIL",           tatumWalletSlug: null,        nativeCoinCode: "ZIL",  decimals: 12, explorerUrl: "https://viewblock.io/zilliqa",         imageUrl: "https://blockchains.tatum.io/assets/img/zilliqa.svg" },
  { code: "CSPR",    name: "Casper",              chain: "CASPER",        tatumWalletSlug: null,        nativeCoinCode: "CSPR", decimals: 9,  explorerUrl: "https://cspr.live",                    imageUrl: "https://blockchains.tatum.io/assets/img/casper.svg" },
  { code: "EOS",     name: "EOS",                 chain: "EOS",           tatumWalletSlug: null,        nativeCoinCode: "EOS",  decimals: 4,  explorerUrl: "https://bloks.io",                     imageUrl: "https://blockchains.tatum.io/assets/img/eos.svg" },
  { code: "OM",      name: "MANTRA Chain",        chain: "MANTRA",        tatumWalletSlug: null,        nativeCoinCode: "OM",   decimals: 6,  explorerUrl: "https://explorer.mantrachain.io",      imageUrl: "https://blockchains.tatum.io/assets/img/mantra.svg" },
]

// ─── Seed function ───────────────────────────────────────────────────────────

export async function seedNetworks() {
  // ── 1. Upsert Coins ──────────────────────────────────────────────────────
  console.log("Seeding coins...")
  let coinCount = 0
  const coinIdByCode = new Map<string, string>()

  for (const coin of COINS) {
    const row = await db.coin.upsert({
      where: { code: coin.code },
      update: {
        name: coin.name,
        imageUrl: coin.imageUrl,
      },
      create: {
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

  // ── 2. Upsert Networks ────────────────────────────────────────────────────
  console.log("Seeding networks...")
  let networkCount = 0
  const networkIdByCode = new Map<string, string>()

  for (const net of NETWORKS) {
    const row = await db.network.upsert({
      where: { code: net.code },
      update: {
        name: net.name,
        chain: net.chain,
        tatumWalletSlug: net.tatumWalletSlug,
        explorerUrl: net.explorerUrl,
        nativeCoin: net.nativeCoinCode,
        imageUrl: net.imageUrl,
      },
      create: {
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

  // ── 3. Upsert CoinNetworkMappings (native coin ↔ network) ───────────────
  console.log("Seeding coin-network mappings...")
  let mappingCount = 0

  for (const net of NETWORKS) {
    const coinId = coinIdByCode.get(net.nativeCoinCode)
    const networkId = networkIdByCode.get(net.code)

    if (!coinId) throw new Error(`Coin "${net.nativeCoinCode}" not found for network "${net.code}"`)
    if (!networkId) throw new Error(`Network "${net.code}" id not found`)

    await db.coinNetworkMapping.upsert({
      where: { coinId_networkId: { coinId, networkId } },
      update: {
        decimals: net.decimals,
        isActive: true,
        depositEnabled: true,
        withdrawEnabled: true,
      },
      create: {
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

  console.log(`\nDone — ${coinCount} coins, ${networkCount} networks, ${mappingCount} mappings`)
}

// Allow standalone execution: bun run db/seeds/networks.ts
const isMain =
  typeof require !== "undefined" && require.main === module

if (isMain) {
  seedNetworks()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err)
      process.exit(1)
    })
}
