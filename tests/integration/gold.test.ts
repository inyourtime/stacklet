import { afterEach, expect, it } from "vitest";
import { harness } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;

afterEach(async () => {
  await h?.mf.dispose();
});

const gold = (cashAccountId: string | null, amountThb = "10000.25") => ({
  assetType: "gold",
  assetName: "ทองคำแท่ง 96.5%",
  tradeDate: "2026-11-13",
  amountThb,
  btcQuantity: null,
  cashAccountId,
  note: "รวมค่าธรรมเนียม",
});

it("supports gold purchases, filters, totals, edits, refunds and restore", async () => {
  h = await harness();
  const account = await h.request("/cash-accounts", "POST", {
    name: "เงินลงทุน",
    balanceThb: "50000",
  });
  expect(account.status).toBe(201);
  const accountId = account.json.data.cashAccount.id;

  for (const assetType of ["btc", "stock", "fund"]) {
    const result = await h.request("/transactions", "POST", {
      ...gold(accountId, "1000"),
      assetType,
      assetName: assetType.toUpperCase(),
      btcQuantity: assetType === "btc" ? "0.00030001" : null,
    });
    expect(result.status).toBe(201);
  }

  const created = await h.request("/transactions", "POST", gold(accountId));
  expect(created.status).toBe(201);
  let transaction = created.json.data.transaction;
  expect(transaction).toMatchObject({
    assetType: "gold",
    btcQuantity: null,
    amountThb: "10000.25",
  });
  expect(created.json.data.affectedCashAccounts[0].balanceThb).toBe("36999.75");
  const external = await h.request("/transactions", "POST", {
    ...gold(null, "2000.50"),
    assetName: "GOLD external",
  });
  expect(external.status).toBe(201);

  const filtered = await h.request("/transactions?type=gold&q=ทองคำ");
  expect(filtered.status).toBe(200);
  expect(
    filtered.json.data.items.map((item: { id: string }) => item.id),
  ).toEqual([transaction.id]);
  const summary = (await h.request("/summary?month=2026-11")).json.data;
  expect(summary).toMatchObject({
    totalPrincipalThb: "52000.50",
    investedThb: "15000.75",
    cashThb: "36999.75",
    monthPurchasesThb: "15000.75",
    monthPurchaseCount: 5,
    btc: { quantity: "0.00030001" },
  });
  expect(summary.allocations).toContainEqual({
    type: "gold",
    amountThb: "12000.75",
  });

  const exported = (await h.request("/backup")).json.data;
  const preview = await h.request("/imports/validate", "POST", {
    backup: exported,
  });
  expect(preview.status).toBe(200);
  const download = await h.request("/backup");
  const restored = await h.request("/imports/replace", "POST", {
    backup: exported,
    fileHash: preview.json.data.fileHash,
    snapshotRevision: preview.json.data.snapshotRevision,
    backupReceipt: download.headers.get("X-Backup-Receipt"),
  });
  expect(restored.status).toBe(200);
  const roundtrip = (await h.request("/backup")).json.data;
  expect({ ...roundtrip, exportedAt: null }).toEqual({
    ...exported,
    exportedAt: null,
  });

  transaction = (await h.request(`/transactions?type=gold&q=ทองคำ`)).json.data
    .items[0];
  const edited = await h.request(`/transactions/${transaction.id}`, "PATCH", {
    ...gold(accountId, "5000.10"),
    expectedVersion: transaction.version,
  });
  expect(edited.status).toBe(200);
  expect(edited.json.data.affectedCashAccounts[0].balanceThb).toBe("41999.90");
  const deleted = await h.request(
    `/transactions/${transaction.id}`,
    "DELETE",
    undefined,
    {
      "If-Match": `"${edited.json.data.transaction.version}"`,
    },
  );
  expect(deleted.status).toBe(200);
  expect(deleted.json.data.affectedCashAccounts[0].balanceThb).toBe("47000.00");
});

it("rejects BTC quantities on gold and rolls back insufficient cash purchases", async () => {
  h = await harness();
  expect(
    (
      await h.request("/transactions", "POST", {
        ...gold(null),
        btcQuantity: "0.1",
      })
    ).status,
  ).toBe(400);
  const account = (
    await h.request("/cash-accounts", "POST", {
      name: "เงินสด",
      balanceThb: "1",
    })
  ).json.data.cashAccount;
  expect(
    (await h.request("/transactions", "POST", gold(account.id))).status,
  ).toBe(409);
  expect((await h.request("/transactions?type=gold")).json.data.items).toEqual(
    [],
  );
  expect((await h.request("/cash-accounts")).json.data[0].balanceThb).toBe(
    "1.00",
  );
});
