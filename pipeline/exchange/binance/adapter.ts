/**
 * Binance exchange provider adapter.
 *
 * Delegates to the Binance API functions co-located in this module.
 * No new business logic — this is a thin mapping layer between the
 * ExchangeProvider interface and the Binance service.
 */

import {
  buildBinanceMarketOrderForExchange,
  executeBinanceSwapAndWithdraw,
  getBinanceDepositAddress,
} from "./index"
import type {
  ExchangeDepositAddress,
  ExchangeProvider,
  ExchangeSettlementParams,
  ExchangeSettlementResult,
} from "../types"

export class BinanceExchangeAdapter implements ExchangeProvider {
  readonly name = "binance" as const

  async getDepositAddress(
    coin: string,
    network: string,
    signal?: AbortSignal,
  ): Promise<ExchangeDepositAddress> {
    const result = await getBinanceDepositAddress(coin, network, signal)
    return {
      address: result.address,
      tag: result.tag || undefined,
    }
  }

  async executeSettlement(
    params: ExchangeSettlementParams,
  ): Promise<ExchangeSettlementResult> {
    const { signal } = params

    const orderPlan = params.needsSwap
      ? await buildBinanceMarketOrderForExchange(
          params.sourceCoin,
          params.targetCoin,
          params.depositAmount,
          signal,
        )
      : undefined

    const result = await executeBinanceSwapAndWithdraw({
      deposit: {
        coin: params.depositCoin,
        network: params.depositNetwork,
        address: params.depositAddress,
        amount: params.depositAmount,
        txId: params.depositTxId,
        startTime: params.depositStartTime,
      },
      order: orderPlan,
      withdraw: {
        coin: params.withdrawCoin,
        network: params.withdrawNetwork,
        amount: params.withdrawAmount,
        clientWithdrawAddress: params.withdrawAddress,
        withdrawOrderId: params.withdrawOrderId,
      },
      signal,
    })

    return {
      withdrawalId: result.withdrawal.id,
      withdrawAmount: result.withdrawAmount,
      orderInfo: result.order
        ? {
            symbol: result.order.symbol,
            orderId: result.order.orderId,
          }
        : undefined,
    }
  }
}
