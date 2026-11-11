import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  it,
  expect,
  describe,
} from "vitest";
import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { harness } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;
let server: Server;
let issuer: string;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  pair = await generateKeyPair("RS256");

  const jwk = await exportJWK(pair.publicKey);

  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");

    res.end(
      JSON.stringify({
        keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h?.mf.dispose();
});

async function token(
  options: {
    email?: string;
    aud?: string;
    iss?: string;
    expired?: boolean;
    otherKey?: boolean;
  } = {},
) {
  const key = options.otherKey
    ? (await generateKeyPair("RS256")).privateKey
    : pair.privateKey;

  return new SignJWT({ email: options.email ?? "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.iss ?? issuer)
    .setAudience(options.aud ?? "stacklet-test")
    .setExpirationTime(
      options.expired ? Math.floor(Date.now() / 1000) - 60 : "5m",
    )
    .sign(key);
}

function env() {
  return {
    ...h.env,
    APP_ENV: "production" as const,
    DEV_AUTH_BYPASS: "false",
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: "stacklet-test",
    OWNER_EMAIL: "owner@example.com",
  };
}

describe("Access JWT and origin protection", () => {
  it("accepts a signed owner JWT and rejects missing or forged tokens", async () => {
    expect(
      (await h.request("/summary", "GET", undefined, {}, env())).status,
    ).toBe(401);

    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          { "Cf-Access-Jwt-Assertion": "fake" },
          env(),
        )
      ).status,
    ).toBe(401);

    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          { "Cf-Access-Jwt-Assertion": await token() },
          env(),
        )
      ).status,
    ).toBe(200);
  });

  it("rejects wrong signature, issuer, audience, and expiry", async () => {
    for (const opts of [
      { otherKey: true },
      { iss: "https://wrong.example" },
      { aud: "wrong" },
      { expired: true },
    ])
      expect(
        (
          await h.request(
            "/summary",
            "GET",
            undefined,
            { "Cf-Access-Jwt-Assertion": await token(opts) },
            env(),
          )
        ).status,
      ).toBe(401);
  });

  it("rejects non-owner email and spoofed email headers", async () => {
    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          {
            "Cf-Access-Jwt-Assertion": await token({
              email: "other@example.com",
            }),
          },
          env(),
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          { "Cf-Access-Authenticated-User-Email": "owner@example.com" },
          env(),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects remote bypass and mismatched worker origin", async () => {
    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          {},
          { ...env(), DEV_AUTH_BYPASS: "true" },
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await h.request(
          "/summary",
          "GET",
          undefined,
          { "Cf-Access-Jwt-Assertion": await token() },
          { ...env(), APP_ORIGIN: "https://private.example" },
        )
      ).status,
    ).toBe(403);
  });

  it("rejects cross-origin mutations and returns JSON for unknown API routes", async () => {
    const r = await h.request(
      "/cash-accounts",
      "POST",
      { name: "x", balanceThb: "1" },
      { Origin: "https://evil.example" },
    );

    expect(r.status).toBe(403);

    const missing = await h.request("/missing");

    expect(missing.status).toBe(404);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
  });
});
