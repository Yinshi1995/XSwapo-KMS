/**
 * tests/sweep.test.ts — Tests for sweep.toExchange mutation
 *
 * Mocks: index.ts functions (estimateFee, getBalance, sendNative, sendToken)
 */

import { describe, test, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { appRouter } from "../trpc/routers/index"
import {
  extractFeeNative, toBigScale, fromBigScale, multiplyScaled,
} from "../trpc/routers/sweep"

// ─── Test infrastructure ─────────────────────────────────────────────────────

const _origConsoleLog = console.log
const _origConsoleError = console.error
beforeAll(() => {
  console.log = () => {}
  console.error = () => {}
  process.env.TATUM_API_KEY = "test-key"
})
afterAll(() => {
  console.log = _origConsoleLog
  console.error = _origConsoleError
})

const BASE = "http://localhost:3001"

async function handle(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
  })
}

function trpcMutation(procedure: string, input: unknown): Request {
  return new Request(`${BASE}/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

async function trpcData(res: Response): Promise<any> {
  const envelope = await res.json()
  return envelope?.result?.data
}

// ─── Index module mock setup ─────────────────────────────────────────────────

// We mock the entire index module so sweep.ts calls our stubs
const mockEstimateFee = mock(() => Promise.resolve({ totalFeeEth: "0.001" }))
const mockGetBalance = mock(() => Promise.resolve({ balance: "1.0", raw: "1000000000000000000" }))
const mockSendNative = mock(() => Promise.resolve({ txId: "0xnativetx123" }))
const mockSendToken = mock(() => Promise.resolve({ txId: "0xtokentx456" }))
const mockGetFamily = mock((chain: string) => {
  if (chain.toLowerCase().includes("tron")) return "tron"
  if (chain.toLowerCase().includes("bitcoin")) return "bitcoin"
  if (chain.toLowerCase().includes("solana")) return "solana"
  return "evm"
})

mock.module("../index", () => ({
  estimateFee: (...args: any[]) => mockEstimateFee(...args),
  getBalance: (...args: any[]) => mockGetBalance(...args),
  sendNative: (...args: any[]) => mockSendNative(...args),
  sendToken: (...args: any[]) => mockSendToken(...args),
  getFamily: (...args: any[]) => mockGetFamily(...args),
}))

// ─── Default valid input ─────────────────────────────────────────────────────

const validNativeInput = {
  destinationAddress: "0xKuCoinAddress123",
  chain: "ethereum-mainnet",
  amount: "1.5",
  depositPrivateKey: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  depositAddress: "0xDepositAddr123",
  gasPrivateKey: "0xgasprivkey123456789abcdef123456789abcdef123456789abcdef12345678",
  gasAddress: "0xGasWalletAddr456",
}

const validTokenInput = {
  ...validNativeInput,
  contractAddress: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
}

// ─── Helper function tests ───────────────────────────────────────────────────

describe("extractFeeNative", () => {
  test("extracts totalFeeEth from EVM GasEstimate", () => {
    const result = extractFeeNative(
      { gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.00042", maxPriorityFeeGwei: "1" },
      "evm",
    )
    expect(result).toBe("0.00042")
  })

  test("extracts feeLimit from TRON estimation (SUN → TRX)", () => {
    const result = extractFeeNative(
      { energyRequired: 65000, feeLimit: 150_000_000 },
      "tron",
    )
    expect(result).toBe("150")
  })

  test("returns 0 for TRON native (feeLimit=0)", () => {
    const result = extractFeeNative(
      { energyRequired: 0, feeLimit: 0 },
      "tron",
    )
    expect(result).toBe("0")
  })

  test("extracts feeFor250Bytes from BTC estimation (satoshi → BTC)", () => {
    const result = extractFeeNative(
      { feePerByte: 10, feeFor250Bytes: 2500 },
      "bitcoin",
    )
    expect(result).toBe("0.000025")
  })

  test("extracts fee string from generic chain estimation", () => {
    const result = extractFeeNative(
      { fee: "0.005", feeSol: "0.005" },
      "solana",
    )
    expect(result).toBe("0.005")
  })

  test("returns 0 for unknown fee structure", () => {
    const result = extractFeeNative({} as any, "evm")
    expect(result).toBe("0")
  })
})

describe("BigScale arithmetic", () => {
  test("toBigScale parses integer correctly", () => {
    expect(fromBigScale(toBigScale("100"))).toBe("100")
  })

  test("toBigScale parses decimal correctly", () => {
    expect(fromBigScale(toBigScale("1.5"))).toBe("1.5")
  })

  test("toBigScale parses small decimal", () => {
    expect(fromBigScale(toBigScale("0.001"))).toBe("0.001")
  })

  test("multiplyScaled doubles correctly", () => {
    const scaled = toBigScale("0.001")
    const doubled = multiplyScaled(scaled, 2.0)
    expect(fromBigScale(doubled)).toBe("0.002")
  })

  test("multiplyScaled with 1.0 is identity", () => {
    const scaled = toBigScale("0.12345")
    const result = multiplyScaled(scaled, 1.0)
    expect(fromBigScale(result)).toBe("0.12345")
  })

  test("comparison works correctly", () => {
    const a = toBigScale("0.5")
    const b = toBigScale("1.0")
    expect(a < b).toBe(true)
    expect(b > a).toBe(true)
    expect(a === a).toBe(true)
  })
})

// ─── sweep.toExchange integration tests ──────────────────────────────────────

describe("sweep.toExchange — happy path native", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.001", maxPriorityFeeGwei: "1" })
    mockGetBalance.mockResolvedValue({ balance: "2.0", raw: "2000000000000000000" })
    mockSendNative.mockResolvedValue({ txId: "0xsweptx111" })
  })

  test("sends native sweep when deposit has enough gas", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
    expect(data.txId).toBe("0xsweptx111")
    // Sweep must send exactly the requested amount (1.5), not "balance - gas".
    expect(data.amount).toBe("1.5")
    expect(data.destination).toBe("0xKuCoinAddress123")
  })

  test("calls sendNative with correct params", async () => {
    await handle(trpcMutation("sweep.toExchange", validNativeInput))
    // sendNative called for the actual sweep (not gas top-up)
    expect(mockSendNative).toHaveBeenCalledTimes(1)
    const call = mockSendNative.mock.calls[0][0]
    expect(call.chain).toBe("ethereum-mainnet")
    expect(call.privateKey).toBe(validNativeInput.depositPrivateKey)
    expect(call.to).toBe("0xKuCoinAddress123")
    expect(call.amount).toBe("1.5")
  })
})

describe("sweep.toExchange — happy path token", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "65000", gasPriceGwei: "20", totalFeeEth: "0.002", maxPriorityFeeGwei: "1" })
    mockGetBalance.mockResolvedValue({ balance: "0.1", raw: "100000000000000000" })
    mockSendToken.mockResolvedValue({ txId: "0xtokensweep222" })
  })

  test("sends token sweep when deposit has enough gas", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validTokenInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
    expect(data.txId).toBe("0xtokensweep222")
    expect(data.amount).toBe("1.5")
  })

  test("calls sendToken with contractAddress and decimals", async () => {
    await handle(trpcMutation("sweep.toExchange", validTokenInput))
    expect(mockSendToken).toHaveBeenCalledTimes(1)
    expect(mockSendNative).not.toHaveBeenCalled()
    const call = mockSendToken.mock.calls[0][0]
    expect(call.contractAddress).toBe("0x55d398326f99059fF775485246999027B3197955")
    expect(call.decimals).toBe(18)
    expect(call.amount).toBe("1.5")
  })
})

describe("sweep.toExchange — gas top-up flow", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "50", totalFeeEth: "0.005", maxPriorityFeeGwei: "2" })
    // Deposit wallet has barely any gas
    let callCount = 0
    mockGetBalance.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // deposit wallet balance — insufficient
        return Promise.resolve({ balance: "0.001", raw: "1000000000000000" })
      }
      // gas wallet balance — sufficient
      return Promise.resolve({ balance: "5.0", raw: "5000000000000000000" })
    })
    mockSendNative.mockResolvedValue({ txId: "0xgastopup333" })
  })

  test("initiates gas top-up when deposit wallet has insufficient gas", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("GAS_TOPUP_SENT")
    expect(data.gasTopupTxId).toBe("0xgastopup333")
    expect(data.message).toContain("retry sweep after confirmation")
  })

  test("gas top-up uses gas wallet private key", async () => {
    await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(mockSendNative).toHaveBeenCalledTimes(1)
    const call = mockSendNative.mock.calls[0][0]
    expect(call.privateKey).toBe(validNativeInput.gasPrivateKey)
    expect(call.to).toBe(validNativeInput.depositAddress)
  })
})

describe("sweep.toExchange — gas wallet insufficient", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "50", totalFeeEth: "0.005", maxPriorityFeeGwei: "2" })
    // Both wallets are broke
    mockGetBalance.mockResolvedValue({ balance: "0.0001", raw: "100000000000000" })
  })

  test("returns GAS_WALLET_INSUFFICIENT when gas wallet has no funds", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("GAS_WALLET_INSUFFICIENT")
    expect(data.message).toContain("Gas wallet has")
  })
})

describe("sweep.toExchange — gas fee multiplier", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    // Fee = 0.001 ETH
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.001", maxPriorityFeeGwei: "1" })
  })

  test("default multiplier (2.0) doubles the required gas", async () => {
    // Balance between 0.001 and 0.002 — enough for 1x but not 2x
    mockGetBalance.mockImplementation((address: string) => {
      if (address === validNativeInput.depositAddress) {
        return Promise.resolve({ balance: "0.0015", raw: "1500000000000000" })
      }
      return Promise.resolve({ balance: "10.0", raw: "10000000000000000000" })
    })
    mockSendNative.mockResolvedValue({ txId: "0xgastopup_2x" })

    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    const data = await trpcData(res)
    // 0.001 * 2.0 = 0.002, but deposit only has 0.0015 → gas top-up
    expect(data.status).toBe("GAS_TOPUP_SENT")
  })

  test("custom multiplier 1.0 uses exact fee estimate", async () => {
    // gas required = 0.001 * 1.0 = 0.001; balance must cover amount (1.5) + gas.
    mockGetBalance.mockResolvedValue({ balance: "1.6", raw: "1600000000000000000" })
    mockSendNative.mockResolvedValue({ txId: "0xsweep_exact" })

    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasFeeMultiplier: 1.0,
    }))
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
  })

  test("custom multiplier 3.0 triples the required gas", async () => {
    // 0.002 < 0.001 * 3.0 = 0.003 → need gas top-up
    mockGetBalance.mockImplementation((address: string) => {
      if (address === validNativeInput.depositAddress) {
        return Promise.resolve({ balance: "0.002", raw: "2000000000000000" })
      }
      return Promise.resolve({ balance: "10.0", raw: "10000000000000000000" })
    })
    mockSendNative.mockResolvedValue({ txId: "0xtopup_3x" })

    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasFeeMultiplier: 3.0,
    }))
    const data = await trpcData(res)
    expect(data.status).toBe("GAS_TOPUP_SENT")
  })
})

describe("sweep.toExchange — fee estimation failure", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockRejectedValue(new Error("RPC timeout"))
  })

  test("returns GAS_ESTIMATION_FAILED when estimateFee throws", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("GAS_ESTIMATION_FAILED")
    expect(data.details).toBe("RPC timeout")
  })
})

describe("sweep.toExchange — send failure", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.001", maxPriorityFeeGwei: "1" })
    mockGetBalance.mockResolvedValue({ balance: "2.0", raw: "2000000000000000000" })
  })

  test("returns SWEEP_FAILED when sendNative throws", async () => {
    mockSendNative.mockRejectedValue(new Error("nonce too low"))

    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("SWEEP_FAILED")
    expect(data.details).toBe("nonce too low")
  })

  test("returns SWEEP_FAILED when sendToken throws", async () => {
    mockSendToken.mockRejectedValue(new Error("insufficient token balance"))

    const res = await handle(trpcMutation("sweep.toExchange", validTokenInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("SWEEP_FAILED")
    expect(data.message).toContain("token")
  })
})

describe("sweep.toExchange — gas top-up failure", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "50", totalFeeEth: "0.005", maxPriorityFeeGwei: "2" })
    let callCount = 0
    mockGetBalance.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ balance: "0.001", raw: "1000000000000000" })
      return Promise.resolve({ balance: "5.0", raw: "5000000000000000000" })
    })
    mockSendNative.mockRejectedValue(new Error("gas top-up tx failed"))
  })

  test("returns GAS_TOPUP_FAILED when sendNative for gas fails", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("GAS_TOPUP_FAILED")
    expect(data.details).toBe("gas top-up tx failed")
  })
})

describe("sweep.toExchange — token vs native routing", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.001", maxPriorityFeeGwei: "1" })
    mockGetBalance.mockResolvedValue({ balance: "2.0", raw: "2000000000000000000" })
    mockSendNative.mockResolvedValue({ txId: "0xnative" })
    mockSendToken.mockResolvedValue({ txId: "0xtoken" })
  })

  test("routes to sendNative when no contractAddress", async () => {
    await handle(trpcMutation("sweep.toExchange", validNativeInput))
    expect(mockSendNative).toHaveBeenCalledTimes(1)
    expect(mockSendToken).not.toHaveBeenCalled()
  })

  test("routes to sendToken when contractAddress is provided", async () => {
    await handle(trpcMutation("sweep.toExchange", validTokenInput))
    expect(mockSendToken).toHaveBeenCalledTimes(1)
    expect(mockSendNative).not.toHaveBeenCalled()
  })
})

// ─── Regression: partial-refund / exact-amount native sweep ──────────────────
// Bug: previously, the native branch of performSweepToExchange ignored the
// `amount` parameter and swept the entire deposit balance minus gas. This
// broke OVERPAID refunds (where only the excess `received - expected` should
// be returned) and drained the deposit wallet so the subsequent transfer-to-
// exchange step had nothing left to send.

describe("sweep.toExchange — native sweep sends requested amount (regression)", () => {
  beforeEach(() => {
    mockEstimateFee.mockReset()
    mockGetBalance.mockReset()
    mockSendNative.mockReset()
    mockSendToken.mockReset()
    mockGetFamily.mockReset()

    mockGetFamily.mockImplementation(() => "evm")
    mockEstimateFee.mockResolvedValue({ gasLimit: "21000", gasPriceGwei: "20", totalFeeEth: "0.001", maxPriorityFeeGwei: "1" })
    // Deposit balance (1.5) is ample; we want to confirm only `amount` moves.
    mockGetBalance.mockResolvedValue({ balance: "1.5", raw: "1500000000000000000" })
    mockSendNative.mockResolvedValue({ txId: "0xpartialrefund" })
  })

  test("OVERPAID partial refund: sends exactly the refundAmount, not the full balance", async () => {
    // Scenario: received 1.3, expected 1.0 → refundAmount = 0.3.
    // The deposit address holds ~1.3 (1.5 here with some padding). Refund
    // must send 0.3 and leave 1.0 for the subsequent exchange transfer.
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "0.3",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
    expect(data.amount).toBe("0.3")

    expect(mockSendNative).toHaveBeenCalledTimes(1)
    const call = mockSendNative.mock.calls[0][0]
    expect(call.amount).toBe("0.3")
  })

  test("exact deposit transfer: sends exactly acceptedAmount, not balance - gas", async () => {
    // Scenario: EXACT classification. acceptedAmount equals fromAmount.
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "1.0",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
    expect(data.amount).toBe("1.0")

    expect(mockSendNative).toHaveBeenCalledTimes(1)
    expect(mockSendNative.mock.calls[0][0].amount).toBe("1.0")
  })

  test("UNDERPAID full refund: sends the received amount back to the user", async () => {
    // Scenario: received 0.5, expected 1.0 → refundAmount = 0.5.
    // Give the deposit balance a small surplus for gas.
    mockGetBalance.mockResolvedValue({ balance: "0.51", raw: "510000000000000000" })

    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "0.5",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("SWEEP_SENT")
    expect(data.amount).toBe("0.5")
    expect(mockSendNative.mock.calls[0][0].amount).toBe("0.5")
  })

  test("INSUFFICIENT_FUNDS when balance cannot cover amount + gas", async () => {
    // Balance 0.5, gas 0.002, request to send 1.0 → should refuse.
    mockGetBalance.mockResolvedValue({ balance: "0.5", raw: "500000000000000000" })

    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "1.0",
    }))
    expect(res.status).toBe(200)
    const data = await trpcData(res)
    expect(data.status).toBe("ERROR")
    expect(data.code).toBe("INSUFFICIENT_FUNDS")
    expect(data.details).toMatchObject({ requested: "1.0" })
    expect(mockSendNative).not.toHaveBeenCalled()
  })

  test("rejects zero amount on native sweep", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "0",
    }))
    // Input validation (AmountSchema) may reject this at the Zod boundary;
    // if it reaches the core, SWEEP_FAILED is returned. Either is acceptable.
    if (res.status === 200) {
      const data = await trpcData(res)
      expect(data.status).toBe("ERROR")
    } else {
      expect(res.status).not.toBe(200)
    }
    expect(mockSendNative).not.toHaveBeenCalled()
  })
})

describe("sweep.toExchange — input validation", () => {
  test("rejects missing destinationAddress", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      destinationAddress: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing chain", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      chain: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing amount", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      amount: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing depositPrivateKey", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      depositPrivateKey: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing depositAddress", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      depositAddress: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing gasPrivateKey", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasPrivateKey: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects missing gasAddress", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasAddress: "",
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects negative gasFeeMultiplier", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasFeeMultiplier: -1,
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects zero gasFeeMultiplier", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {
      ...validNativeInput,
      gasFeeMultiplier: 0,
    }))
    expect(res.status).not.toBe(200)
  })

  test("rejects empty object", async () => {
    const res = await handle(trpcMutation("sweep.toExchange", {}))
    expect(res.status).not.toBe(200)
  })
})
