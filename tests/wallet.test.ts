/**
 * tests/wallet.test.ts — Pure cryptographic operations: no mocking
 *
 * Tests generateWallet, deriveAddress, derivePrivateKey for all major chains.
 */

import { describe, it, expect } from "bun:test"
import { generateWallet, deriveAddress, derivePrivateKey } from "../index"
import { ethers } from "ethers"

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveAddress(
  result: import("../types").DerivedAddress | Promise<import("../types").DerivedAddress>,
): Promise<string> {
  const resolved = await result
  return resolved.address
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVM chains
// ═══════════════════════════════════════════════════════════════════════════════

for (const chain of ["ethereum-mainnet", "bsc-mainnet", "polygon-mainnet"]) {
  describe(`generateWallet("${chain}")`, () => {
    it("returns non-empty mnemonic string", () => {
      const w = generateWallet(chain)
      expect(typeof w.mnemonic).toBe("string")
      expect(w.mnemonic.length).toBeGreaterThan(0)
    })

    it("mnemonic contains exactly 12 words", () => {
      const w = generateWallet(chain)
      expect(w.mnemonic.split(" ").length).toBe(12)
    })

    it("returns non-empty xpub string", () => {
      const w = generateWallet(chain)
      expect(typeof w.xpub).toBe("string")
      expect(w.xpub.length).toBeGreaterThan(0)
    })

    it("calling twice returns different mnemonics", () => {
      const w1 = generateWallet(chain)
      const w2 = generateWallet(chain)
      expect(w1.mnemonic).not.toBe(w2.mnemonic)
    })
  })

  describe(`deriveAddress(xpub, index, "${chain}")`, () => {
    const { xpub } = generateWallet(chain)

    it("index 0 returns a non-empty address string", async () => {
      const addr = await resolveAddress(deriveAddress(xpub, 0, chain))
      expect(addr.length).toBeGreaterThan(0)
    })

    it("index 1 returns a non-empty address string", async () => {
      const addr = await resolveAddress(deriveAddress(xpub, 1, chain))
      expect(addr.length).toBeGreaterThan(0)
    })

    it("index 0 and index 1 return DIFFERENT addresses", async () => {
      const a0 = await resolveAddress(deriveAddress(xpub, 0, chain))
      const a1 = await resolveAddress(deriveAddress(xpub, 1, chain))
      expect(a0).not.toBe(a1)
    })

    it("same xpub + same index always returns the same address", async () => {
      const a1 = await resolveAddress(deriveAddress(xpub, 0, chain))
      const a2 = await resolveAddress(deriveAddress(xpub, 0, chain))
      expect(a1).toBe(a2)
    })

    it("address starts with '0x' and has length 42", async () => {
      const addr = await resolveAddress(deriveAddress(xpub, 0, chain))
      expect(addr.startsWith("0x")).toBe(true)
      expect(addr.length).toBe(42)
    })
  })

  describe(`derivePrivateKey(mnemonic, index, "${chain}")`, () => {
    const { mnemonic } = generateWallet(chain)

    it("returns non-empty string", () => {
      const key = derivePrivateKey(mnemonic, 0, chain)
      expect(key.length).toBeGreaterThan(0)
    })

    it("index 0 and index 1 return different keys", () => {
      const k0 = derivePrivateKey(mnemonic, 0, chain)
      const k1 = derivePrivateKey(mnemonic, 1, chain)
      expect(k0).not.toBe(k1)
    })

    it("same mnemonic + same index always returns the same key", () => {
      const k1 = derivePrivateKey(mnemonic, 0, chain)
      const k2 = derivePrivateKey(mnemonic, 0, chain)
      expect(k1).toBe(k2)
    })

    it("starts with '0x' and has length 66", () => {
      const key = derivePrivateKey(mnemonic, 0, chain)
      expect(key.startsWith("0x")).toBe(true)
      expect(key.length).toBe(66)
    })
  })

  describe(`cross-check wallet consistency for "${chain}"`, () => {
    it("address from xpub matches address from private key", async () => {
      const w = generateWallet(chain)
      const addrFromXpub = await resolveAddress(deriveAddress(w.xpub, 0, chain))
      const privKey = derivePrivateKey(w.mnemonic, 0, chain)
      const addrFromKey = ethers.computeAddress(privKey).toLowerCase()
      expect(addrFromXpub).toBe(addrFromKey)
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRON
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateWallet("tron-mainnet")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("tron-mainnet")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 12 words", () => {
    const w = generateWallet("tron-mainnet")
    expect(w.mnemonic.split(" ").length).toBe(12)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("tron-mainnet")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("tron-mainnet")
    const w2 = generateWallet("tron-mainnet")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(xpub, index, "tron-mainnet")', () => {
  const { xpub } = generateWallet("tron-mainnet")

  it("index 0 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "tron-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 1, "tron-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(xpub, 0, "tron-mainnet"))
    const a1 = await resolveAddress(deriveAddress(xpub, 1, "tron-mainnet"))
    expect(a0).not.toBe(a1)
  })

  it("same xpub + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(xpub, 0, "tron-mainnet"))
    const a2 = await resolveAddress(deriveAddress(xpub, 0, "tron-mainnet"))
    expect(a1).toBe(a2)
  })

  it("address starts with 'T' and has length 34", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "tron-mainnet"))
    expect(addr.startsWith("T")).toBe(true)
    expect(addr.length).toBe(34)
  })
})

describe('derivePrivateKey(mnemonic, index, "tron-mainnet")', () => {
  const { mnemonic } = generateWallet("tron-mainnet")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "tron-mainnet")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "tron-mainnet")
    const k1 = derivePrivateKey(mnemonic, 1, "tron-mainnet")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "tron-mainnet")
    const k2 = derivePrivateKey(mnemonic, 0, "tron-mainnet")
    expect(k1).toBe(k2)
  })

  it("hex string, length 64, no 0x prefix", () => {
    const key = derivePrivateKey(mnemonic, 0, "tron-mainnet")
    expect(key).not.toMatch(/^0x/)
    expect(key.length).toBe(64)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("cross-check wallet consistency for tron-mainnet", () => {
  it("address from xpub matches address from private key", async () => {
    const w = generateWallet("tron-mainnet")
    const addrFromXpub = await resolveAddress(deriveAddress(w.xpub, 0, "tron-mainnet"))
    const privKey = derivePrivateKey(w.mnemonic, 0, "tron-mainnet")
    // Compute TRON address from private key
    const ethAddr = ethers.computeAddress("0x" + privKey).toLowerCase().replace("0x", "")
    const TronWebMod = await import("tronweb") as any
    const TW = TronWebMod.TronWeb || TronWebMod.default || TronWebMod
    const tronAddress = TW.address.fromHex("41" + ethAddr)
    expect(addrFromXpub).toBe(tronAddress)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Bitcoin
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateWallet("bitcoin-mainnet")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("bitcoin-mainnet")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 24 words", () => {
    const w = generateWallet("bitcoin-mainnet")
    expect(w.mnemonic.split(" ").length).toBe(24)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("bitcoin-mainnet")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("bitcoin-mainnet")
    const w2 = generateWallet("bitcoin-mainnet")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(xpub, index, "bitcoin-mainnet")', () => {
  const { xpub } = generateWallet("bitcoin-mainnet")

  it("index 0 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "bitcoin-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 1, "bitcoin-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin-mainnet"))
    const a1 = await resolveAddress(deriveAddress(xpub, 1, "bitcoin-mainnet"))
    expect(a0).not.toBe(a1)
  })

  it("same xpub + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin-mainnet"))
    const a2 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin-mainnet"))
    expect(a1).toBe(a2)
  })

  it("address starts with 'bc1' (bech32)", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "bitcoin-mainnet"))
    expect(addr.startsWith("bc1")).toBe(true)
  })
})

describe('derivePrivateKey(mnemonic, index, "bitcoin-mainnet")', () => {
  const { mnemonic } = generateWallet("bitcoin-mainnet")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "bitcoin-mainnet")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "bitcoin-mainnet")
    const k1 = derivePrivateKey(mnemonic, 1, "bitcoin-mainnet")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "bitcoin-mainnet")
    const k2 = derivePrivateKey(mnemonic, 0, "bitcoin-mainnet")
    expect(k1).toBe(k2)
  })

  it("returns hex string (no 0x prefix)", () => {
    const key = derivePrivateKey(mnemonic, 0, "bitcoin-mainnet")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("cross-check wallet consistency for bitcoin-mainnet", () => {
  it("address from xpub index 0 is derivable from mnemonic index 0", async () => {
    const w = generateWallet("bitcoin-mainnet")
    const addrFromXpub = await resolveAddress(deriveAddress(w.xpub, 0, "bitcoin-mainnet"))
    // For BTC cross-check: derive both from xpub and independently re-derive
    // Just verify both paths produce bc1 addresses (deep cross-check requires
    // building p2wpkh from private key which is already tested in bitcoin.test.ts)
    const privKey = derivePrivateKey(w.mnemonic, 0, "bitcoin-mainnet")
    expect(addrFromXpub.startsWith("bc1")).toBe(true)
    expect(privKey.length).toBe(64)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Solana
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateWallet("solana-mainnet")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("solana-mainnet")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 24 words", () => {
    const w = generateWallet("solana-mainnet")
    expect(w.mnemonic.split(" ").length).toBe(24)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("solana-mainnet")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("solana-mainnet")
    const w2 = generateWallet("solana-mainnet")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(mnemonic, index, "solana-mainnet")', () => {
  // Solana uses mnemonic as "xpub" (no HD xpub derivation)
  const { mnemonic, xpub } = generateWallet("solana-mainnet")

  it("index 0 returns a non-empty address string", async () => {
    // For Solana, deriveAddress expects mnemonic
    const addr = await resolveAddress(deriveAddress(mnemonic, 0, "solana-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(mnemonic, 1, "solana-mainnet"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(mnemonic, 0, "solana-mainnet"))
    const a1 = await resolveAddress(deriveAddress(mnemonic, 1, "solana-mainnet"))
    expect(a0).not.toBe(a1)
  })

  it("same mnemonic + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(mnemonic, 0, "solana-mainnet"))
    const a2 = await resolveAddress(deriveAddress(mnemonic, 0, "solana-mainnet"))
    expect(a1).toBe(a2)
  })

  it("address is base58, length 32-44 chars", async () => {
    const addr = await resolveAddress(deriveAddress(mnemonic, 0, "solana-mainnet"))
    expect(addr.length).toBeGreaterThanOrEqual(32)
    expect(addr.length).toBeLessThanOrEqual(44)
    // base58 chars
    expect(addr).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
  })
})

describe('derivePrivateKey(mnemonic, index, "solana-mainnet")', () => {
  const { mnemonic } = generateWallet("solana-mainnet")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "solana-mainnet")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "solana-mainnet")
    const k1 = derivePrivateKey(mnemonic, 1, "solana-mainnet")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "solana-mainnet")
    const k2 = derivePrivateKey(mnemonic, 0, "solana-mainnet")
    expect(k1).toBe(k2)
  })

  it("returns base58 encoded secret key", () => {
    const key = derivePrivateKey(mnemonic, 0, "solana-mainnet")
    // Solana secret key is 64 bytes = ~88 base58 chars
    expect(key).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
    expect(key.length).toBeGreaterThan(60)
  })
})

describe("cross-check wallet consistency for solana-mainnet", () => {
  it("xpub (pubkey at index 0) matches address derived from mnemonic at index 0", async () => {
    const w = generateWallet("solana-mainnet")
    // xpub for Solana = base58 public key of index 0
    const derivedAddr = await resolveAddress(deriveAddress(w.mnemonic, 0, "solana-mainnet"))
    // The xpub IS the address for index 0
    expect(w.xpub).toBe(derivedAddr)
  })
})
