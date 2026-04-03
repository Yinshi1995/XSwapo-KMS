/**
 * tests/routing.test.ts — getFamily, isTestnet, gatewayUrl
 */

import { describe, it, expect } from "bun:test"
import { getFamily, isTestnet } from "../index"
import { gatewayUrl } from "../gateway"
import { evmRpcUrl } from "../chains/evm"

// ═══════════════════════════════════════════════════════════════════════════════
// getFamily
// ═══════════════════════════════════════════════════════════════════════════════

describe("getFamily", () => {
  it('"ethereum-mainnet" → "evm"', () => {
    expect(getFamily("ethereum-mainnet")).toBe("evm")
  })

  it('"bsc-mainnet" → "evm"', () => {
    expect(getFamily("bsc-mainnet")).toBe("evm")
  })

  it('"polygon-mainnet" → "evm"', () => {
    expect(getFamily("polygon-mainnet")).toBe("evm")
  })

  it('"bitcoin-mainnet" → "bitcoin"', () => {
    expect(getFamily("bitcoin-mainnet")).toBe("bitcoin")
  })

  it('"bitcoin-testnet" → "bitcoin"', () => {
    expect(getFamily("bitcoin-testnet")).toBe("bitcoin")
  })

  it('"tron-mainnet" → "tron"', () => {
    expect(getFamily("tron-mainnet")).toBe("tron")
  })

  it('"tron-testnet" → "tron"', () => {
    expect(getFamily("tron-testnet")).toBe("tron")
  })

  it('"solana-mainnet" → "solana"', () => {
    expect(getFamily("solana-mainnet")).toBe("solana")
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

  it('"ethereum-mainnet" → false', () => {
    expect(isTestnet("ethereum-mainnet")).toBe(false)
  })

  it('"bitcoin-mainnet" → false', () => {
    expect(isTestnet("bitcoin-mainnet")).toBe(false)
  })

  it('"solana-mainnet" → false', () => {
    expect(isTestnet("solana-mainnet")).toBe(false)
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
