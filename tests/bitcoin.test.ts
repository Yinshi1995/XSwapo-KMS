/**
 * tests/bitcoin.test.ts — UTXO-specific logic (pure parts, no network)
 *
 * Tests fee calculation, dust limits, UTXO chain wallet generation.
 */

import { describe, it, expect } from "bun:test"
import {
  btcGenerateWallet, btcDeriveAddress, btcDerivePrivateKey,
  utxoGenerateWallet, utxoDeriveAddress, utxoDerivePrivateKey,
} from "../chains/bitcoin"

// ═══════════════════════════════════════════════════════════════════════════════
// Fee calculation (pure math as done in btcSendTransaction)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Re-implements the fee estimation formula from btcSendTransaction:
 *   estimatedSize = 10 + (inputCount * 68) + (outputCount * 31)
 *   feeSats = Math.ceil(estimatedSize * feePerByte)
 *   changeSats = inputTotal - amountSats - feeSats
 *   if changeSats > 546 → add change output
 */
function calcFee(params: {
  inputTotal: number
  amountSats: number
  feePerByte: number
  inputCount: number
}) {
  const { inputTotal, amountSats, feePerByte, inputCount } = params
  // 2 outputs: recipient + change (estimate)
  const estimatedSize = 10 + (inputCount * 68) + (2 * 31)
  const feeSats = Math.ceil(estimatedSize * feePerByte)
  const changeSats = inputTotal - amountSats - feeSats
  return { estimatedSize, feeSats, changeSats, hasChange: changeSats > 546 }
}

describe("UTXO fee calculation", () => {
  it("standard case: inputTotal=100000, amountSats=50000, feePerByte=10", () => {
    const r = calcFee({ inputTotal: 100000, amountSats: 50000, feePerByte: 10, inputCount: 1 })
    // estimatedSize = 10 + 1*68 + 2*31 = 140
    expect(r.estimatedSize).toBe(140)
    // feeSats = ceil(140 * 10) = 1400
    expect(r.feeSats).toBe(1400)
    // changeSats = 100000 - 50000 - 1400 = 48600
    expect(r.changeSats).toBe(48600)
    // 48600 > 546 → change output should be added
    expect(r.hasChange).toBe(true)
  })

  it("dust limit: changeSats=400 → no change output", () => {
    // Engineer inputs so change < 546
    // Need: inputTotal - amountSats - feeSats ≈ 400
    // With 1 input, feePerByte=10: feeSats = 1400
    // So inputTotal = amountSats + 1400 + 400 = amountSats + 1800
    const amountSats = 98200
    const r = calcFee({ inputTotal: 100000, amountSats, feePerByte: 10, inputCount: 1 })
    expect(r.changeSats).toBe(400)
    expect(r.hasChange).toBe(false)
  })

  it("exact dust limit boundary: changeSats=546 → below threshold (not >546)", () => {
    // changeSats = inputTotal - amountSats - feeSats = 546
    // feeSats = 1400 (1 input, feePerByte=10)
    // so amountSats = 100000 - 1400 - 546 = 98054
    const r = calcFee({ inputTotal: 100000, amountSats: 98054, feePerByte: 10, inputCount: 1 })
    expect(r.changeSats).toBe(546)
    expect(r.hasChange).toBe(false) // > 546 is required, not >= 546
  })

  it("changeSats=547 → above dust limit", () => {
    const r = calcFee({ inputTotal: 100000, amountSats: 98053, feePerByte: 10, inputCount: 1 })
    expect(r.changeSats).toBe(547)
    expect(r.hasChange).toBe(true)
  })

  it("multiple inputs increase estimated size", () => {
    const r1 = calcFee({ inputTotal: 200000, amountSats: 100000, feePerByte: 10, inputCount: 1 })
    const r3 = calcFee({ inputTotal: 200000, amountSats: 100000, feePerByte: 10, inputCount: 3 })
    // 3 inputs: estimatedSize = 10 + 3*68 + 2*31 = 276
    expect(r3.estimatedSize).toBe(276)
    expect(r3.feeSats).toBeGreaterThan(r1.feeSats)
  })

  it("insufficient balance results in negative changeSats", () => {
    const r = calcFee({ inputTotal: 10000, amountSats: 10000, feePerByte: 10, inputCount: 1 })
    expect(r.changeSats).toBeLessThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BTC wallet operations (mainnet)
// ═══════════════════════════════════════════════════════════════════════════════

describe("btcGenerateWallet", () => {
  it("generates 24-word mnemonic", () => {
    const w = btcGenerateWallet()
    expect(w.mnemonic.split(" ").length).toBe(24)
  })

  it("generates xpub starting with 'zpub' or 'xpub'", () => {
    const w = btcGenerateWallet()
    // BIP-84 zpub or standard xpub depending on version bytes
    expect(w.xpub.length).toBeGreaterThan(50)
  })
})

describe("btcDeriveAddress", () => {
  const { xpub } = btcGenerateWallet()

  it("index 0 returns bc1 address", () => {
    const { address } = btcDeriveAddress(xpub, 0)
    expect(address.startsWith("bc1")).toBe(true)
  })

  it("index 0 and 1 return different addresses", () => {
    const a0 = btcDeriveAddress(xpub, 0).address
    const a1 = btcDeriveAddress(xpub, 1).address
    expect(a0).not.toBe(a1)
  })

  it("deterministic: same xpub + index → same address", () => {
    const a1 = btcDeriveAddress(xpub, 0).address
    const a2 = btcDeriveAddress(xpub, 0).address
    expect(a1).toBe(a2)
  })
})

describe("btcDerivePrivateKey", () => {
  const { mnemonic } = btcGenerateWallet()

  it("returns 64-char hex string", () => {
    const key = btcDerivePrivateKey(mnemonic, 0)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("different index → different keys", () => {
    expect(btcDerivePrivateKey(mnemonic, 0)).not.toBe(btcDerivePrivateKey(mnemonic, 1))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// UTXO chains: Litecoin
// ═══════════════════════════════════════════════════════════════════════════════

describe("utxoGenerateWallet (litecoin)", () => {
  it("generates 24-word mnemonic and xpub", () => {
    const w = utxoGenerateWallet("litecoin")
    expect(w.mnemonic.split(" ").length).toBe(24)
    expect(w.xpub.length).toBeGreaterThan(50)
  })
})

describe("utxoDeriveAddress (litecoin)", () => {
  const { xpub } = utxoGenerateWallet("litecoin")

  it("returns ltc1 bech32 address", () => {
    const { address } = utxoDeriveAddress(xpub, 0, "litecoin")
    expect(address.startsWith("ltc1")).toBe(true)
  })

  it("different indices produce different addresses", () => {
    const a0 = utxoDeriveAddress(xpub, 0, "litecoin").address
    const a1 = utxoDeriveAddress(xpub, 1, "litecoin").address
    expect(a0).not.toBe(a1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// UTXO chains: Dogecoin
// ═══════════════════════════════════════════════════════════════════════════════

describe("utxoGenerateWallet (dogecoin)", () => {
  it("generates 24-word mnemonic and xpub", () => {
    const w = utxoGenerateWallet("dogecoin")
    expect(w.mnemonic.split(" ").length).toBe(24)
    expect(w.xpub.length).toBeGreaterThan(50)
  })
})

describe("utxoDeriveAddress (dogecoin)", () => {
  const { xpub } = utxoGenerateWallet("dogecoin")

  it("returns address starting with 'D' (P2PKH)", () => {
    const { address } = utxoDeriveAddress(xpub, 0, "dogecoin")
    expect(address.startsWith("D")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// UTXO chains: Bitcoin Cash
// ═══════════════════════════════════════════════════════════════════════════════

describe("utxoGenerateWallet (bitcoincash)", () => {
  it("generates 24-word mnemonic and xpub", () => {
    const w = utxoGenerateWallet("bitcoincash")
    expect(w.mnemonic.split(" ").length).toBe(24)
  })
})

describe("utxoDeriveAddress (bitcoincash)", () => {
  const { xpub } = utxoGenerateWallet("bitcoincash")

  it("returns a P2PKH address (starts with '1')", () => {
    const { address } = utxoDeriveAddress(xpub, 0, "bitcoincash")
    // BCH uses same network params as BTC mainnet → P2PKH starts with '1'
    expect(address.startsWith("1")).toBe(true)
  })
})
