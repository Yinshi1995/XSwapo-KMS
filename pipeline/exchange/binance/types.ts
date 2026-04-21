// Binance API type definitions.
// Pure type declarations — no runtime code.

export interface BinanceTickerResponse {
  symbol: string
  price: string
}

export interface BinanceCapitalConfigNetwork {
  network: string
  coin: string
  name?: string
  depositEnable: boolean
  withdrawEnable: boolean
  busy?: boolean
  isDefault?: boolean
  withdrawFee?: string
  withdrawMin?: string
  withdrawIntegerMultiple?: string
  withdrawMax?: string
  minConfirm?: number
  unLockConfirm?: number
}

export interface BinanceCapitalConfigCoin {
  coin: string
  name?: string
  depositAllEnable?: boolean
  withdrawAllEnable?: boolean
  free?: string
  locked?: string
  freeze?: string
  networkList: BinanceCapitalConfigNetwork[]
}

export interface BinanceDepositAddressResponse {
  coin: string
  address: string
  tag: string
  url?: string
  isDefault?: number
}

export interface BinanceDepositHistoryItem {
  id: string
  amount: string
  coin: string
  network: string
  status: number
  address: string
  addressTag?: string
  txId?: string
  insertTime?: number
  completeTime?: number
  transferType?: number
  confirmTimes?: string
  unlockConfirm?: number
  walletType?: number
  travelRuleStatus?: number
  sourceAddress?: string
}

export interface BinanceWithdrawHistoryItem {
  id?: string
  amount: string
  transactionFee?: string
  coin: string
  status: number
  address: string
  txId?: string
  network?: string
  applyTime?: string
  transferType?: number
  withdrawOrderId?: string
  info?: string
  confirmNo?: number
  walletType?: number
  txKey?: string
  completeTime?: string
}

export interface BinanceOrderResponse {
  symbol: string
  orderId: number
  orderListId?: number
  clientOrderId: string
  transactTime: number
  price?: string
  origQty?: string
  executedQty?: string
  origQuoteOrderQty?: string
  cummulativeQuoteQty?: string
  status: string
  timeInForce?: string
  type: string
  side: string
  fills?: BinanceOrderFill[]
}

export interface BinanceOrderFill {
  price: string
  qty: string
  commission: string
  commissionAsset: string
  tradeId: number
}

export interface BinanceMyTradeItem {
  id: number
  orderId: number
  orderListId: number
  price: string
  qty: string
  quoteQty: string
  commission: string
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
  isBestMatch: boolean
}

export interface BinanceSignedRequestOptions {
  method?: "GET" | "POST" | "DELETE"
  params?: Array<[string, string | number | boolean | undefined | null]>
  signal?: AbortSignal
}

export interface BinanceDepositHistoryParams {
  coin: string
  status?: number
  startTime?: number
  endTime?: number
  offset?: number
  limit?: number
  txId?: string
}

export interface BinanceWithdrawHistoryParams {
  coin?: string
  status?: number
  offset?: number
  limit?: number
  startTime?: number
  endTime?: number
  withdrawOrderId?: string
}

export interface FindBinanceWithdrawalByOrderIdParams {
  coin: string
  withdrawOrderId: string
  network?: string
  address?: string
}

export interface BinanceMarketOrderParams {
  symbol: string
  side: "BUY" | "SELL"
  quoteOrderQty?: string
  quantity?: string
  newClientOrderId?: string
  newOrderRespType?: "ACK" | "RESULT" | "FULL"
}

export interface BinanceOrderLookupParams {
  symbol: string
  orderId?: number
  origClientOrderId?: string
}

export interface WaitForBinanceDepositParams extends BinanceDepositHistoryParams {
  network?: string
  address?: string
  amount?: string
  pollIntervalMs?: number
  timeoutMs?: number
}

export interface WaitForBinanceOrderParams extends BinanceOrderLookupParams {
  pollIntervalMs?: number
  timeoutMs?: number
}

export interface BinanceExchangeMarketOrderPlan extends BinanceMarketOrderParams {
  sourceAsset: string
  targetAsset: string
}

export interface ExecuteBinanceSwapAndWithdrawParams {
  deposit: WaitForBinanceDepositParams
  order?: BinanceMarketOrderParams
  withdraw: Omit<BinanceWithdrawParams, "amount" | "address"> & {
    clientWithdrawAddress: string
    amount?: string
  }
  signal?: AbortSignal
}

export interface ExecuteBinanceSwapAndWithdrawResult {
  deposit: BinanceDepositHistoryItem
  order?: BinanceOrderResponse
  withdrawal: { id: string; msg?: string; success?: boolean }
  withdrawAmount: string
}

export interface BinanceWithdrawParams {
  coin: string
  network: string
  address: string
  amount: string
  withdrawOrderId?: string
  addressTag?: string
  walletType?: 0 | 1
  transactionFeeFlag?: boolean
  name?: string
}
