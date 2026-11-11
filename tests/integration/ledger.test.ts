import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { harness } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h?.mf.dispose();
});

async function account(amount = "50000.00", name = "เงินสด") {
  const r = await h.request("/cash-accounts", "POST", {
    name,
    balanceThb: amount,
  });

  expect(r.status).toBe(201);

  return r.json.data.cashAccount;
}

const buy = (accountId: string | null, amount = "10000.00") => ({
  assetType: "btc",
  assetName: "BTC",
  tradeDate: "2026-11-11",
  amountThb: amount,
  btcQuantity: "0.00300001",
  cashAccountId: accountId,
  note: null,
});

async function balance(id: string) {
  return (await h.request("/cash-accounts")).json.data.find(
    (a: any) => a.id === id,
  );
}

describe("D1 ledger and API", () => {
  it("keeps principal constant for cash purchases, adds principal for external purchases", async () => {
    const a = await account();
    const r = await h.request("/transactions", "POST", buy(a.id));

    expect(r.status).toBe(201);
    expect(r.json.data.affectedCashAccounts[0].balanceThb).toBe("40000.00");

    let s = (await h.request("/summary?month=2026-11")).json.data;

    expect(s.totalPrincipalThb).toBe("50000.00");
    expect(s.btc.quantity).toBe("0.00300001");
    await h.request("/transactions", "POST", buy(null));
    s = (await h.request("/summary?month=2026-11")).json.data;
    expect(s.totalPrincipalThb).toBe("60000.00");
    expect(s.monthPurchaseCount).toBe(2);
  });

  it("allows exact exhaustion and rejects insufficient cash atomically", async () => {
    const a = await account("10000");

    expect((await h.request("/transactions", "POST", buy(a.id))).status).toBe(
      201,
    );

    expect((await balance(a.id)).balanceThb).toBe("0.00");

    const failed = await h.request("/transactions", "POST", buy(a.id, "0.01"));

    expect(failed.status).toBe(409);
    expect(failed.json.error.code).toBe("INSUFFICIENT_CASH");
    expect((await h.request("/transactions")).json.data.items).toHaveLength(1);
  });

  it("refunds edits, switches accounts and external sources, then deletes once", async () => {
    const a = await account();
    const b = await account("20000", "สำรอง");

    let t = (await h.request("/transactions", "POST", buy(a.id))).json.data
      .transaction;

    let r = await h.request(`/transactions/${t.id}`, "PATCH", {
      ...buy(a.id, "15000"),
      expectedVersion: t.version,
    });

    expect(r.status).toBe(200);
    t = r.json.data.transaction;
    expect((await balance(a.id)).balanceThb).toBe("35000.00");

    t = (
      await h.request(`/transactions/${t.id}`, "PATCH", {
        ...buy(b.id),
        expectedVersion: t.version,
      })
    ).json.data.transaction;

    expect((await balance(a.id)).balanceThb).toBe("50000.00");
    expect((await balance(b.id)).balanceThb).toBe("10000.00");

    t = (
      await h.request(`/transactions/${t.id}`, "PATCH", {
        ...buy(null),
        expectedVersion: t.version,
      })
    ).json.data.transaction;

    expect((await balance(b.id)).balanceThb).toBe("20000.00");

    t = (
      await h.request(`/transactions/${t.id}`, "PATCH", {
        ...buy(a.id),
        expectedVersion: t.version,
      })
    ).json.data.transaction;

    const key = crypto.randomUUID();

    expect(
      (
        await h.request(`/transactions/${t.id}`, "DELETE", undefined, {
          "If-Match": `"${t.version}"`,
          "Idempotency-Key": key,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await h.request(`/transactions/${t.id}`, "DELETE", undefined, {
          "If-Match": `"${t.version}"`,
          "Idempotency-Key": key,
        })
      ).status,
    ).toBe(200);

    expect((await balance(a.id)).balanceThb).toBe("50000.00");
  });

  it("rejects failed edits without partial refunds", async () => {
    const a = await account("10000");
    const b = await account("0");

    const t = (await h.request("/transactions", "POST", buy(a.id))).json.data
      .transaction;

    expect(
      (
        await h.request(`/transactions/${t.id}`, "PATCH", {
          ...buy(b.id),
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);

    expect((await balance(a.id)).balanceThb).toBe("0.00");

    expect(
      (await h.request("/transactions")).json.data.items[0].cashAccountId,
    ).toBe(a.id);
  });

  it("adjusts cash independently and refunds original buys after a manual set", async () => {
    const a = await account();

    const t = (await h.request("/transactions", "POST", buy(a.id))).json.data
      .transaction;

    let current = await balance(a.id);

    expect(
      (
        await h.request(`/cash-accounts/${a.id}/adjustments`, "POST", {
          mode: "set",
          amountThb: "0",
          expectedVersion: current.version,
        })
      ).status,
    ).toBe(200);

    current = await balance(a.id);

    expect(
      (
        await h.request(`/cash-accounts/${a.id}/adjustments`, "POST", {
          mode: "subtract",
          amountThb: "1",
          expectedVersion: current.version,
        })
      ).status,
    ).toBe(409);

    await h.request(`/transactions/${t.id}`, "DELETE", undefined, {
      "If-Match": '"1"',
    });

    expect((await balance(a.id)).balanceThb).toBe("10000.00");
    expect((await h.request("/transactions")).json.data.items).toHaveLength(0);
  });

  it("serializes concurrent spending beyond the available balance", async () => {
    const a = await account("15000");

    const results = await Promise.all([
      h.request("/transactions", "POST", buy(a.id)),
      h.request("/transactions", "POST", buy(a.id)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await balance(a.id)).balanceThb).toBe("5000.00");
  });

  it("replays simultaneous identical keys but rejects different payloads", async () => {
    const a = await account();
    const key = crypto.randomUUID();
    const headers = { "Idempotency-Key": key };

    const results = await Promise.all([
      h.request("/transactions", "POST", buy(a.id), headers),
      h.request("/transactions", "POST", buy(a.id), headers),
    ]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].json).toEqual(results[1].json);
    expect((await balance(a.id)).balanceThb).toBe("40000.00");

    const conflict = await h.request(
      "/transactions",
      "POST",
      buy(a.id, "1"),
      headers,
    );

    expect(conflict.json.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("permits only one stale edit/delete and never records false success", async () => {
    const a = await account();

    const t = (await h.request("/transactions", "POST", buy(a.id))).json.data
      .transaction;

    const results = await Promise.all([
      h.request(`/transactions/${t.id}`, "PATCH", {
        ...buy(a.id, "5000"),
        expectedVersion: 1,
      }),
      h.request(`/transactions/${t.id}`, "DELETE", undefined, {
        "If-Match": '"1"',
      }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);

    expect(results.filter((r) => [404, 409].includes(r.status))).toHaveLength(
      1,
    );

    expect(
      (
        await h.db
          .prepare("SELECT COUNT(*) AS count FROM mutation_requests")
          .first<any>()
      ).count,
    ).toBe(3);
  });

  it("rejects a stale manual balance after a purchase", async () => {
    const a = await account();

    await h.request("/transactions", "POST", buy(a.id));

    const r = await h.request(`/cash-accounts/${a.id}/adjustments`, "POST", {
      mode: "set",
      amountThb: "50000",
      expectedVersion: 1,
    });

    expect(r.json.error.code).toBe("VERSION_CONFLICT");
    expect((await balance(a.id)).balanceThb).toBe("40000.00");
  });

  it("rolls back when audit or idempotency persistence fails", async () => {
    const a = await account();

    await h.db
      .prepare(
        "CREATE TRIGGER fail_audit BEFORE INSERT ON cash_balance_events WHEN NEW.kind='purchase_debit' BEGIN SELECT RAISE(ABORT,'injected'); END",
      )
      .run();

    expect((await h.request("/transactions", "POST", buy(a.id))).status).toBe(
      500,
    );

    expect((await balance(a.id)).balanceThb).toBe("50000.00");
    await h.db.prepare("DROP TRIGGER fail_audit").run();

    await h.db
      .prepare(
        "CREATE TRIGGER fail_result BEFORE UPDATE ON mutation_requests BEGIN SELECT RAISE(ABORT,'injected'); END",
      )
      .run();

    expect((await h.request("/transactions", "POST", buy(a.id))).status).toBe(
      500,
    );

    expect((await balance(a.id)).balanceThb).toBe("50000.00");
    expect((await h.request("/transactions")).json.data.items).toHaveLength(0);
  });

  it("reports goals at absent, 100%, and above 100%", async () => {
    expect(
      (await h.request("/summary")).json.data.btc.progressPercent,
    ).toBeNull();

    await h.request("/btc-goal", "PUT", {
      targetBtc: "0.00300001",
      expectedVersion: 1,
    });

    await h.request("/transactions", "POST", buy(null));

    expect((await h.request("/summary")).json.data.btc.progressPercent).toBe(
      100,
    );

    await h.request("/transactions", "POST", buy(null));

    expect((await h.request("/summary")).json.data.btc.progressPercent).toBe(
      200,
    );

    expect((await h.request("/summary")).json.data.btc.remainingBtc).toBe(
      "0.00000000",
    );
  });

  it("escapes wildcard searches and paginates stable dates", async () => {
    for (const name of ["A_1", "AB1", "A%1"])
      await h.request("/transactions", "POST", {
        ...buy(null),
        assetName: name,
      });

    const search = await h.request(
      "/transactions?q=" + encodeURIComponent("_"),
    );

    expect(search.json.data.items.map((t: any) => t.assetName)).toEqual([
      "A_1",
    ]);

    const page = (await h.request("/transactions?limit=2")).json.data;

    expect(page.items).toHaveLength(2);

    const next = (
      await h.request(
        "/transactions?limit=2&cursor=" + encodeURIComponent(page.nextCursor),
      )
    ).json.data;

    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(page.items[0].id);
  });
});

describe("ledger boundaries", () => {
  it("rejects malformed requests before making a financial change", async () => {
    const a = await account();

    for (const amount of ["-1", "0", "1.001", "1e3", "1000000000.01"]) {
      const r = await h.request("/transactions", "POST", buy(a.id, amount));

      expect(r.status).toBe(400);
    }

    expect(
      (
        await h.request("/transactions", "POST", {
          ...buy(a.id),
          tradeDate: "2026-02-31",
        })
      ).status,
    ).toBe(400);

    expect(
      (await h.request("/transactions", "POST", buy(crypto.randomUUID()))).json
        .error.code,
    ).toBe("CASH_ACCOUNT_NOT_FOUND");

    expect((await balance(a.id)).balanceThb).toBe("50000.00");
  });

  it("does not lose a purchase racing a manual balance set", async () => {
    const a = await account();

    const results = await Promise.all([
      h.request("/transactions", "POST", buy(a.id)),
      h.request(`/cash-accounts/${a.id}/adjustments`, "POST", {
        mode: "set",
        amountThb: "60000",
        expectedVersion: 1,
      }),
    ]);

    expect(results[0].status).toBe(201);
    expect([200, 409]).toContain(results[1].status);

    expect((await balance(a.id)).balanceThb).toBe(
      results[1].status === 200 ? "50000.00" : "40000.00",
    );
  });

  it("enforces safe aggregate BTC and account balance limits with rollback", async () => {
    const a = await account("1000000000");

    expect(
      (
        await h.request(`/cash-accounts/${a.id}/adjustments`, "POST", {
          mode: "add",
          amountThb: "0.01",
          expectedVersion: 1,
        })
      ).json.error.code,
    ).toBe("AMOUNT_LIMIT");

    for (let i = 0; i < 4; i++)
      expect(
        (
          await h.request("/transactions", "POST", {
            ...buy(null, "1"),
            btcQuantity: "21000000",
          })
        ).status,
      ).toBe(201);

    expect(
      (
        await h.request("/transactions", "POST", {
          ...buy(null, "1"),
          btcQuantity: "21000000",
        })
      ).json.error.code,
    ).toBe("AMOUNT_LIMIT");

    expect((await h.request("/transactions")).json.data.items).toHaveLength(4);
  });

  it("keeps account renaming versioned and clears BTC goals without changing purchases", async () => {
    const a = await account();

    const renamed = await h.request(`/cash-accounts/${a.id}`, "PATCH", {
      name: "ชื่อใหม่",
      expectedVersion: 1,
    });

    expect(renamed.json.data.cashAccount.version).toBe(2);

    expect(
      (
        await h.request(`/cash-accounts/${a.id}`, "PATCH", {
          name: "ชื่อเก่า",
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);

    await h.request("/transactions", "POST", buy(null));
    await h.request("/btc-goal", "PUT", { targetBtc: "1", expectedVersion: 1 });

    expect(
      (
        await h.request("/btc-goal", "PUT", {
          targetBtc: null,
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await h.request("/btc-goal", "PUT", {
          targetBtc: null,
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);

    expect(
      (await h.request("/summary")).json.data.btc.progressPercent,
    ).toBeNull();

    expect((await h.request("/transactions")).json.data.items).toHaveLength(1);
  });
});
