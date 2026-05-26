/**
 * tx-deposit-poller.ts — transaction-based deposit detection for Group A/B chains.
 *
 * Instead of comparing balance snapshots (diff approach), this poller scans
 * recent blocks / transaction history per chain and matches incoming transfers
 * against active deposit addresses.
 *
 * Advantages over balance-diff:
 *   - Provides exact txHash for every deposit
 *   - Correctly handles multiple deposits in one poll interval
 *   - Not confused by concurrent outgoing sweeps
 *
 * Supported families (TX_POLLING_FAMILIES):
 *   Group A: evm, bitcoin, litecoin, dogecoin, bitcoincash, tron, solana, cosmos, sui
 *   Group B: xrp, stellar, ton, vechain
 *
 * Group C (balance-based, handled by deposit-poller.ts):
 *   cardano, polkadot, multiversx, near, algorand, tezos, exchange
 *
 * Env vars:
 *   TX_POLL_INTERVAL_MS          — poll interval (default 30_000)
 *   TX_POLL_MAX_BLOCKS_PER_CYCLE — max blocks to scan per chain per cycle (default 50)
 */

import { createHash } from "crypto"
import { formatEther, formatUnits } from "ethers"
import bs58 from "bs58"

import db, { DepositSource, ExchangeRequestStatus } from "../db/index"
import { TATUM_API_KEY, gatewayUrl, tatumHeaders } from "../gateway"
import { getFamily, normalizeChain } from "../index"
import { evmRpcUrl } from "../chains/evm"
import { getCoinNetworkMapping, sameAddress } from "./helpers"
import { processPolledDeposit } from "./deposit-process"
import { exchangeRequestInclude, type ExchangeRequestContext } from "./types"

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = Number(process.env.TX_POLL_INTERVAL_MS ?? 30_000)
const MAX_BLOCKS_PER_CYCLE = Number(process.env.TX_POLL_MAX_BLOCKS_PER_CYCLE ?? 50)
const POLL_STATUSES = [ExchangeRequestStatus.CREATED, ExchangeRequestStatus.WAITING_DEPOSIT]

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const TRON_TRANSFER_SELECTOR = "a9059cbb" // keccak4("transfer(address,uint256)")

/** Chain families handled by this poller. Everything else stays on balance-diff. */
export const TX_POLLING_FAMILIES = new Set([
  "evm",
  "bitcoin", "litecoin", "dogecoin", "bitcoincash",
  "tron",
  "solana",
  "cosmos",
  "sui",
  "xrp",
  "stellar",
  "ton",
  "vechain",
])

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanTarget {
  request: ExchangeRequestContext
  depositAddress: string
  contractAddress: string | null
  decimals: number
}

interface FoundDeposit {
  request: ExchangeRequestContext
  amount: string
  txHash: string
  fromAddress: string | null
}

// ─── Cursors ──────────────────────────────────────────────────────────────────
//
// Keys:
//   Block-based (EVM, UTXO, Tron, VeChain): chain slug   → { blockNumber }
//   Signature   (Solana):                   "sol:{addr}" → { sig }
//   Ledger      (XRP):                      "xrp:{addr}" → { ledgerIndex }
//   Paging      (Stellar):                  "xlm:{addr}" → { pagingToken }
//   LT          (TON):                      "ton:{addr}" → { lt, hash }
//   Offset      (Cosmos):                   "cosmos:{addr}" → { offset }
//   Sui cursor  (Sui):                      "sui:{addr}" → { cursor }

type BlockCursor = { kind: "block"; blockNumber: number }
type SigCursor   = { kind: "sig";   sig: string | null }
type LedgerCursor = { kind: "ledger"; ledgerIndex: number }
type PageCursor  = { kind: "page";  pagingToken: string | null }
type LtCursor    = { kind: "lt";    lt: string | null; hash: string | null }
type OffsetCursor = { kind: "offset"; offset: number }
type SuiCursor   = { kind: "sui";  cursor: string | null }

type AnyCursor =
  | BlockCursor | SigCursor | LedgerCursor | PageCursor | LtCursor | OffsetCursor | SuiCursor

const cursors = new Map<string, AnyCursor>()

function getBlockCursor(key: string): BlockCursor | null {
  const c = cursors.get(key)
  return c?.kind === "block" ? c : null
}

// ─── Tron address helpers ─────────────────────────────────────────────────────

/** Convert Tron hex address (with or without 41 prefix) to Base58Check format (T...) */
function tronHexToBase58(hexAddr: string): string {
  let hex = hexAddr.replace(/^0x/, "")
  if (hex.length === 40) hex = "41" + hex
  const payload = Buffer.from(hex, "hex")
  const h1 = createHash("sha256").update(payload).digest()
  const h2 = createHash("sha256").update(h1).digest()
  return bs58.encode(Buffer.concat([payload, h2.slice(0, 4)]))
}

/** Normalize Tron address to lowercase hex without 0x (for comparison) */
function normalizeTronAddr(addr: string): string {
  if (addr.startsWith("T") || addr.startsWith("t")) {
    // Base58: decode to get the raw bytes
    try {
      const bytes = Buffer.from(bs58.decode(addr))
      return bytes.slice(0, 21).toString("hex").toLowerCase()
    } catch {
      return addr.toLowerCase()
    }
  }
  let hex = addr.replace(/^0x/, "")
  if (hex.length === 40) hex = "41" + hex
  return hex.toLowerCase()
}

// ─── EVM scanner ──────────────────────────────────────────────────────────────

async function evmRpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const url = evmRpcUrl(normalizeChain(chain))
  const res = await fetch(url, {
    method: "POST",
    headers: tatumHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`EVM[${chain}] RPC ${method} HTTP ${res.status}`)
  const data = (await res.json()) as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`EVM[${chain}] RPC ${method}: ${data.error.message}`)
  return data.result as T
}

async function scanEvm(
  chain: string,
  targets: ScanTarget[],
  cursor: BlockCursor,
): Promise<{ deposits: FoundDeposit[]; nextCursor: BlockCursor }> {
  const latestHex = await evmRpc<string>(chain, "eth_blockNumber", [])
  const latestBlock = Number(latestHex)

  if (latestBlock <= cursor.blockNumber) {
    return { deposits: [], nextCursor: cursor }
  }

  const fromBlock = cursor.blockNumber + 1
  const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_CYCLE - 1, latestBlock)
  const nextCursor: BlockCursor = { kind: "block", blockNumber: toBlock }
  const deposits: FoundDeposit[] = []

  const nativeTargets = targets.filter(t => !t.contractAddress)
  const tokenTargets  = targets.filter(t => !!t.contractAddress)

  // Native transfers: scan each block (no log-based alternative for ETH/BNB/etc.)
  if (nativeTargets.length > 0) {
    const addrMap = new Map(nativeTargets.map(t => [t.depositAddress.toLowerCase(), t]))

    for (let num = fromBlock; num <= toBlock; num++) {
      const block = await evmRpc<{
        transactions: Array<{ hash: string; from: string; to: string | null; value: string }>
      } | null>(chain, "eth_getBlockByNumber", [`0x${num.toString(16)}`, true])

      if (!block) continue
      for (const tx of block.transactions) {
        if (!tx.to) continue
        const toLower = tx.to.toLowerCase()
        if (!addrMap.has(toLower)) continue
        if (tx.value === "0x0" || tx.value === "0x00" || tx.value === "0x") continue

        const target = addrMap.get(toLower)!
        deposits.push({
          request: target.request,
          amount: formatEther(BigInt(tx.value)),
          txHash: tx.hash,
          fromAddress: tx.from,
        })
      }
    }
  }

  // ERC-20 transfers: one getLogs call covers the entire block range
  if (tokenTargets.length > 0) {
    const logs = await evmRpc<Array<{
      address: string
      topics: string[]
      data: string
      transactionHash: string
      removed?: boolean
    }>>(chain, "eth_getLogs", [{
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [ERC20_TRANSFER_TOPIC],
    }])

    for (const log of logs) {
      if (log.removed) continue
      if (log.topics.length < 3) continue

      // topic[2] = recipient, padded to 32 bytes
      const toAddr = "0x" + log.topics[2].slice(-40)

      for (const target of tokenTargets) {
        if (
          target.contractAddress &&
          log.address.toLowerCase() === target.contractAddress.toLowerCase() &&
          toAddr.toLowerCase() === target.depositAddress.toLowerCase()
        ) {
          deposits.push({
            request: target.request,
            amount: formatUnits(BigInt(log.data), target.decimals),
            txHash: log.transactionHash,
            fromAddress: "0x" + log.topics[1].slice(-40),
          })
          break
        }
      }
    }
  }

  return { deposits, nextCursor }
}

// ─── UTXO scanner (Bitcoin, LTC, DOGE, BCH) ──────────────────────────────────

function getUtxoRpcUrl(chain: string): string {
  const lower = chain.toLowerCase()
  if (lower === "bitcoin" || lower === "btc") return gatewayUrl("bitcoin-mainnet")
  if (lower === "litecoin" || lower === "ltc") return gatewayUrl("litecoin-mainnet")
  if (lower === "dogecoin" || lower === "doge") return gatewayUrl("dogecoin-mainnet")
  if (lower === "bitcoincash" || lower === "bch") return gatewayUrl("bch-mainnet")
  return gatewayUrl(`${lower}-mainnet`)
}

async function utxoRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const data = (await res.json()) as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`UTXO RPC ${method}: ${data.error.message}`)
  return data.result as T
}

interface UtxoVout {
  value: number
  scriptPubKey: { address?: string; addresses?: string[] }
}
interface UtxoTx {
  txid: string
  vin: Array<{ coinbase?: string }>
  vout: UtxoVout[]
}

async function scanUtxo(
  chain: string,
  targets: ScanTarget[],
  cursor: BlockCursor,
): Promise<{ deposits: FoundDeposit[]; nextCursor: BlockCursor }> {
  const rpcUrl = getUtxoRpcUrl(chain)
  const currentHeight = await utxoRpc<number>(rpcUrl, "getblockcount", [])

  if (currentHeight <= cursor.blockNumber) {
    return { deposits: [], nextCursor: cursor }
  }

  const fromHeight = cursor.blockNumber + 1
  const toHeight = Math.min(fromHeight + MAX_BLOCKS_PER_CYCLE - 1, currentHeight)
  const nextCursor: BlockCursor = { kind: "block", blockNumber: toHeight }
  const deposits: FoundDeposit[] = []

  const addrMap = new Map(targets.map(t => [t.depositAddress.toLowerCase(), t]))

  for (let height = fromHeight; height <= toHeight; height++) {
    const hash = await utxoRpc<string>(rpcUrl, "getblockhash", [height])
    const block = await utxoRpc<{ tx: UtxoTx[] }>(rpcUrl, "getblock", [hash, 2])

    for (const tx of block.tx) {
      if (tx.vin[0]?.coinbase) continue // skip coinbase

      for (const vout of tx.vout) {
        const addr = vout.scriptPubKey.address ?? vout.scriptPubKey.addresses?.[0]
        if (!addr) continue
        const addrLower = addr.toLowerCase()
        const target = addrMap.get(addrLower)
        if (!target) continue

        deposits.push({
          request: target.request,
          amount: vout.value.toFixed(8),
          txHash: tx.txid,
          fromAddress: null, // UTXO has multiple inputs
        })
      }
    }
  }

  return { deposits, nextCursor }
}

// ─── Tron scanner ─────────────────────────────────────────────────────────────

const TRON_RPC_URL = gatewayUrl("tron-mainnet")

async function tronPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TRON_RPC_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Tron POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function scanTron(
  targets: ScanTarget[],
  cursor: BlockCursor,
): Promise<{ deposits: FoundDeposit[]; nextCursor: BlockCursor }> {
  const nowBlock = await tronPost<{
    block_header?: { raw_data?: { number?: number } }
  }>("/wallet/getnowblock", {})
  const currentBlock = nowBlock.block_header?.raw_data?.number ?? 0

  if (currentBlock <= cursor.blockNumber) {
    return { deposits: [], nextCursor: cursor }
  }

  const fromBlock = cursor.blockNumber + 1
  const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_CYCLE - 1, currentBlock)
  const nextCursor: BlockCursor = { kind: "block", blockNumber: toBlock }
  const deposits: FoundDeposit[] = []

  const nativeTargets = targets.filter(t => !t.contractAddress)
  const tokenTargets  = targets.filter(t => !!t.contractAddress)

  const blockData = await tronPost<{
    block?: Array<{
      transactions?: Array<{
        txID: string
        raw_data: {
          contract: Array<{
            type: string
            parameter: { value: Record<string, unknown> }
          }>
        }
      }>
    }>
  }>("/wallet/getblockbylimitnext", { startNum: fromBlock, endNum: toBlock + 1 })

  for (const block of blockData.block ?? []) {
    for (const tx of block.transactions ?? []) {
      const contract = tx.raw_data.contract[0]
      if (!contract) continue

      if (contract.type === "TransferContract" && nativeTargets.length > 0) {
        const v = contract.parameter.value as {
          to_address?: string
          owner_address?: string
          amount?: number
        }
        if (!v.to_address || !v.amount) continue

        const toBase58 = tronHexToBase58(v.to_address)
        const target = nativeTargets.find(t => t.depositAddress === toBase58)
        if (target) {
          const fromBase58 = v.owner_address ? tronHexToBase58(v.owner_address) : null
          deposits.push({
            request: target.request,
            amount: (v.amount / 1_000_000).toString(),
            txHash: tx.txID,
            fromAddress: fromBase58,
          })
        }
      }

      if (contract.type === "TriggerSmartContract" && tokenTargets.length > 0) {
        const v = contract.parameter.value as {
          contract_address?: string
          data?: string
          owner_address?: string
        }
        if (!v.contract_address || !v.data) continue
        if (!v.data.startsWith(TRON_TRANSFER_SELECTOR)) continue

        // ABI-decode transfer(address,uint256):
        // 4 bytes selector + 12 zero-padding + 20 bytes recipient + 32 bytes amount
        const data = v.data
        const recipientHex = data.slice(8 + 24, 8 + 64)
        const amountHex    = data.slice(72, 136)

        let toBase58: string
        try {
          toBase58 = tronHexToBase58(recipientHex)
        } catch {
          continue
        }

        const contractBase58 = tronHexToBase58(v.contract_address)

        const target = tokenTargets.find(t =>
          t.contractAddress === contractBase58 && t.depositAddress === toBase58
        )
        if (target) {
          const rawAmt = BigInt("0x" + amountHex)
          const amount = (Number(rawAmt) / Math.pow(10, target.decimals)).toString()
          const fromBase58 = v.owner_address ? tronHexToBase58(v.owner_address) : null
          deposits.push({
            request: target.request,
            amount,
            txHash: tx.txID,
            fromAddress: fromBase58,
          })
        }
      }
    }
  }

  return { deposits, nextCursor }
}

// ─── Solana scanner ───────────────────────────────────────────────────────────

const SOL_RPC_URL = gatewayUrl("solana-mainnet")

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOL_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`Solana RPC ${method} HTTP ${res.status}`)
  const data = (await res.json()) as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`Solana RPC ${method}: ${data.error.message}`)
  return data.result as T
}

async function scanSolana(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    const cursorKey = `sol:${target.depositAddress}`
    const prevSig = (cursors.get(cursorKey) as SigCursor | undefined)?.sig ?? null

    // getSignaturesForAddress returns newest-first; `until` stops at prevSig (exclusive)
    const sigs = await solRpc<Array<{ signature: string; err: unknown }> | null>(
      "getSignaturesForAddress",
      [
        target.depositAddress,
        { limit: 50, ...(prevSig ? { until: prevSig } : {}) },
      ],
    )

    if (!sigs || sigs.length === 0) continue

    // Update cursor to the newest sig (first in array)
    cursors.set(cursorKey, { kind: "sig", sig: sigs[0].signature })

    // Skip on first run — just initialize the cursor
    if (!prevSig) continue

    const successSigs = sigs.filter(s => !s.err).map(s => s.signature)
    if (successSigs.length === 0) continue

    const txs = await solRpc<Array<{
      transaction: {
        signatures: string[]
        message: {
          instructions: Array<{
            program?: string
            parsed?: {
              type: string
              info?: {
                destination?: string
                source?: string
                lamports?: number
                amount?: string
                mint?: string
              }
            }
          }>
        }
      } | null
    } | null>>("getTransactions", [
      successSigs,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ])

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i]
      if (!tx?.transaction) continue
      const txHash = successSigs[i]

      for (const ix of tx.transaction.message.instructions) {
        if (!ix.program || !ix.parsed) continue

        // Native SOL transfer
        if (
          ix.program === "system" &&
          ix.parsed.type === "transfer" &&
          !target.contractAddress &&
          ix.parsed.info?.destination &&
          sameAddress(ix.parsed.info.destination, target.depositAddress) &&
          ix.parsed.info.lamports
        ) {
          deposits.push({
            request: target.request,
            amount: (ix.parsed.info.lamports / 1e9).toString(),
            txHash,
            fromAddress: ix.parsed.info.source ?? null,
          })
        }

        // SPL token transfer
        if (
          ix.program === "spl-token" &&
          (ix.parsed.type === "transfer" || ix.parsed.type === "transferChecked") &&
          target.contractAddress &&
          ix.parsed.info?.destination &&
          sameAddress(ix.parsed.info.destination, target.depositAddress) &&
          ix.parsed.info.amount
        ) {
          const rawAmt = BigInt(ix.parsed.info.amount)
          deposits.push({
            request: target.request,
            amount: (Number(rawAmt) / Math.pow(10, target.decimals)).toString(),
            txHash,
            fromAddress: ix.parsed.info.source ?? null,
          })
        }
      }
    }
  }

  return deposits
}

// ─── XRP scanner ──────────────────────────────────────────────────────────────

const XRP_RPC_URL = gatewayUrl("ripple-mainnet")

async function xrpRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(XRP_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ method, params: [params] }),
  })
  const data = (await res.json()) as { result?: T; error?: string }
  if (data.error) throw new Error(`XRP RPC ${method}: ${data.error}`)
  return data.result as T
}

async function scanXrp(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    const cursorKey = `xrp:${target.depositAddress}`
    const prev = cursors.get(cursorKey) as LedgerCursor | undefined
    const ledgerMin = prev ? prev.ledgerIndex + 1 : -1

    if (!prev) {
      // First run: just get the latest ledger and initialize cursor
      const info = await xrpRpc<{ ledger_current_index?: number }>("ledger_current", {})
      const currentLedger = info.ledger_current_index ?? 0
      cursors.set(cursorKey, { kind: "ledger", ledgerIndex: currentLedger })
      continue
    }

    const result = await xrpRpc<{
      transactions?: Array<{
        meta: { TransactionResult: string }
        tx: {
          hash: string
          TransactionType: string
          Destination?: string
          Amount?: string | { value?: string; currency?: string }
          Account?: string
          ledger_index?: number
        }
        validated?: boolean
      }>
    }>("account_tx", {
      account: target.depositAddress,
      ledger_index_min: ledgerMin,
      ledger_index_max: -1,
      limit: 50,
      forward: true,
    })

    let maxLedger = prev.ledgerIndex

    for (const entry of result.transactions ?? []) {
      if (!entry.validated) continue
      if (entry.meta.TransactionResult !== "tesSUCCESS") continue
      if (entry.tx.TransactionType !== "Payment") continue
      if (!entry.tx.Destination || !sameAddress(entry.tx.Destination, target.depositAddress)) continue

      let amount: string | null = null
      if (!target.contractAddress && typeof entry.tx.Amount === "string") {
        amount = (Number(entry.tx.Amount) / 1_000_000).toString()
      } else if (target.contractAddress && typeof entry.tx.Amount === "object" && entry.tx.Amount?.value) {
        amount = entry.tx.Amount.value
      }
      if (!amount) continue

      if (entry.tx.ledger_index && entry.tx.ledger_index > maxLedger) {
        maxLedger = entry.tx.ledger_index
      }

      deposits.push({
        request: target.request,
        amount,
        txHash: entry.tx.hash,
        fromAddress: entry.tx.Account ?? null,
      })
    }

    cursors.set(cursorKey, { kind: "ledger", ledgerIndex: maxLedger })
  }

  return deposits
}

// ─── Stellar scanner ──────────────────────────────────────────────────────────

const XLM_RPC_URL = gatewayUrl("stellar-mainnet")

async function xlmGet<T>(path: string): Promise<T> {
  const res = await fetch(`${XLM_RPC_URL}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`Stellar GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function scanStellar(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    const cursorKey = `xlm:${target.depositAddress}`
    const prev = cursors.get(cursorKey) as PageCursor | undefined

    if (!prev) {
      // First run: get the latest paging_token and set as cursor
      try {
        const data = await xlmGet<{
          _embedded: { records: Array<{ paging_token: string }> }
        }>(`/accounts/${target.depositAddress}/payments?order=desc&limit=1`)
        const latest = data._embedded.records[0]?.paging_token ?? "0"
        cursors.set(cursorKey, { kind: "page", pagingToken: latest })
      } catch {
        cursors.set(cursorKey, { kind: "page", pagingToken: null })
      }
      continue
    }

    const pagingParam = prev.pagingToken ? `&cursor=${prev.pagingToken}` : ""
    let lastToken = prev.pagingToken

    try {
      const result = await xlmGet<{
        _embedded: {
          records: Array<{
            id: string
            type: string
            paging_token: string
            transaction_successful: boolean
            from?: string
            to?: string
            asset_type?: string
            asset_code?: string
            amount?: string
          }>
        }
      }>(`/accounts/${target.depositAddress}/payments?order=asc&limit=100${pagingParam}`)

      for (const record of result._embedded.records) {
        if (!record.transaction_successful) continue
        if (!record.to || !sameAddress(record.to, target.depositAddress)) continue

        let amount: string | null = null
        if (!target.contractAddress && record.asset_type === "native" && record.amount) {
          amount = record.amount
        } else if (target.contractAddress && record.asset_code && record.amount) {
          // Token: match by asset code embedded in contractAddress ("CODE:ISSUER")
          const [code] = (target.contractAddress ?? "").split(":")
          if (record.asset_code === code) {
            amount = record.amount
          }
        }

        if (!amount) continue

        if (!lastToken || record.paging_token > lastToken) {
          lastToken = record.paging_token
        }

        deposits.push({
          request: target.request,
          amount,
          txHash: record.id,
          fromAddress: record.from ?? null,
        })
      }
    } catch (err) {
      console.warn(`[tx-poller] Stellar scan failed for ${target.depositAddress}:`, err)
    }

    cursors.set(cursorKey, { kind: "page", pagingToken: lastToken })
  }

  return deposits
}

// ─── TON scanner ──────────────────────────────────────────────────────────────

const TON_RPC_URL = gatewayUrl("ton-mainnet")

async function tonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${TON_RPC_URL}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`TON GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function scanTon(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    if (target.contractAddress) continue // TON jettons: future work

    const cursorKey = `ton:${target.depositAddress}`
    const prev = cursors.get(cursorKey) as LtCursor | undefined

    if (!prev) {
      // First run: get the most recent lt to use as cursor
      try {
        const result = await tonGet<{
          ok: boolean
          result: Array<{ transaction_id: { lt: string; hash: string } }>
        }>(`/getTransactions?address=${encodeURIComponent(target.depositAddress)}&limit=1`)
        if (result.ok && result.result.length > 0) {
          const { lt, hash } = result.result[0].transaction_id
          cursors.set(cursorKey, { kind: "lt", lt, hash })
        } else {
          cursors.set(cursorKey, { kind: "lt", lt: null, hash: null })
        }
      } catch {
        cursors.set(cursorKey, { kind: "lt", lt: null, hash: null })
      }
      continue
    }

    const ltParam = prev.lt && prev.hash
      ? `&lt=${prev.lt}&hash=${encodeURIComponent(prev.hash)}`
      : ""

    let lastLt = prev.lt
    let lastHash = prev.hash

    try {
      const result = await tonGet<{
        ok: boolean
        result: Array<{
          transaction_id: { lt: string; hash: string }
          in_msg: {
            source: string
            destination: string
            value: string
          }
        }>
      }>(`/getTransactions?address=${encodeURIComponent(target.depositAddress)}&limit=50${ltParam}`)

      if (!result.ok) continue

      for (const tx of result.result) {
        const inMsg = tx.in_msg
        if (!inMsg.source || !inMsg.destination) continue
        if (!sameAddress(inMsg.destination, target.depositAddress)) continue

        const valueNano = BigInt(inMsg.value ?? "0")
        if (valueNano <= 0n) continue

        const { lt, hash } = tx.transaction_id
        if (!lastLt || lt > lastLt) {
          lastLt = lt
          lastHash = hash
        }

        deposits.push({
          request: target.request,
          amount: (Number(valueNano) / 1e9).toString(),
          txHash: hash,
          fromAddress: inMsg.source,
        })
      }
    } catch (err) {
      console.warn(`[tx-poller] TON scan failed for ${target.depositAddress}:`, err)
    }

    cursors.set(cursorKey, { kind: "lt", lt: lastLt, hash: lastHash })
  }

  return deposits
}

// ─── Cosmos scanner ───────────────────────────────────────────────────────────

const COSMOS_RPC_URL = gatewayUrl("cosmos-mainnet")

async function cosmosGet<T>(path: string): Promise<T> {
  const res = await fetch(`${COSMOS_RPC_URL}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`Cosmos GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function scanCosmos(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    const cursorKey = `cosmos:${target.depositAddress}`
    const prev = cursors.get(cursorKey) as OffsetCursor | undefined

    const offset = prev?.offset ?? 0

    try {
      const encodedAddr = encodeURIComponent(`'${target.depositAddress}'`)
      const result = await cosmosGet<{
        txs: Array<{
          txhash: string
          tx: {
            body: {
              messages: Array<{
                "@type": string
                from_address?: string
                to_address?: string
                amount?: Array<{ denom: string; amount: string }>
              }>
            }
          }
          tx_response: { code: number }
        }>
        total: string
      }>(
        `/cosmos/tx/v1beta1/txs?events=coin_received.receiver%3D${encodedAddr}` +
        `&order_by=ORDER_BY_ASC&pagination.limit=50&pagination.offset=${offset}`,
      )

      const txs = result.txs ?? []

      for (const tx of txs) {
        if (tx.tx_response.code !== 0) continue

        for (const msg of tx.tx.body.messages) {
          if (msg["@type"] !== "/cosmos.bank.v1beta1.MsgSend") continue
          if (!sameAddress(msg.to_address, target.depositAddress)) continue

          const uatom = (msg.amount ?? []).find(a => a.denom === "uatom")
          if (!uatom) continue

          deposits.push({
            request: target.request,
            amount: (Number(uatom.amount) / 1e6).toString(),
            txHash: tx.txhash,
            fromAddress: msg.from_address ?? null,
          })
        }
      }

      cursors.set(cursorKey, { kind: "offset", offset: offset + txs.length })
    } catch (err) {
      console.warn(`[tx-poller] Cosmos scan failed for ${target.depositAddress}:`, err)
    }
  }

  return deposits
}

// ─── Sui scanner ──────────────────────────────────────────────────────────────

const SUI_RPC_URL = gatewayUrl("sui-mainnet")

async function suiRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`Sui RPC ${method} HTTP ${res.status}`)
  const data = (await res.json()) as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`Sui RPC ${method}: ${data.error.message}`)
  return data.result as T
}

async function scanSui(
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  const deposits: FoundDeposit[] = []

  for (const target of targets) {
    const cursorKey = `sui:${target.depositAddress}`
    const prev = cursors.get(cursorKey) as SuiCursor | undefined

    if (!prev) {
      // First run: get the current latest tx cursor for this address and init
      const result = await suiRpc<{ nextCursor: string | null }>(
        "suix_queryTransactionBlocks",
        [{
          filter: { ToAddress: target.depositAddress },
          options: {},
          limit: 1,
          order: "descending",
        }],
      ).catch(() => ({ nextCursor: null }))
      cursors.set(cursorKey, { kind: "sui", cursor: result.nextCursor })
      continue
    }

    try {
      const result = await suiRpc<{
        data: Array<{
          digest: string
          balanceChanges?: Array<{
            owner: { AddressOwner?: string }
            coinType: string
            amount: string
          }>
          transaction?: { data: { sender: string } }
          effects?: { status: { status: string } }
        }>
        nextCursor: string | null
        hasNextPage: boolean
      }>("suix_queryTransactionBlocks", [{
        filter: { ToAddress: target.depositAddress },
        options: { showBalanceChanges: true, showEffects: true, showInput: true },
        limit: 50,
        order: "ascending",
        ...(prev.cursor ? { cursor: prev.cursor } : {}),
      }])

      if (result.data.length > 0 && result.nextCursor) {
        cursors.set(cursorKey, { kind: "sui", cursor: result.nextCursor })
      }

      for (const tx of result.data) {
        if (tx.effects?.status.status !== "success") continue

        // Find balance changes that increased our deposit address balance
        const changes = (tx.balanceChanges ?? []).filter(
          c =>
            c.owner.AddressOwner &&
            sameAddress(c.owner.AddressOwner, target.depositAddress) &&
            BigInt(c.amount) > 0n,
        )

        for (const change of changes) {
          const isSui = change.coinType === "0x2::sui::SUI"
          const isToken = target.contractAddress && change.coinType === target.contractAddress

          if (isSui && !target.contractAddress) {
            const amount = (Number(BigInt(change.amount)) / 1e9).toString()
            deposits.push({
              request: target.request,
              amount,
              txHash: tx.digest,
              fromAddress: tx.transaction?.data.sender ?? null,
            })
          } else if (isToken) {
            const rawAmt = BigInt(change.amount)
            const amount = (Number(rawAmt) / Math.pow(10, target.decimals)).toString()
            deposits.push({
              request: target.request,
              amount,
              txHash: tx.digest,
              fromAddress: tx.transaction?.data.sender ?? null,
            })
          }
        }
      }
    } catch (err) {
      console.warn(`[tx-poller] Sui scan failed for ${target.depositAddress}:`, err)
    }
  }

  return deposits
}

// ─── VeChain scanner ──────────────────────────────────────────────────────────

const VET_RPC_URL = gatewayUrl("vechain-mainnet")

async function vetGet<T>(path: string): Promise<T> {
  const res = await fetch(`${VET_RPC_URL}${path}`, {
    headers: { "x-api-key": TATUM_API_KEY },
  })
  if (!res.ok) throw new Error(`VeChain GET ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function vetPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${VET_RPC_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TATUM_API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`VeChain POST ${path} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function scanVeChain(
  targets: ScanTarget[],
  cursor: BlockCursor,
): Promise<{ deposits: FoundDeposit[]; nextCursor: BlockCursor }> {
  // Get current best block number
  const best = await vetGet<{ number: number }>("/blocks/best")
  const currentBlock = best.number

  if (currentBlock <= cursor.blockNumber) {
    return { deposits: [], nextCursor: cursor }
  }

  const fromBlock = cursor.blockNumber + 1
  const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_CYCLE - 1, currentBlock)
  const nextCursor: BlockCursor = { kind: "block", blockNumber: toBlock }
  const deposits: FoundDeposit[] = []

  const nativeTargets = targets.filter(t => !t.contractAddress)

  if (nativeTargets.length === 0) {
    return { deposits, nextCursor }
  }

  // Thor API: POST /logs/transfer — query VET transfer events in block range
  const criteriaSet = nativeTargets.map(t => ({ recipient: t.depositAddress }))

  const transferLogs = await vetPost<Array<{
    sender: string
    recipient: string
    amount: string  // hex wei
    meta: {
      blockNumber: number
      txID: string
    }
  }>>("/logs/transfer", {
    range: { unit: "block", from: fromBlock, to: toBlock },
    criteriaSet,
    order: "asc",
  })

  const addrMap = new Map(nativeTargets.map(t => [t.depositAddress.toLowerCase(), t]))

  for (const log of transferLogs) {
    const target = addrMap.get(log.recipient.toLowerCase())
    if (!target) continue

    const rawWei = BigInt(log.amount)
    if (rawWei <= 0n) continue

    deposits.push({
      request: target.request,
      amount: formatEther(rawWei),
      txHash: log.meta.txID,
      fromAddress: log.sender,
    })
  }

  return { deposits, nextCursor }
}

// ─── Dispatch: route chain to appropriate scanner ─────────────────────────────

async function scanChain(
  chain: string,
  family: string,
  targets: ScanTarget[],
): Promise<FoundDeposit[]> {
  // Block-based scanners need an initial block cursor
  const isBlockBased = ["evm", "bitcoin", "litecoin", "dogecoin", "bitcoincash", "tron", "vechain"].includes(family)

  if (isBlockBased) {
    const cursorKey = chain
    let cursor = getBlockCursor(cursorKey)

    if (!cursor) {
      // First run: initialize to current tip; return nothing (don't replay history)
      let currentBlock = 0
      try {
        if (family === "evm") {
          const hex = await evmRpc<string>(chain, "eth_blockNumber", [])
          currentBlock = Number(hex)
        } else if (family === "tron") {
          const nb = await tronPost<{ block_header?: { raw_data?: { number?: number } } }>(
            "/wallet/getnowblock", {}
          )
          currentBlock = nb.block_header?.raw_data?.number ?? 0
        } else if (family === "vechain") {
          const best = await vetGet<{ number: number }>("/blocks/best")
          currentBlock = best.number
        } else {
          // UTXO
          const rpcUrl = getUtxoRpcUrl(chain)
          currentBlock = await utxoRpc<number>(rpcUrl, "getblockcount", [])
        }
      } catch (err) {
        console.warn(`[tx-poller] failed to init cursor for ${chain}:`, err)
        return []
      }
      cursor = { kind: "block", blockNumber: currentBlock }
      cursors.set(cursorKey, cursor)
      console.info(`[tx-poller] ${chain} cursor initialized at block ${currentBlock}`)
      return []
    }

    if (family === "evm") {
      const { deposits, nextCursor } = await scanEvm(chain, targets, cursor)
      cursors.set(chain, nextCursor)
      return deposits
    }
    if (family === "tron") {
      const { deposits, nextCursor } = await scanTron(targets, cursor)
      cursors.set(chain, nextCursor)
      return deposits
    }
    if (family === "vechain") {
      const { deposits, nextCursor } = await scanVeChain(targets, cursor)
      cursors.set(chain, nextCursor)
      return deposits
    }
    // UTXO families
    const { deposits, nextCursor } = await scanUtxo(chain, targets, cursor)
    cursors.set(chain, nextCursor)
    return deposits
  }

  // Account-based scanners maintain per-address cursors internally
  switch (family) {
    case "solana": return scanSolana(targets)
    case "xrp":    return scanXrp(targets)
    case "stellar": return scanStellar(targets)
    case "ton":    return scanTon(targets)
    case "cosmos": return scanCosmos(targets)
    case "sui":    return scanSui(targets)
    default:
      console.warn(`[tx-poller] unknown family for tx scan: ${family}`)
      return []
  }
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

async function runTxPollCycle(): Promise<void> {
  // Load all active exchange requests for TATUM-sourced, tx-polling networks
  const requests = await db.exchangeRequest.findMany({
    where: {
      status: { in: POLL_STATUSES },
      depositAddressId: { not: null },
      fromNetwork: { depositSource: DepositSource.TATUM },
    },
    include: exchangeRequestInclude,
  })

  if (requests.length === 0) return

  // Build scan targets (include coin-network mapping for decimals/contract)
  const byChain = new Map<string, { family: string; targets: ScanTarget[] }>()

  await Promise.all(
    requests.map(async (req: ExchangeRequestContext) => {
      const family = req.fromNetwork.chainFamily ?? getFamily(req.fromNetwork.chain)
      if (!TX_POLLING_FAMILIES.has(family)) return

      const mapping = await getCoinNetworkMapping(req.fromCoinId, req.fromNetworkId)

      const target: ScanTarget = {
        request: req,
        depositAddress: req.depositAddress!.address,
        contractAddress: mapping?.contractAddress ?? null,
        decimals: mapping?.decimals ?? 18,
      }

      const chain = req.fromNetwork.chain
      if (!byChain.has(chain)) {
        byChain.set(chain, { family, targets: [] })
      }
      byChain.get(chain)!.targets.push(target)
    }),
  )

  if (byChain.size === 0) return

  console.info(`[tx-poller] scanning ${byChain.size} chain(s), ${requests.length} request(s)`)

  // Scan all chains in parallel (with per-chain error isolation)
  await Promise.allSettled(
    [...byChain.entries()].map(async ([chain, { family, targets }]) => {
      let deposits: FoundDeposit[]
      try {
        deposits = await scanChain(chain, family, targets)
      } catch (err) {
        console.error(`[tx-poller] scan error on ${chain}:`, err)
        return
      }

      if (deposits.length === 0) return

      console.info(`[tx-poller] ${chain}: ${deposits.length} deposit(s) found`)

      // Process each found deposit sequentially to avoid race conditions
      for (const dep of deposits) {
        try {
          await processPolledDeposit(dep.request, dep.amount, dep.txHash)
        } catch (err) {
          console.error(
            `[tx-poller] processPolledDeposit failed for ${dep.request.id} txHash=${dep.txHash}:`,
            err,
          )
        }
      }
    }),
  )
}

// ─── Public class ─────────────────────────────────────────────────────────────

export class TxDepositPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  start(): void {
    if (this.intervalId !== null) return
    console.info(`[tx-poller] starting, interval=${POLL_INTERVAL_MS}ms`)
    this.tick()
    this.intervalId = setInterval(() => this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.info("[tx-poller] stopped")
    }
  }

  private tick(): void {
    if (this.isRunning) {
      console.warn("[tx-poller] skipping cycle: previous cycle still running")
      return
    }
    this.isRunning = true
    runTxPollCycle()
      .catch((err) => {
        const code = (err as { code?: string })?.code
        if (code === "P2037") {
          console.warn("[tx-poller] DB saturated (P2037) — retrying next cycle")
          return
        }
        console.error("[tx-poller] cycle error:", err)
      })
      .finally(() => {
        this.isRunning = false
      })
  }
}

export const txDepositPoller = new TxDepositPoller()
