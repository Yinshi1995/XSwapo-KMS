/**
 * chains/evm.ts
 * ETH + BSC + POLYGON — все три одинаковы, только URL разный
 *
 * bun add ethers
 */

import {
  HDNodeWallet, Mnemonic, ethers,
  JsonRpcProvider, FetchRequest, Wallet, Contract,
  parseUnits, formatEther, formatUnits,
} from "ethers"
import type { ChainWallet, DerivedAddress, TxResult, GasEstimate, Balance } from "../types"
import { TATUM_API_KEY, gatewayUrl, tatumHeaders } from "../gateway"

// ─── RPC URL ─────────────────────────────────────────────────────────────────
// Some Tatum gateway slugs differ from the chain identifiers we use internally.
const EVM_SLUG_MAP: Record<string, string> = {
  "avalanche-c-mainnet": "avax-mainnet",
  "avalanche-c-testnet": "avax-testnet",
  "harmony-mainnet": "one-mainnet",
  "harmony-testnet": "one-testnet",
}

export function evmRpcUrl(chain: string): string {
  return gatewayUrl(EVM_SLUG_MAP[chain] ?? chain)
}

// BIP-44: ETH=60, BSC=60 (совместим), MATIC=60
const DERIVATION_PATH = "m/44'/60'/0'"

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function evmProvider(chain: string): JsonRpcProvider {
  const fetchReq = new FetchRequest(evmRpcUrl(chain))
  fetchReq.setHeader("x-api-key", TATUM_API_KEY)
  return new JsonRpcProvider(fetchReq, undefined, { staticNetwork: true })
}

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const url = evmRpcUrl(chain)
  const res = await fetch(url, {
    method: "POST",
    headers: tatumHeaders(),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`EVM RPC ${method} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { result?: T; error?: { message: string } }
  if (data.error) throw new Error(`EVM RPC ${method}: ${data.error.message}`)
  return data.result as T
}

// ─── 1. Генерация кошелька (локально) ────────────────────────────────────────
export function evmGenerateWallet(): ChainWallet {
  const w = HDNodeWallet.createRandom()
  if (!w.mnemonic) throw new Error("mnemonic generation failed")
  const hd = HDNodeWallet.fromMnemonic(w.mnemonic, DERIVATION_PATH)
  return { mnemonic: w.mnemonic.phrase, xpub: hd.neuter().extendedKey }
}

// ─── 2. Деривация адреса из xpub (локально) ──────────────────────────────────
export function evmDeriveAddress(xpub: string, index: number): DerivedAddress {
  const hd = HDNodeWallet.fromExtendedKey(xpub)
  const child = hd.deriveChild(0).deriveChild(index)
  return { address: child.address.toLowerCase() }
}

// ─── 3. Деривация приватного ключа из мнемоника (локально) ───────────────────
export function evmDerivePrivateKey(mnemonic: string, index: number): string {
  const hd = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), DERIVATION_PATH)
  return hd.deriveChild(0).deriveChild(index).privateKey!
}

// ─── 4. Баланс (native) ───────────────────────────────────────────────────────
export async function evmGetBalance(address: string, chain: string): Promise<Balance> {
  const wei = await rpc<string>(chain, "eth_getBalance", [address, "latest"])
  return { balance: formatEther(BigInt(wei)), raw: BigInt(wei).toString() }
}

// ─── 5. Баланс ERC-20 ─────────────────────────────────────────────────────────
export async function evmGetTokenBalance(
  address: string, contract: string, chain: string
): Promise<Balance> {
  const provider = evmProvider(chain)
  const c = new Contract(contract, ERC20_ABI, provider)
  const [raw, dec] = await Promise.all([c.balanceOf(address) as Promise<bigint>, c.decimals() as Promise<number>])
  return { balance: formatUnits(raw, dec), raw: raw.toString() }
}

// ─── 6. Оценка газа ───────────────────────────────────────────────────────────
export async function evmEstimateGas(params: {
  chain: string; from: string; to: string
  valueEth?: string; data?: string
}): Promise<GasEstimate> {
  const { chain, from, to, valueEth, data } = params
  const tx: Record<string, string> = { from, to }
  if (valueEth) tx.value = "0x" + BigInt(Math.round(Number(valueEth) * 1e18)).toString(16)
  if (data) tx.data = data

  const [gasHex, priceHex, tip] = await Promise.all([
    rpc<string>(chain, "eth_estimateGas", [tx]),
    rpc<string>(chain, "eth_gasPrice", []),
    rpc<string>(chain, "eth_maxPriorityFeePerGas", []).catch(() => "0x0"),
  ])
  const gasLimit = BigInt(gasHex)
  const gasPrice = BigInt(priceHex)
  return {
    gasLimit: gasLimit.toString(),
    gasPriceGwei: formatUnits(gasPrice, "gwei"),
    totalFeeEth: formatEther(gasLimit * gasPrice),
    maxPriorityFeeGwei: formatUnits(BigInt(tip), "gwei"),
  }
}

// ─── 7. Отправка native (ETH/BNB/MATIC) ─────────────────────────────────────
export async function evmSendNative(params: {
  chain: string; privateKey: string; to: string; amountEth: string
}): Promise<TxResult> {
  const { chain, privateKey, to, amountEth } = params
  const wallet = new Wallet(privateKey, evmProvider(chain))
  const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(amountEth) })
  return { txId: tx.hash }
}

// ─── 8. Отправка ERC-20 (USDT/USDC/etc) ─────────────────────────────────────
export async function evmSendToken(params: {
  chain: string; privateKey: string; to: string
  contractAddress: string; amount: string
}): Promise<TxResult> {
  const { chain, privateKey, to, contractAddress, amount } = params
  const wallet = new Wallet(privateKey, evmProvider(chain))
  const c = new Contract(contractAddress, ERC20_ABI, wallet)
  const dec = await c.decimals() as number
  const tx = await c.transfer(to, parseUnits(amount, dec)) as { hash: string }
  return { txId: tx.hash }
}

// ─── 9. Receipt ───────────────────────────────────────────────────────────────
export async function evmGetReceipt(txHash: string, chain: string) {
  const r = await rpc<{ status: string; blockNumber: string; gasUsed: string } | null>(
    chain, "eth_getTransactionReceipt", [txHash]
  )
  if (!r) return { status: "pending" as const, blockNumber: null }
  return {
    status: r.status === "0x1" ? "confirmed" as const : "failed" as const,
    blockNumber: parseInt(r.blockNumber, 16),
    gasUsed: BigInt(r.gasUsed).toString(),
  }
}
