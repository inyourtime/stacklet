import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./types";
import { authenticate } from "./middleware/auth";
import { ApiError } from "./middleware/errors";
import { api } from "./routes/api";

const app = new OpenAPIHono<AppEnv>();

app.use("*", async (c, next) => {
  const start = performance.now();

  c.set("requestId", crypto.randomUUID());
  c.header("X-Request-Id", c.get("requestId"));
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();

  console.info(
    JSON.stringify({
      requestId: c.get("requestId"),
      durationMs: Math.round(performance.now() - start),
      status: c.res.status,
    }),
  );
});

app.use("*", async (c, next) => {
  if (["POST", "PATCH", "PUT"].includes(c.req.method)) {
    const limit = 1024 * 1024 + 8192;

    if (Number(c.req.header("Content-Length") ?? 0) > limit)
      throw new ApiError(413, "IMPORT_TOO_LARGE", "คำขอมีขนาดใหญ่เกินไป");

    const stream = c.req.raw.clone().body;

    if (stream) {
      const reader = stream.getReader();
      let size = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        size += value.byteLength;

        if (size > limit) {
          void reader.cancel();
          throw new ApiError(413, "IMPORT_TOO_LARGE", "คำขอมีขนาดใหญ่เกินไป");
        }
      }
    }
  }

  await next();
});

app.use("*", authenticate);

const routes = app.route("/api/v1", api);

app.openAPIRegistry.registerComponent("securitySchemes", "AccessSession", {
  type: "apiKey",
  in: "cookie",
  name: "CF_Authorization",
  description:
    "Owner-only Cloudflare Access session. The Worker also validates the Access JWT and owner allowlist.",
});

app.doc31("/api/v1/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Stacklet API",
    version: "1.0.0",
    description:
      "Private investment journal. All endpoints require the owner's Cloudflare Access session. Mutations require a same-origin JSON request, Idempotency-Key, and X-Dataset-Epoch, except read-only import validation.",
  },
  servers: [{ url: "/" }],
  security: [{ AccessSession: [] }],
});

app.get(
  "/api/v1/reference",
  Scalar({
    url: "/api/v1/openapi.json",
    pageTitle: "Stacklet API Reference",
    hideClientButton: true,
    telemetry: false,
    persistAuth: false,
    proxyUrl: "",
  }),
);

export type AppType = typeof routes;

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "ไม่พบ API ที่ร้องขอ",
        requestId: c.get("requestId"),
      },
    },
    404,
  ),
);

app.onError((error, c) => {
  const failure =
    error instanceof HTTPException && error.status === 400
      ? new ApiError(400, "VALIDATION_ERROR", "JSON ไม่ถูกต้อง")
      : error;

  const known = failure instanceof ApiError;
  const code = known ? failure.code : "INTERNAL_ERROR";

  console.error(JSON.stringify({ requestId: c.get("requestId"), code }));

  return c.json(
    {
      error: {
        code,
        message: known ? failure.message : "เกิดข้อผิดพลาด กรุณาลองใหม่",
        requestId: c.get("requestId"),
      },
    },
    known ? failure.status : 500,
  );
});

export default app;
