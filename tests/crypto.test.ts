/**
 * tests/crypto.test.ts — Unit tests for AES-256-GCM mnemonic encryption
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { encryptMnemonic, decryptMnemonic } from "../lib/crypto"

// Ensure env vars are set for encryption
beforeAll(() => {
  process.env.SECRET = "test-secret-for-unit-tests"
  process.env.SALT_ROUNDS = "4"
})

afterAll(() => {
  delete process.env.SECRET
  delete process.env.SALT_ROUNDS
})

describe("encryptMnemonic / decryptMnemonic", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

  it("encrypts and decrypts back to original", () => {
    const encrypted = encryptMnemonic(mnemonic)
    const decrypted = decryptMnemonic(encrypted)
    expect(decrypted).toBe(mnemonic)
  })

  it("returns iv:data:tag format (3 base64 segments)", () => {
    const encrypted = encryptMnemonic(mnemonic)
    const parts = encrypted.split(":")
    expect(parts.length).toBe(3)
    // Each part should be valid base64
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(() => Buffer.from(part, "base64")).not.toThrow()
    }
  })

  it("produces different ciphertexts for the same input (random IV)", () => {
    const a = encryptMnemonic(mnemonic)
    const b = encryptMnemonic(mnemonic)
    expect(a).not.toBe(b)
    // But both decrypt to the same value
    expect(decryptMnemonic(a)).toBe(mnemonic)
    expect(decryptMnemonic(b)).toBe(mnemonic)
  })

  it("handles short strings", () => {
    const encrypted = encryptMnemonic("a")
    expect(decryptMnemonic(encrypted)).toBe("a")
  })

  it("handles unicode content", () => {
    const text = "こんにちは世界 🌍"
    const encrypted = encryptMnemonic(text)
    expect(decryptMnemonic(encrypted)).toBe(text)
  })

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptMnemonic(mnemonic)
    const parts = encrypted.split(":")
    // Corrupt the data portion
    parts[1] = Buffer.from("corrupted-data").toString("base64")
    expect(() => decryptMnemonic(parts.join(":"))).toThrow()
  })

  it("throws on invalid payload format", () => {
    expect(() => decryptMnemonic("not-valid")).toThrow("Invalid encrypted mnemonic payload")
    expect(() => decryptMnemonic("a:b")).toThrow("Invalid encrypted mnemonic payload")
  })
})

describe("encryptMnemonic without SECRET", () => {
  it("throws when SECRET is missing", () => {
    const saved = process.env.SECRET
    delete process.env.SECRET
    try {
      expect(() => encryptMnemonic("test")).toThrow("SECRET env var is required")
    } finally {
      process.env.SECRET = saved
    }
  })
})
