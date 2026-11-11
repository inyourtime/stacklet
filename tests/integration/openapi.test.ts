import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { hc } from "hono/client";
import app, { type AppType } from "../../src/server";
import { harness } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;

beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h?.mf.dispose();
});

describe("OpenAPI and Hono RPC", () => {
  it("generates a protected OpenAPI 3.1 document for all business endpoints", async () => {
    const result = await h.request("/openapi.json");
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    const document = result.json;
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBe("Stacklet API");
    expect(document.security).toEqual([{ AccessSession: [] }]);
    expect(document.components.securitySchemes.AccessSession).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "CF_Authorization",
    });
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.keys(path as object).filter((method) =>
        ["get", "post", "patch", "put", "delete"].includes(method),
      ),
    );
    expect(operations).toHaveLength(14);
    expect(
      document.paths["/api/v1/transactions/{id}"].delete.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "path", name: "id", required: true }),
        expect.objectContaining({
          in: "header",
          name: "If-Match",
          required: true,
        }),
        expect.objectContaining({
          in: "header",
          name: "Idempotency-Key",
          required: true,
        }),
        expect.objectContaining({
          in: "header",
          name: "X-Dataset-Epoch",
          required: true,
        }),
      ]),
    );
    expect(
      document.paths["/api/v1/transactions"].post.responses[201],
    ).toBeDefined();
    expect(
      document.paths["/api/v1/imports/validate"].post.parameters ?? [],
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key" }),
      ]),
    );
    expect(
      document.components.schemas.CashAccount.properties.balanceThb.type,
    ).toBe("string");
    expect(
      document.components.schemas.Backup.properties.schemaVersion,
    ).toMatchObject({ type: "number", enum: [1] });
    const validateRefs = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string") {
          expect(child).toMatch(/^#\//);
          const target = child
            .slice(2)
            .split("/")
            .reduce(
              (node: any, part) =>
                node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")],
              document,
            );
          expect(target, `Unresolved reference ${child}`).toBeDefined();
        } else validateRefs(child);
      }
    };
    validateRefs(document);
  });

  it("serves Scalar under the authenticated API prefix", async () => {
    const response = await app.request(
      "http://localhost/api/v1/reference",
      {},
      h.env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("Stacklet API Reference");
    expect(html).toContain("/api/v1/openapi.json");
    expect(html).toMatch(/"telemetry":\s*false/);
    expect(html).toMatch(/"proxyUrl":\s*""/);
    expect(html).toMatch(/"persistAuth":\s*false/);
    for (const endpoint of ["openapi.json", "reference"]) {
      const denied = await app.request(
        `http://localhost/api/v1/${endpoint}`,
        {},
        {
          ...h.env,
          APP_ENV: "production",
          DEV_AUTH_BYPASS: "false",
          ACCESS_ISSUER: "https://test.cloudflareaccess.com",
          ACCESS_AUD: "test",
          OWNER_EMAIL: "owner@example.com",
        },
      );
      expect(denied.status).toBe(401);
    }
  });

  it("uses inferred Hono RPC inputs and responses, including version headers and replay", async () => {
    const client = hc<AppType>("http://localhost", {
      headers: { Origin: "http://localhost" },
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        app.request(String(input), init, h.env),
    }).api.v1;
    const header = {
      "Idempotency-Key": crypto.randomUUID(),
      "X-Dataset-Epoch": h.epoch(),
    };
    const created = await client["cash-accounts"].$post({
      header,
      json: { name: "RPC cash", balanceThb: "100" },
    });
    expect(created.status).toBe(201);
    if (created.status !== 201) throw new Error("RPC account creation failed");
    const {
      data: { cashAccount },
    } = await created.json();
    expect(cashAccount.balanceThb).toBe("100.00");
    const purchase = await client.transactions.$post({
      header: { ...header, "Idempotency-Key": crypto.randomUUID() },
      json: {
        assetType: "btc",
        assetName: "BTC",
        tradeDate: "2026-11-11",
        amountThb: "25",
        btcQuantity: "0.00000001",
        cashAccountId: cashAccount.id,
        note: null,
      },
    });
    expect(purchase.status).toBe(201);
    if (purchase.status !== 201)
      throw new Error("RPC purchase creation failed");
    const {
      data: { transaction },
    } = await purchase.json();
    const deletion = {
      param: { id: transaction.id },
      header: {
        ...header,
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${transaction.version}"`,
      },
    };
    const deleted = await client.transactions[":id"].$delete(deletion);
    const repeated = await client.transactions[":id"].$delete(deletion);
    expect(deleted.status).toBe(200);
    expect(await repeated.json()).toEqual(await deleted.json());
    const accounts = await client["cash-accounts"].$get();
    if (accounts.status !== 200) throw new Error("RPC account read failed");
    expect((await accounts.json()).data[0].balanceThb).toBe("100.00");
  });

  it("preserves the error envelope for malformed JSON and request validation", async () => {
    const response = await app.request(
      "http://localhost/api/v1/cash-accounts",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Dataset-Epoch": h.epoch(),
        },
        body: "{",
      },
      h.env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: expect.any(String) },
    });
    for (const query of ["month=2026-13", "month=bad"])
      expect((await h.request(`/summary?${query}`)).status).toBe(400);
    expect((await h.request("/transactions?limit=101")).status).toBe(400);
    expect((await h.request("/transactions?type=cash")).status).toBe(400);
  });
});
