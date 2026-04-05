/**
 * lib/crypto.ts — AES-256-GCM encryption for mnemonic phrases (surprise field)
 */

import crypto from "crypto"

const ALGO = "aes-256-gcm" as const
const IV_LENGTH = 12

function getKey(): crypto.KeyObject {
  const secret = process.env.SECRET
  if (!secret) {
    throw new Error("SECRET env var is required for mnemonic encryption")
  }

  const roundsEnv = process.env.SALT_ROUNDS
  const rounds = roundsEnv ? Number(roundsEnv) : 10
  if (!Number.isFinite(rounds) || rounds < 1) {
    throw new Error("SALT_ROUNDS must be a positive number")
  }

  const salt = "xswapo-mnemonic-salt"
  const keyBytes = crypto.pbkdf2Sync(secret, salt, rounds, 32, "sha256")
  return crypto.createSecretKey(keyBytes)
}

export function encryptMnemonic(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString("base64"), encrypted.toString("base64"), authTag.toString("base64")].join(":")
}

export function decryptMnemonic(payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(":")
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("Invalid encrypted mnemonic payload")
  }

  const key = getKey()
  const iv = Buffer.from(ivB64, "base64")
  const data = Buffer.from(dataB64, "base64")
  const authTag = Buffer.from(tagB64, "base64")

  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString("utf8")
}
