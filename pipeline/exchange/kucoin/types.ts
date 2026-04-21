/**
 * KuCoin API response type definitions.
 *
 * These DTOs represent the raw JSON returned by KuCoin REST endpoints.
 * They are internal to the KuCoin adapter and must NOT leak into the
 * shared domain / exchange provider interface.
 *
 * Field names follow the official KuCoin API documentation.
 * Where the docs are ambiguous, the field is marked with a comment.
 */

// ─── Envelope ────────────────────────────────────────────────────────

/** All KuCoin REST responses use this wrapper. code "200000" = success. */
export interface KuCoinResponse<T> {
  code: string
  data: T
  msg?: string
}

// ─── Currencies / Chains  (GET /api/v3/currencies) ──────────────────

export interface KuCoinCurrencyChain {
  chainName: string
  /** KuCoin's internal chain identifier (e.g. "eth", "bsc", "trx"). */
  chainId: string
  withdrawalMinFee: string
  withdrawalMinSize: string
  depositMinSize: string | null
  isWithdrawEnabled: boolean
  isDepositEnabled: boolean
  /** Contract address for tokens (empty string for native coins). */
  contractAddress?: string
}

export interface KuCoinCurrency {
  currency: string
  name: string
  fullName: string
  precision: number
  chains: KuCoinCurrencyChain[]
}

// ─── Deposit Address  (GET /api/ua/v1/asset/deposit/address) ─────────

export interface KuCoinDepositAddress {
  address: string
  memo: string
  /** Classic endpoint uses "chain", UTA endpoint uses "chainId". */
  chain?: string
  chainId?: string
  chainName?: string
  contractAddress?: string
  to?: string
  expirationDate?: number
  currency?: string
  remark?: string
}

// ─── Create Deposit Address  (POST /api/v1/deposit-addresses) ───────

export interface KuCoinCreatedDepositAddress {
  address: string
  memo: string
  chain: string
}

// ─── Deposit History  (GET /api/v1/deposits) ─────────────────────────

export interface KuCoinDepositItem {
  currency: string
  chain: string
  status: "PROCESSING" | "SUCCESS" | "FAILURE"
  address: string
  memo: string
  isInner: boolean
  amount: string
  fee: string
  walletTxId: string
  createdAt: number
  updatedAt: number
  remark: string
}

export interface KuCoinDepositList {
  currentPage: number
  pageSize: number
  totalNum: number
  totalPage: number
  items: KuCoinDepositItem[]
}

// ─── Convert Quote  (GET /api/v1/convert/quote) ──────────────────────
// Permission: Spot

export interface KuCoinConvertQuote {
  quoteId: string
  /** Conversion rate. */
  price: string
  fromCurrency?: string
  toCurrency?: string
  /** Amount of the source currency used for the quote. */
  fromCurrencySize: string
  /** Expected amount of the target currency after conversion. */
  toCurrencySize: string
  /** Quote expiry timestamp (ms). */
  validUntill: number
}

// ─── Convert Order  (POST /api/v1/convert/order) ─────────────────────
// Permission: Spot

export interface KuCoinConvertOrderRequest {
  clientOrderId: string
  quoteId: string
  accountType: string
}

export interface KuCoinConvertOrderResult {
  clientOrderId: string
  orderId: string
  orderStatus?: "SUCCESS" | "PROCESSING" | "FAIL"
}

// ─── Universal Transfer  (POST /api/v3/accounts/universal-transfer) ──
// Permission: Transfer

// ─── Account Balance  (GET /api/v1/accounts) ────────────────────────

export interface KuCoinAccount {
  id: string
  currency: string
  type: string
  balance: string
  available: string
  holds: string
}

export interface KuCoinInnerTransferRequest {
  clientOid: string
  type: "INTERNAL"
  currency: string
  amount: string
  fromAccountType: string
  toAccountType: string
}

export interface KuCoinInnerTransferResult {
  orderId: string
}

// ─── Withdrawal Quotas  (GET /api/v1/withdrawals/quotas) ─────────────

export interface KuCoinWithdrawalQuotas {
  currency: string
  limitBTCAmount: string
  usedBTCAmount: string
  remainAmount: string
  availableAmount: string
  withdrawMinFee: string
  innerWithdrawMinFee: string
  withdrawMinSize: string
  isWithdrawEnabled: boolean
  precision: number
  chain: string
}

// ─── Withdraw  (POST /api/v3/withdrawals) ────────────────────────────
// Permission: Withdrawal + IP restriction recommended

export interface KuCoinWithdrawRequest {
  currency: string
  toAddress: string
  amount: string
  withdrawType: "ADDRESS"
  chain: string
  memo?: string
  remark?: string
}

export interface KuCoinWithdrawResult {
  withdrawalId: string
}

// ─── Market Stats  (GET /api/v1/market/stats) ─────────────────────────

export interface KuCoinMarketStats {
  symbol: string
  /** Last traded price. */
  last: string
  buy: string
  sell: string
  changeRate: string
  high: string
  low: string
  vol: string
  volValue: string
}
