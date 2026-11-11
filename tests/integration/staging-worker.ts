// Dedicated remote test Worker only. Never deploy this entry point with application data.
import app from "../../src/server";
import type { Bindings } from "../../src/server/types";

type TestEnv = {
  DB: D1Database;
  TEST_RUNNER_SECRET: string;
  TEST_DATABASE_NAME: string;
};

export default {
  async fetch(request: Request, env: TestEnv) {
    const supplied = request.headers.get("X-Test-Token") ?? "";

    const digest = async (value: string) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );

    const a = await digest(supplied),
      b = await digest(env.TEST_RUNNER_SECRET ?? "");

    let mismatch = 0;

    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];

    if (
      !env.TEST_RUNNER_SECRET ||
      env.TEST_RUNNER_SECRET.length < 32 ||
      mismatch ||
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/run" ||
      !env.TEST_DATABASE_NAME.startsWith("stacklet-integration-")
    )
      return new Response("Forbidden", { status: 403 });

    const bindings: Bindings = {
      DB: env.DB,
      APP_ENV: "local",
      DEV_AUTH_BYPASS: "true",
      APP_ORIGIN: "http://localhost",
    };

    let epoch = (await env.DB.prepare(
      "SELECT dataset_epoch AS epoch FROM app_meta",
    ).first<{ epoch: string }>())!.epoch;

    const call = async (
      path: string,
      method = "GET",
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await app.request(
        `http://localhost/api/v1${path}`,
        {
          method,
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "X-Dataset-Epoch": epoch,
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        bindings,
      );

      const data = (await response.json()) as any;

      if (data.meta) epoch = data.meta.datasetEpoch;

      return { status: response.status, data, headers: response.headers };
    };

    const passed: string[] = [];
    let current = "initialization";

    const check = (condition: boolean, name: string) => {
      current = name;

      if (!condition) throw new Error(name);

      passed.push(name);
    };

    try {
      const before = await call("/backup");

      const input = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        cashAccounts: [],
        transactions: [],
        btcGoal: { targetBtc: null },
      };

      const p = await call("/imports/validate", "POST", { backup: input });

      check(
        (
          await call("/imports/replace", "POST", {
            backup: input,
            ...p.data.data,
            backupReceipt: before.headers.get("X-Backup-Receipt"),
          })
        ).status !== 200,
        "invalid replace contract rejected",
      );

      const reset = await call("/imports/replace", "POST", {
        backup: input,
        fileHash: p.data.data.fileHash,
        snapshotRevision: p.data.data.snapshotRevision,
        backupReceipt: before.headers.get("X-Backup-Receipt"),
      });

      check(reset.status === 200, "restore baseline");

      const account = (
        await call("/cash-accounts", "POST", {
          name: "remote test",
          balanceThb: "15000",
        })
      ).data.data.cashAccount;

      const buy = {
        assetType: "btc",
        assetName: "BTC",
        tradeDate: "2026-11-11",
        amountThb: "10000",
        btcQuantity: "0.00300001",
        cashAccountId: account.id,
        note: null,
      };

      const race = await Promise.all([
        call("/transactions", "POST", buy),
        call("/transactions", "POST", buy),
      ]);

      check(
        race.filter((r) => r.status === 201).length === 1 &&
          race.filter((r) => r.status === 409).length === 1,
        "concurrent spending is atomic",
      );

      const s = (await call("/summary")).data.data;

      check(
        s.totalPrincipalThb === "15000.00" && s.cashThb === "5000.00",
        "cash and principal match",
      );

      const tx = (await call("/transactions")).data.data.items[0];
      const key = crypto.randomUUID();

      const del1 = await call(`/transactions/${tx.id}`, "DELETE", undefined, {
        "If-Match": '"1"',
        "Idempotency-Key": key,
      });

      const del2 = await call(`/transactions/${tx.id}`, "DELETE", undefined, {
        "If-Match": '"1"',
        "Idempotency-Key": key,
      });

      check(
        del1.status === 200 &&
          JSON.stringify(del1.data) === JSON.stringify(del2.data),
        "delete refund is idempotent",
      );

      const edit = await call(
        `/cash-accounts/${account.id}/adjustments`,
        "POST",
        { mode: "set", amountThb: "1", expectedVersion: account.version },
      );

      check(edit.status === 409, "stale cash adjustment rejected");
      await call("/transactions", "POST", buy);

      const snap = await call("/backup");

      const validation = await call("/imports/validate", "POST", {
        backup: snap.data.data,
      });

      const oldEpoch = epoch;

      const restored = await call("/imports/replace", "POST", {
        backup: snap.data.data,
        fileHash: validation.data.data.fileHash,
        snapshotRevision: validation.data.data.snapshotRevision,
        backupReceipt: snap.headers.get("X-Backup-Receipt"),
      });

      check(
        restored.status === 200 && epoch !== oldEpoch,
        "restore changes dataset epoch",
      );

      check(
        (await call("/summary")).data.data.cashThb === "5000.00",
        "restore does not debit twice",
      );

      check(
        (
          await call(
            "/cash-accounts",
            "POST",
            { name: "stale", balanceThb: "1" },
            { "X-Dataset-Epoch": oldEpoch },
          )
        ).status === 409,
        "pre-restore form rejected",
      );

      return Response.json(
        { passed, failed: 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return Response.json(
        { passed, failed: 1, failedScenario: current },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
