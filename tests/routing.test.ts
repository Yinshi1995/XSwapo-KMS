/**
 * tests/routing.test.ts — getFamily, isTestnet, gatewayUrl
 */

import { describe, it, expect } from "bun:test"
import { getFamily, isTestnet, normalizeChain } from "../index"
import { gatewayUrl } from "../gateway"
import { evmRpcUrl } from "../chains/evm"

// ═══════════════════════════════════════════════════════════════════════════════
// getFamily
// ═══════════════════════════════════════════════════════════════════════════════

describe("getFamily", () => {
  it('"ethereum" → "evm"', () => {
    expect(getFamily("ethereum")).toBe("evm")
  })

  it('"bsc" → "evm"', () => {
    expect(getFamily("bsc")).toBe("evm")
  })

  it('"polygon" → "evm"', () => {
    expect(getFamily("polygon")).toBe("evm")
  })

  it('"bitcoin" → "bitcoin"', () => {
    expect(getFamily("bitcoin")).toBe("bitcoin")
  })

  it('"bitcoin-testnet" → "bitcoin"', () => {
    expect(getFamily("bitcoin-testnet")).toBe("bitcoin")
  })

  it('"tron" → "tron"', () => {
    expect(getFamily("tron")).toBe("tron")
  })

  it('"tron-testnet" → "tron"', () => {
    expect(getFamily("tron-testnet")).toBe("tron")
  })

  it('"solana" → "solana"', () => {
    expect(getFamily("solana")).toBe("solana")
  })

  it('"solana-devnet" → "solana"', () => {
    expect(getFamily("solana-devnet")).toBe("solana")
  })

  it("unknown chain falls through to evm", () => {
    expect(getFamily("random-unknown-chain")).toBe("evm")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// isTestnet
// ═══════════════════════════════════════════════════════════════════════════════

describe("isTestnet", () => {
  it('"ethereum-sepolia" → true', () => {
    expect(isTestnet("ethereum-sepolia")).toBe(true)
  })

  it('"bitcoin-testnet" → true', () => {
    expect(isTestnet("bitcoin-testnet")).toBe(true)
  })

  it('"solana-devnet" → true', () => {
    expect(isTestnet("solana-devnet")).toBe(true)
  })

  it('"polygon-amoy" → true', () => {
    expect(isTestnet("polygon-amoy")).toBe(true)
  })

  it('"ethereum" → false', () => {
    expect(isTestnet("ethereum")).toBe(false)
  })

  it('"bitcoin" → false', () => {
    expect(isTestnet("bitcoin")).toBe(false)
  })

  it('"solana" → false', () => {
    expect(isTestnet("solana")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// normalizeChain
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalizeChain", () => {
  it('"ethereum" → "ethereum-mainnet"', () => {
    expect(normalizeChain("ethereum")).toBe("ethereum-mainnet")
  })

  it('"bsc" → "bsc-mainnet"', () => {
    expect(normalizeChain("bsc")).toBe("bsc-mainnet")
  })

  it('"ethereum-mainnet" stays unchanged', () => {
    expect(normalizeChain("ethereum-mainnet")).toBe("ethereum-mainnet")
  })

  it('"bitcoin-testnet" stays unchanged', () => {
    expect(normalizeChain("bitcoin-testnet")).toBe("bitcoin-testnet")
  })

  it('"ethereum-sepolia" stays unchanged', () => {
    expect(normalizeChain("ethereum-sepolia")).toBe("ethereum-sepolia")
  })

  it('"polygon-amoy" stays unchanged', () => {
    expect(normalizeChain("polygon-amoy")).toBe("polygon-amoy")
  })

  it('"solana-devnet" stays unchanged', () => {
    expect(normalizeChain("solana-devnet")).toBe("solana-devnet")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// gatewayUrl / RPC URL construction
// ═══════════════════════════════════════════════════════════════════════════════

describe("gatewayUrl", () => {
  it('"ethereum-mainnet" → "https://ethereum-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("ethereum-mainnet")).toBe("https://ethereum-mainnet.gateway.tatum.io")
  })

  it('"bsc-mainnet" → "https://bsc-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("bsc-mainnet")).toBe("https://bsc-mainnet.gateway.tatum.io")
  })

  it('"bitcoin-mainnet" → "https://bitcoin-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("bitcoin-mainnet")).toBe("https://bitcoin-mainnet.gateway.tatum.io")
  })

  it('"solana-mainnet" → "https://solana-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("solana-mainnet")).toBe("https://solana-mainnet.gateway.tatum.io")
  })

  it('"tron-mainnet" → "https://tron-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("tron-mainnet")).toBe("https://tron-mainnet.gateway.tatum.io")
  })

  it('arbitrary chain "foo-mainnet" → "https://foo-mainnet.gateway.tatum.io"', () => {
    expect(gatewayUrl("foo-mainnet")).toBe("https://foo-mainnet.gateway.tatum.io")
  })
})

describe("evmRpcUrl", () => {
  it("delegates to gatewayUrl for any EVM chain", () => {
    expect(evmRpcUrl("ethereum-mainnet")).toBe(gatewayUrl("ethereum-mainnet"))
    expect(evmRpcUrl("base-mainnet")).toBe(gatewayUrl("base-mainnet"))
  })
})
