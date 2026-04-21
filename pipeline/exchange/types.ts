/**
 * Exchange provider abstraction layer.
 *
 * Both Binance and KuCoin adapters implement this interface so that the
 * webhook processing pipeline can settle exchange requests without knowing
 * which exchange is being used.
 */

/** Normalized deposit address returned by any exchange provider. */
export interface ExchangeDepositAddress {
  address: string
  /** Binance-style tag (e.g. XRP destination tag). */
  tag?: string
  /** KuCoin-style memo (e.g. EOS memo). */
  memo?: string
}

/** Parameters for the full exchange settlement flow. */
export interface ExchangeSettlementParams {
  /** Coin code deposited to exchange (e.g. "BNB", "USDT"). */
  depositCoin: string
  /** Network / chain of the deposit (e.g. "BSC", "ETH"). */
  depositNetwork: string
  /** Exchange deposit address that the on-chain transfer was sent to. */
  depositAddress?: string
  /** Amount deposited (decimal string). */
  depositAmount: string
  /** On-chain tx hash of the deposit transfer. */
  depositTxId?: string
  /** Timestamp (ms) to start searching for the deposit. */
  depositStartTime?: number

  /** Whether a currency conversion / swap is required. */
  needsSwap: boolean
  /** Source coin for swap (may equal depositCoin). */
  sourceCoin: string
  /** Target coin for swap / withdrawal. */
  targetCoin: string

  /** Coin to withdraw. */
  withdrawCoin: string
  /** Network to withdraw on. */
  withdrawNetwork: string
  /** Exact amount to withdraw to the client after internal fee deduction. */
  withdrawAmount: string
  /** Client's external withdrawal address. */
  withdrawAddress: string
  /** Stable idempotent correlation key for the withdrawal; adapters may normalize it for external API fields. */
  withdrawOrderId: string

  /**
   * Gas cost paid from our gas wallet for this deposit sweep (native coin, e.g. "0.001" ETH).
   * Only set for token (non-native) sweeps. The adapter should deduct this amount
   * (converted to deposit-coin units via live market price) from the exchange amount,
   * leaving the difference in the exchange account as gas reimbursement.
   */
  depositGasCostNative?: string
  /** Native coin code for the deposit network (e.g. "ETH", "BNB"). Required when depositGasCostNative is set. */
  depositNetworkNativeCoin?: string

  signal?: AbortSignal
}

/** Normalized result of an exchange settlement. */
export interface ExchangeSettlementResult {
  /** Exchange-side withdrawal ID. */
  withdrawalId: string
  /** Actual amount withdrawn (decimal string). */
  withdrawAmount: string
  /** Optional order / trade info for audit trail. */
  orderInfo?: {
    symbol?: string
    orderId?: string | number
  }
}

/**
 * Common interface that every exchange provider adapter must implement.
 *
 * The webhook processing pipeline resolves the active provider once and
 * then calls these methods without any exchange-specific logic.
 */
export interface ExchangeProvider {
  /** Human-readable provider name for logging / audit trail. */
  readonly name: string

  /**
   * Obtain a deposit address on the exchange for a given coin + network.
   * Used to determine where to send crypto from the user's deposit wallet.
   */
  getDepositAddress(
    coin: string,
    network: string,
    signal?: AbortSignal,
  ): Promise<ExchangeDepositAddress>

  /**
   * Execute the full settlement flow:
   * 1. Wait for the exchange to credit the incoming deposit.
   * 2. Convert / swap if the source and target coins differ.
   * 3. Withdraw the resulting amount to the client's address.
   *
   * Provider-specific steps (e.g. KuCoin flex transfer, quota checks)
   * are encapsulated inside the adapter.
   */
  executeSettlement(
    params: ExchangeSettlementParams,
  ): Promise<ExchangeSettlementResult>
}
