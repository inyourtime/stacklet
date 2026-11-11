import { describe, it, expect } from "vitest";
import {
  parseThb,
  formatThb,
  parseUnits,
  safeSum,
  bangkokMonth,
  bangkokDate,
} from "../../src/shared/money";
import { parseBtc, formatBtc } from "../../src/shared/btc";
import { date, purchaseSchema, backupSchema } from "../../src/shared/contracts";

describe("exact decimal units", () => {
  it("round trips baht without floating point", () => {
    expect(parseThb("10000.25")).toBe(1000025);
    expect(formatThb(parseThb("0.29"))).toBe("0.29");
    expect(parseThb("1000000000")).toBe(100000000000);
  });

  it("preserves all eight BTC places", () => {
    expect(parseBtc("0.00300001")).toBe(300001);
    expect(formatBtc(1)).toBe("0.00000001");
    expect(parseBtc("21000000")).toBe(2100000000000000);
  });

  it.each(["-1", "1.001", "1e3", "NaN", "01", "1.", " 1", "1,000"])(
    "rejects invalid baht %s",
    (value) => {
      expect(() => parseThb(value)).toThrow();
    },
  );

  it("rejects overflow and excessive BTC precision", () => {
    expect(() => parseBtc("21000000.00000001")).toThrow();
    expect(() => parseBtc("0.000000001")).toThrow();
    expect(() => parseUnits("9007199254740992", 0)).toThrow();
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });

  it("validates actual calendar dates", () => {
    expect(date.safeParse("2026-02-31").success).toBe(false);
    expect(date.safeParse("2024-02-29").success).toBe(true);
    expect(date.safeParse("2026-02-29").success).toBe(false);
  });

  it("uses Bangkok for reporting boundaries", () => {
    const instant = new Date("2026-10-31T18:00:00Z");

    expect(bangkokMonth(instant)).toBe("2026-11");
    expect(bangkokDate(instant)).toBe("2026-11-01");
  });

  it("requires BTC only for Bitcoin purchases", () => {
    const p = {
      assetType: "btc",
      assetName: "BTC",
      tradeDate: "2026-11-11",
      amountThb: "10",
      btcQuantity: null,
      cashAccountId: null,
    };

    expect(purchaseSchema.safeParse(p).success).toBe(false);

    expect(
      purchaseSchema.safeParse({ ...p, btcQuantity: "0.00000001" }).success,
    ).toBe(true);

    expect(
      purchaseSchema.safeParse({ ...p, assetType: "stock", btcQuantity: "0.1" })
        .success,
    ).toBe(false);
  });

  it("rejects invalid backup references", () => {
    expect(
      backupSchema.safeParse({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        cashAccounts: [],
        transactions: [
          {
            id: crypto.randomUUID(),
            assetType: "stock",
            assetName: "A",
            tradeDate: "2026-11-11",
            amountThb: "1",
            btcQuantity: null,
            cashAccountId: crypto.randomUUID(),
            note: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        btcGoal: { targetBtc: null },
      }).success,
    ).toBe(false);
  });
});
