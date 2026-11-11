import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { harness } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h?.mf.dispose();
});

async function seed() {
  const a = (
    await h.request("/cash-accounts", "POST", {
      name: "เงินลงทุน",
      balanceThb: "50000",
    })
  ).json.data.cashAccount;

  await h.request("/transactions", "POST", {
    assetType: "btc",
    assetName: "BTC",
    tradeDate: "2026-11-11",
    amountThb: "10000",
    btcQuantity: "0.00300001",
    cashAccountId: a.id,
    note: null,
  });

  await h.request("/btc-goal", "PUT", { targetBtc: "1", expectedVersion: 1 });

  return a;
}

async function prepare(b: any) {
  const p = await h.request("/imports/validate", "POST", { backup: b });
  const download = await h.request("/backup");

  return {
    backup: b,
    fileHash: p.json.data.fileHash,
    snapshotRevision: p.json.data.snapshotRevision,
    backupReceipt: download.headers.get("X-Backup-Receipt"),
  };
}

describe("D1 snapshot restoration", () => {
  it("restores without replaying purchases, resets audit baseline, rejects old forms, and replays restore retries", async () => {
    await seed();

    const exported = (await h.request("/backup")).json.data;

    await h.request("/cash-accounts", "POST", {
      name: "ลบทิ้งหลัง restore",
      balanceThb: "123",
    });

    const input = await prepare(exported);
    const epoch = h.epoch();
    const key = crypto.randomUUID();

    const restored = await h.request("/imports/replace", "POST", input, {
      "Idempotency-Key": key,
    });

    expect(restored.status).toBe(200);
    expect(h.epoch()).not.toBe(epoch);

    expect((await h.request("/summary")).json.data.totalPrincipalThb).toBe(
      "50000.00",
    );

    expect((await h.request("/cash-accounts")).json.data[0].balanceThb).toBe(
      "40000.00",
    );

    const roundtrip = (await h.request("/backup")).json.data;

    expect({ ...roundtrip, exportedAt: null }).toEqual({
      ...exported,
      exportedAt: null,
    });

    const audit = await h.db
      .prepare("SELECT kind,delta_satang FROM cash_balance_events")
      .all<any>();

    expect(audit.results).toEqual([{ kind: "opening", delta_satang: 4000000 }]);

    const retry = await h.request("/imports/replace", "POST", input, {
      "Idempotency-Key": key,
      "X-Dataset-Epoch": epoch,
    });

    expect(retry.json).toEqual(restored.json);

    const stale = await h.request(
      "/cash-accounts",
      "POST",
      { name: "ฟอร์มเก่า", balanceThb: "1" },
      { "X-Dataset-Epoch": epoch },
    );

    expect(stale.json.error.code).toBe("DATASET_CONFLICT");
  });

  it("requires a fresh downloaded backup matching the preview revision", async () => {
    await seed();

    const b = (await h.request("/backup")).json.data;
    const input = await prepare(b);

    await h.request("/cash-accounts", "POST", {
      name: "ใหม่",
      balanceThb: "1",
    });

    const r = await h.request("/imports/replace", "POST", input);

    expect(r.json.error.code).toBe("SNAPSHOT_CONFLICT");
    expect((await h.request("/cash-accounts")).json.data).toHaveLength(2);
  });

  it("rejects forged download receipts and modified files", async () => {
    await seed();

    const b = (await h.request("/backup")).json.data;
    const input = await prepare(b);

    expect(
      (
        await h.request("/imports/replace", "POST", {
          ...input,
          backupReceipt: "fake",
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await h.request("/imports/replace", "POST", {
          ...input,
          backup: { ...b, transactions: [] },
        })
      ).json.error.code,
    ).toBe("INVALID_BACKUP");
  });

  it("rejects bad references, duplicate ids, invalid dates, unsupported schema, and too many purchases", async () => {
    await seed();

    const b = (await h.request("/backup")).json.data;

    const cases = [
      { ...b, schemaVersion: 2 },
      { ...b, cashAccounts: [] },
      { ...b, cashAccounts: [...b.cashAccounts, ...b.cashAccounts] },
      {
        ...b,
        transactions: [{ ...b.transactions[0], tradeDate: "2026-02-31" }],
      },
      {
        ...b,
        transactions: Array.from({ length: 1001 }, () => ({
          ...b.transactions[0],
          id: crypto.randomUUID(),
        })),
      },
    ];

    for (const backup of cases)
      expect(
        (await h.request("/imports/validate", "POST", { backup })).status,
      ).toBe(400);

    expect((await h.request("/summary")).json.data.totalPrincipalThb).toBe(
      "50000.00",
    );
  });

  it("rolls back the full replacement on a constraint failure", async () => {
    await seed();

    const b = (await h.request("/backup")).json.data;
    const input = await prepare({ ...b, transactions: [] });

    await h.db
      .prepare(
        "CREATE TRIGGER restore_failure BEFORE INSERT ON cash_accounts BEGIN SELECT RAISE(ABORT,'injected_restore_failure'); END",
      )
      .run();

    expect((await h.request("/imports/replace", "POST", input)).status).toBe(
      500,
    );

    expect((await h.request("/transactions")).json.data.items).toHaveLength(1);

    expect((await h.request("/cash-accounts")).json.data[0].balanceThb).toBe(
      "40000.00",
    );

    expect(
      (
        await h.db
          .prepare("SELECT restore,operation_id FROM mutation_context")
          .first<any>()
      ).restore,
    ).toBe(0);
  });

  it("accepts 1000 transactions in one real D1 batch", async () => {
    const now = new Date().toISOString();

    const b = {
      schemaVersion: 1,
      exportedAt: now,
      cashAccounts: [],
      transactions: Array.from({ length: 1000 }, () => ({
        id: crypto.randomUUID(),
        assetType: "btc",
        assetName: "BTC",
        tradeDate: "2026-11-11",
        amountThb: "1.00",
        btcQuantity: "0.00000001",
        cashAccountId: null,
        note: null,
        createdAt: now,
        updatedAt: now,
      })),
      btcGoal: { targetBtc: null },
    };

    const input = await prepare(b);
    const result = await h.request("/imports/replace", "POST", input);

    expect(result.status).toBe(200);

    const s = (await h.request("/summary")).json.data;

    expect(s.totalPrincipalThb).toBe("1000.00");
    expect(s.btc.quantity).toBe("0.00001000");
  });
});

it("rejects an oversized request before changing data", async () => {
  await seed();

  const result = await h.request("/imports/validate", "POST", {
    backup: { padding: "x".repeat(1024 * 1024 + 8192) },
  });

  expect(result.status).toBe(413);

  expect((await h.request("/summary")).json.data.totalPrincipalThb).toBe(
    "50000.00",
  );
});

it("exports data beyond restore limits without issuing a replacement receipt", async () => {
  const now = new Date().toISOString();

  const b = {
    schemaVersion: 1,
    exportedAt: now,
    cashAccounts: [],
    transactions: Array.from({ length: 1000 }, () => ({
      id: crypto.randomUUID(),
      assetType: "btc",
      assetName: "BTC",
      tradeDate: "2026-11-11",
      amountThb: "1.00",
      btcQuantity: "0.00000001",
      cashAccountId: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    })),
    btcGoal: { targetBtc: null },
  };

  expect(
    (await h.request("/imports/replace", "POST", await prepare(b))).status,
  ).toBe(200);

  await h.request("/transactions", "POST", {
    ...b.transactions[0],
    id: undefined,
    createdAt: undefined,
    updatedAt: undefined,
  });

  const exported = await h.request("/backup");

  expect(exported.status).toBe(200);
  expect(exported.json.data.transactions).toHaveLength(1001);
  expect(exported.headers.get("X-Backup-Restorable")).toBe("false");
  expect(exported.headers.get("X-Backup-Receipt")).toBeNull();
});
