/**
 * Exchange provider module entry point.
 *
 * Exports the provider interface, factory, and a singleton getter.
 *
 * Usage in webhook pipeline:
 *   import { getExchangeProvider } from "../../services/exchange"
 *   const provider = getExchangeProvider()
 *   await provider.getDepositAddress(coin, network)
 *   await provider.executeSettlement(params)
 *
 * The active provider is determined by EXCHANGE_PROVIDER env var.
 * Default: "binance". Set to "kucoin" to switch.
 */

import { BinanceExchangeAdapter } from "./binance/adapter"
import { getExchangeProviderName, loadKuCoinConfig } from "./config"
import { KuCoinExchangeAdapter } from "./kucoin/adapter"
import type { ExchangeProvider } from "./types"

export type { ExchangeProvider } from "./types"
export type {
  ExchangeDepositAddress,
  ExchangeSettlementParams,
  ExchangeSettlementResult,
} from "./types"

let _provider: ExchangeProvider | null = null

/**
 * Create an exchange provider based on env config.
 * Called once; the instance is then cached for the process lifetime.
 */
function createExchangeProvider(): ExchangeProvider {
  const name = getExchangeProviderName()

  if (name === "kucoin") {
    const config = loadKuCoinConfig()
    console.info(
      `[exchange] Initialized KuCoin exchange provider (baseUrl=${config.baseUrl}, flexTransfer=${config.flexTransferEnabled})`,
    )
    return new KuCoinExchangeAdapter(config)
  }

  // Default: Binance
  console.info("[exchange] Initialized Binance exchange provider (default)")
  return new BinanceExchangeAdapter()
}

/**
 * Get the active exchange provider singleton.
 *
 * Lazy-initialized on first call. Thread-safe in single-threaded Bun runtime.
 */
export function getExchangeProvider(): ExchangeProvider {
  if (!_provider) {
    _provider = createExchangeProvider()
  }
  return _provider
}
