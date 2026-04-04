/**
 * trpc/lib/tatumClient.ts — Tatum Price API client
 */

const TATUM_BASE_URL = "https://api.tatum.io/v4"

export interface TatumRateResponse {
  value: string
  symbol: string
  basePair: string
  timestamp: number
  source: string
}

function getApiKey(): string {
  const key = process.env.TATUM_API_KEY
  if (!key) throw new Error("TATUM_API_KEY is not set")
  return key
}

export async function fetchSingleRate(
  symbol: string,
  basePair: string,
): Promise<TatumRateResponse> {
  const url = `${TATUM_BASE_URL}/data/rate/symbol?symbol=${encodeURIComponent(symbol)}&basePair=${encodeURIComponent(basePair)}`
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": getApiKey() },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Tatum API error: ${res.status} ${body}`)
  }
  return res.json() as Promise<TatumRateResponse>
}

export async function fetchBatchRates(
  pairs: Array<{ currency: string; basePair: string }>,
): Promise<TatumRateResponse[]> {
  const res = await fetch(`${TATUM_BASE_URL}/data/rate/batch`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pairs),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Tatum API error: ${res.status} ${body}`)
  }
  return res.json() as Promise<TatumRateResponse[]>
}
