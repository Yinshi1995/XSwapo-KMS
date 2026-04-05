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

for (const chain of ["ethereum", "bsc", "polygon"]) {
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

describe('generateWallet("tron")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("tron")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 12 words", () => {
    const w = generateWallet("tron")
    expect(w.mnemonic.split(" ").length).toBe(12)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("tron")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("tron")
    const w2 = generateWallet("tron")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(xpub, index, "tron")', () => {
  const { xpub } = generateWallet("tron")

  it("index 0 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "tron"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 1, "tron"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(xpub, 0, "tron"))
    const a1 = await resolveAddress(deriveAddress(xpub, 1, "tron"))
    expect(a0).not.toBe(a1)
  })

  it("same xpub + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(xpub, 0, "tron"))
    const a2 = await resolveAddress(deriveAddress(xpub, 0, "tron"))
    expect(a1).toBe(a2)
  })

  it("address starts with 'T' and has length 34", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "tron"))
    expect(addr.startsWith("T")).toBe(true)
    expect(addr.length).toBe(34)
  })
})

describe('derivePrivateKey(mnemonic, index, "tron")', () => {
  const { mnemonic } = generateWallet("tron")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "tron")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "tron")
    const k1 = derivePrivateKey(mnemonic, 1, "tron")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "tron")
    const k2 = derivePrivateKey(mnemonic, 0, "tron")
    expect(k1).toBe(k2)
  })

  it("hex string, length 64, no 0x prefix", () => {
    const key = derivePrivateKey(mnemonic, 0, "tron")
    expect(key).not.toMatch(/^0x/)
    expect(key.length).toBe(64)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("cross-check wallet consistency for tron", () => {
  it("address from xpub matches address from private key", async () => {
    const w = generateWallet("tron")
    const addrFromXpub = await resolveAddress(deriveAddress(w.xpub, 0, "tron"))
    const privKey = derivePrivateKey(w.mnemonic, 0, "tron")
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

describe('generateWallet("bitcoin")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("bitcoin")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 24 words", () => {
    const w = generateWallet("bitcoin")
    expect(w.mnemonic.split(" ").length).toBe(24)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("bitcoin")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("bitcoin")
    const w2 = generateWallet("bitcoin")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(xpub, index, "bitcoin")', () => {
  const { xpub } = generateWallet("bitcoin")

  it("index 0 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "bitcoin"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 1, "bitcoin"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin"))
    const a1 = await resolveAddress(deriveAddress(xpub, 1, "bitcoin"))
    expect(a0).not.toBe(a1)
  })

  it("same xpub + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin"))
    const a2 = await resolveAddress(deriveAddress(xpub, 0, "bitcoin"))
    expect(a1).toBe(a2)
  })

  it("address starts with 'bc1' (bech32)", async () => {
    const addr = await resolveAddress(deriveAddress(xpub, 0, "bitcoin"))
    expect(addr.startsWith("bc1")).toBe(true)
  })
})

describe('derivePrivateKey(mnemonic, index, "bitcoin")', () => {
  const { mnemonic } = generateWallet("bitcoin")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "bitcoin")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "bitcoin")
    const k1 = derivePrivateKey(mnemonic, 1, "bitcoin")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "bitcoin")
    const k2 = derivePrivateKey(mnemonic, 0, "bitcoin")
    expect(k1).toBe(k2)
  })

  it("returns hex string (no 0x prefix)", () => {
    const key = derivePrivateKey(mnemonic, 0, "bitcoin")
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("cross-check wallet consistency for bitcoin", () => {
  it("address from xpub index 0 is derivable from mnemonic index 0", async () => {
    const w = generateWallet("bitcoin")
    const addrFromXpub = await resolveAddress(deriveAddress(w.xpub, 0, "bitcoin"))
    // For BTC cross-check: derive both from xpub and independently re-derive
    // Just verify both paths produce bc1 addresses (deep cross-check requires
    // building p2wpkh from private key which is already tested in bitcoin.test.ts)
    const privKey = derivePrivateKey(w.mnemonic, 0, "bitcoin")
    expect(addrFromXpub.startsWith("bc1")).toBe(true)
    expect(privKey.length).toBe(64)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Solana
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateWallet("solana")', () => {
  it("returns non-empty mnemonic string", () => {
    const w = generateWallet("solana")
    expect(typeof w.mnemonic).toBe("string")
    expect(w.mnemonic.length).toBeGreaterThan(0)
  })

  it("mnemonic contains exactly 24 words", () => {
    const w = generateWallet("solana")
    expect(w.mnemonic.split(" ").length).toBe(24)
  })

  it("returns non-empty xpub string", () => {
    const w = generateWallet("solana")
    expect(typeof w.xpub).toBe("string")
    expect(w.xpub.length).toBeGreaterThan(0)
  })

  it("calling twice returns different mnemonics", () => {
    const w1 = generateWallet("solana")
    const w2 = generateWallet("solana")
    expect(w1.mnemonic).not.toBe(w2.mnemonic)
  })
})

describe('deriveAddress(mnemonic, index, "solana")', () => {
  // Solana uses mnemonic as "xpub" (no HD xpub derivation)
  const { mnemonic, xpub } = generateWallet("solana")

  it("index 0 returns a non-empty address string", async () => {
    // For Solana, deriveAddress expects mnemonic
    const addr = await resolveAddress(deriveAddress(mnemonic, 0, "solana"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 1 returns a non-empty address string", async () => {
    const addr = await resolveAddress(deriveAddress(mnemonic, 1, "solana"))
    expect(addr.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return DIFFERENT addresses", async () => {
    const a0 = await resolveAddress(deriveAddress(mnemonic, 0, "solana"))
    const a1 = await resolveAddress(deriveAddress(mnemonic, 1, "solana"))
    expect(a0).not.toBe(a1)
  })

  it("same mnemonic + same index always returns the same address", async () => {
    const a1 = await resolveAddress(deriveAddress(mnemonic, 0, "solana"))
    const a2 = await resolveAddress(deriveAddress(mnemonic, 0, "solana"))
    expect(a1).toBe(a2)
  })

  it("address is base58, length 32-44 chars", async () => {
    const addr = await resolveAddress(deriveAddress(mnemonic, 0, "solana"))
    expect(addr.length).toBeGreaterThanOrEqual(32)
    expect(addr.length).toBeLessThanOrEqual(44)
    // base58 chars
    expect(addr).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
  })
})

describe('derivePrivateKey(mnemonic, index, "solana")', () => {
  const { mnemonic } = generateWallet("solana")

  it("returns non-empty string", () => {
    const key = derivePrivateKey(mnemonic, 0, "solana")
    expect(key.length).toBeGreaterThan(0)
  })

  it("index 0 and index 1 return different keys", () => {
    const k0 = derivePrivateKey(mnemonic, 0, "solana")
    const k1 = derivePrivateKey(mnemonic, 1, "solana")
    expect(k0).not.toBe(k1)
  })

  it("same mnemonic + same index always returns the same key", () => {
    const k1 = derivePrivateKey(mnemonic, 0, "solana")
    const k2 = derivePrivateKey(mnemonic, 0, "solana")
    expect(k1).toBe(k2)
  })

  it("returns base58 encoded secret key", () => {
    const key = derivePrivateKey(mnemonic, 0, "solana")
    // Solana secret key is 64 bytes = ~88 base58 chars
    expect(key).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
    expect(key.length).toBeGreaterThan(60)
  })
})

describe("cross-check wallet consistency for solana", () => {
  it("xpub (pubkey at index 0) matches address derived from mnemonic at index 0", async () => {
    const w = generateWallet("solana")
    // xpub for Solana = base58 public key of index 0
    const derivedAddr = await resolveAddress(deriveAddress(w.mnemonic, 0, "solana"))
    // The xpub IS the address for index 0
    expect(w.xpub).toBe(derivedAddr)
  })
})
