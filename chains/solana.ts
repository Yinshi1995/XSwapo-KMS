/**
 * chains/solana.ts
 * Solana — своя экосистема, не EVM, не UTXO.
 *
 * Особенности:
 *  - Ed25519 ключи (не secp256k1 как у EVM/BTC!)
 *  - Адреса = base58 публичный ключ (~44 символа)
 *  - Деривация: BIP-44 m/44'/501'/0'/0' (ED25519 SLIP-0010)
 *  - Нет xpub — каждый адрес деривируется из seed напрямую
 *  - Токены (USDT, USDC) = SPL Token Program
 *  - Fee = lamports (1 SOL = 1_000_000_000 lamports)
 *  - RPC: solana-mainnet.gateway.tatum.io (стандартный Solana JSON-RPC)
 *
 * bun add @solana/web3.js @solana/spl-token bip39 ed25519-hd-key bs58
 */

import {
  Connection, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, Keypair, LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js"
import {
  getAssociatedTokenAddress, createTransferInstruction,
  getOrCreateAssociatedTokenAccount, getMint,
} from "@solana/spl-token"
import { generateMnemonic, mnemonicToSeedSync } from "bip39"
import { derivePath } from "ed25519-hd-key"
import bs58 from "bs58"
import type { ChainWallet, DerivedAddress, TxResult, Balance } from "../types"

import { TATUM_API_KEY, gatewayUrl } from "../gateway"

const SOL_RPC = gatewayUrl("solana-mainnet")
const SOL_DEVNET_RPC = gatewayUrl("solana-devnet")

// BIP-44 для Solana: coin type 501, ED25519 SLIP-0010
const SOL_DERIVATION_PATH = (index: number) => `m/44'/501'/${index}'/0'`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConnection(isTestnet = false): Connection {
  const url = isTestnet ? SOL_DEVNET_RPC : SOL_RPC
  return new Connection(url, {
    httpHeaders: { "x-api-key": TATUM_API_KEY },
    commitment: "confirmed",
  })
}

// ─── 1. Генерация кошелька ────────────────────────────────────────────────────
// Solana не использует xpub — возвращаем мнемоник + base58 master public key
// Каждый index деривируется отдельно через derivePath
export function solGenerateWallet(): ChainWallet & { masterAddress: string } {
  const mnemonic = generateMnemonic(256)
  const seed = mnemonicToSeedSync(mnemonic)
  // Деривируем index=0 как "главный" адрес для хранения в БД
  const { key } = derivePath(SOL_DERIVATION_PATH(0), seed.toString("hex"))
  const keypair = Keypair.fromSeed(Uint8Array.from(key))
  return {
    mnemonic,
    xpub: bs58.encode(keypair.publicKey.toBytes()), // base58 публичный ключ index=0
    masterAddress: keypair.publicKey.toBase58(),
  }
}

// ─── 2. Деривация адреса ─────────────────────────────────────────────────────
// У Solana нет xpub деривации! Каждый индекс деривируется из seed
// xpub в нашем контексте = мнемоник (храним зашифрованным)
// Но для совместимости с БД — принимаем мнемоник как xpub (после decrypt)
export function solDeriveAddress(mnemonic: string, index: number): DerivedAddress {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(SOL_DERIVATION_PATH(index), seed.toString("hex"))
  const keypair = Keypair.fromSeed(Uint8Array.from(key))
  return { address: keypair.publicKey.toBase58() }
}

// ─── 3. Деривация keypair (нужен для подписи) ────────────────────────────────
export function solDeriveKeypair(mnemonic: string, index: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic)
  const { key } = derivePath(SOL_DERIVATION_PATH(index), seed.toString("hex"))
  return Keypair.fromSeed(Uint8Array.from(key))
}

// Приватный ключ как base58 (для совместимости с интерфейсом)
export function solDerivePrivateKey(mnemonic: string, index: number): string {
  const kp = solDeriveKeypair(mnemonic, index)
  return bs58.encode(kp.secretKey)
}

// ─── 4. Баланс SOL ────────────────────────────────────────────────────────────
export async function solGetBalance(address: string, isTestnet = false): Promise<Balance> {
  const conn = getConnection(isTestnet)
  const lamports = await conn.getBalance(new PublicKey(address))
  return {
    balance: (lamports / LAMPORTS_PER_SOL).toString(),
    raw: lamports.toString(),
  }
}

// ─── 5. Баланс SPL токена (USDT/USDC/etc) ────────────────────────────────────
export async function solGetTokenBalance(
  walletAddress: string,
  mintAddress: string,
  isTestnet = false
): Promise<Balance> {
  const conn = getConnection(isTestnet)
  const wallet = new PublicKey(walletAddress)
  const mint = new PublicKey(mintAddress)

  const tokenAccount = await getAssociatedTokenAddress(mint, wallet)

  try {
    const info = await conn.getTokenAccountBalance(tokenAccount)
    return {
      balance: info.value.uiAmountString ?? "0",
      raw: info.value.amount,
    }
  } catch {
    // Аккаунт не существует — баланс 0
    return { balance: "0", raw: "0" }
  }
}

// ─── 6. Оценка fee ────────────────────────────────────────────────────────────
export async function solEstimateFee(isTestnet = false): Promise<{
  feePerSignature: number  // lamports
  feeSol: string
}> {
  const conn = getConnection(isTestnet)
  const { feeCalculator } = await conn.getRecentBlockhash()
  const feePerSig = feeCalculator?.lamportsPerSignature ?? 5000
  return {
    feePerSignature: feePerSig,
    feeSol: (feePerSig / LAMPORTS_PER_SOL).toFixed(9),
  }
}

// ─── 7. Отправка SOL (native) ─────────────────────────────────────────────────
export async function solSendNative(params: {
  mnemonic: string
  fromIndex: number
  toAddress: string
  amountSol: string
  isTestnet?: boolean
}): Promise<TxResult> {
  const { mnemonic, fromIndex, toAddress, amountSol, isTestnet = false } = params
  const conn = getConnection(isTestnet)
  const fromKeypair = solDeriveKeypair(mnemonic, fromIndex)
  const lamports = Math.round(Number(amountSol) * LAMPORTS_PER_SOL)

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports,
    })
  )

  const txId = await sendAndConfirmTransaction(conn, tx, [fromKeypair])
  return { txId }
}

// ─── 8. Отправка SPL токена (USDT/USDC) ──────────────────────────────────────
export async function solSendToken(params: {
  mnemonic: string
  fromIndex: number
  toAddress: string
  mintAddress: string    // адрес контракта токена
  amount: string         // в читаемых единицах
  isTestnet?: boolean
}): Promise<TxResult> {
  const { mnemonic, fromIndex, toAddress, mintAddress, amount, isTestnet = false } = params
  const conn = getConnection(isTestnet)
  const fromKeypair = solDeriveKeypair(mnemonic, fromIndex)
  const mint = new PublicKey(mintAddress)
  const toPublicKey = new PublicKey(toAddress)

  // Получаем decimals токена
  const mintInfo = await getMint(conn, mint)
  const decimals = mintInfo.decimals
  const amountRaw = BigInt(Math.round(Number(amount) * Math.pow(10, decimals)))

  // Associated Token Account отправителя
  const fromAta = await getAssociatedTokenAddress(mint, fromKeypair.publicKey)

  // ATA получателя (создаём если нет — это стандарт в Solana)
  const toAta = await getOrCreateAssociatedTokenAccount(
    conn, fromKeypair, mint, toPublicKey
  )

  // Priority fee для надёжности
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
    createTransferInstruction(fromAta, toAta.address, fromKeypair.publicKey, amountRaw)
  )

  const txId = await sendAndConfirmTransaction(conn, tx, [fromKeypair])
  return { txId }
}

// ─── 9. Статус транзакции ─────────────────────────────────────────────────────
export async function solGetTxStatus(signature: string, isTestnet = false) {
  const conn = getConnection(isTestnet)
  const status = await conn.getSignatureStatus(signature)
  const val = status.value
  if (!val) return { status: "pending" as const, slot: null }
  return {
    status: val.err ? "failed" as const : "confirmed" as const,
    slot: val.slot,
    confirmations: val.confirmations ?? 0,
  }
}
