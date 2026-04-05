/**
 * tests/orderId.test.ts — Unit tests for human-readable order ID generator
 */

import { describe, it, expect } from "bun:test"
import { generateOrderId } from "../lib/orderId"

describe("generateOrderId", () => {
  it("returns word-word format", () => {
    const id = generateOrderId()
    expect(id).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it("first word is 4-6 chars, second word is 5-7 chars", () => {
    // Run multiple times to cover randomness
    for (let i = 0; i < 50; i++) {
      const id = generateOrderId()
      const [w1, w2] = id.split("-")
      expect(w1.length).toBeGreaterThanOrEqual(4)
      expect(w1.length).toBeLessThanOrEqual(6)
      expect(w2.length).toBeGreaterThanOrEqual(5)
      expect(w2.length).toBeLessThanOrEqual(7)
    }
  })

  it("uses only consonants and vowels (no digits or special chars)", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateOrderId()
      expect(id).toMatch(/^[a-z]+-[a-z]+$/)
    }
  })

  it("generates unique IDs (low collision probability)", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 500; i++) {
      ids.add(generateOrderId())
    }
    // With the given character set and lengths, collisions in 500 IDs should be extremely rare
    expect(ids.size).toBeGreaterThanOrEqual(490)
  })
})
