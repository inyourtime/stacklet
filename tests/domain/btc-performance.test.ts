import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateBtcPerformance } from "../../src/shared/btc";
import { fetchBtcPrice } from "../../src/web/lib/btc-price";

describe("BTC unrealized profit/loss", () => {
  it.each([
    ["3000000.00000000", "30000.00", "10000.00", "50.00"],
    ["1500000.00000000", "15000.00", "-5000.00", "-25.00"],
    ["2000000.00000000", "20000.00", "0.00", "0.00"],
  ])(
    "values gains, losses and break-even at %s",
    (price, value, profit, percent) => {
      expect(calculateBtcPerformance("0.01000000", "20000.00", price)).toEqual({
        priceThb: price.slice(0, -6),
        marketValueThb: value,
        profitLossThb: profit,
        profitLossPercent: percent,
      });
    },
  );

  it("rounds once to satang and retains all price and BTC decimals", () => {
    expect(
      calculateBtcPerformance("0.00000001", "0.01", "2500000.00000001"),
    ).toMatchObject({ marketValueThb: "0.03", profitLossThb: "0.02" });
    expect(
      calculateBtcPerformance("0.99999999", "1.00", "1.00500001"),
    ).toMatchObject({ marketValueThb: "1.00", profitLossThb: "0.00" });
  });

  it("handles an empty portfolio without dividing by zero", () => {
    expect(
      calculateBtcPerformance("0.00000000", "0.00", "2343846.00000000"),
    ).toMatchObject({
      marketValueThb: "0.00",
      profitLossThb: "0.00",
      profitLossPercent: null,
    });
  });

  it("rounds positive and negative percentages symmetrically", () => {
    expect(calculateBtcPerformance("1", "32", "32.04").profitLossPercent).toBe(
      "0.13",
    );
    expect(calculateBtcPerformance("1", "32", "31.96").profitLossPercent).toBe(
      "-0.13",
    );
  });

  it("keeps large valuations exact beyond Number.MAX_SAFE_INTEGER satang", () => {
    expect(
      calculateBtcPerformance("90071992.54740991", "1", "2343846.12345678"),
    ).toMatchObject({
      marketValueThb: "211114890564274.70",
      profitLossThb: "211114890564273.70",
    });
  });
});

describe("Binance TH BTC quote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the requested pair without credentials and keeps price precision", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        symbol: "BTCTHB",
        price: "2343846.12345678",
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchBtcPrice()).resolves.toBe("2343846.12345678");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.binance.th/api/v1/ticker/price?symbol=BTCTHB",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { symbol: "BTCUSDT", price: "100000.00000000" },
    { symbol: "BTCTHB", price: "0.00000000" },
    { symbol: "BTCTHB", price: "-1" },
    { symbol: "BTCTHB", price: "NaN" },
    { symbol: "BTCTHB", price: "1.000000001" },
    { symbol: "BTCTHB", price: 2343846 },
    { code: -1121, msg: "Invalid symbol." },
  ])("rejects unusable quotes: %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(fetchBtcPrice()).rejects.toThrow("ข้อมูลราคา BTC ไม่ถูกต้อง");
  });

  it("rejects unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );
    await expect(fetchBtcPrice()).rejects.toThrow("ไม่สามารถดึงราคา BTC ได้");
  });
});
