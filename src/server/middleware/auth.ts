import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../types";
import { ApiError } from "./errors";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const url = new URL(c.req.url);

  const local =
    c.env.APP_ENV === "local" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  if (!(local && c.env.DEV_AUTH_BYPASS === "true")) {
    if (
      !c.env.ACCESS_ISSUER ||
      !c.env.ACCESS_AUD ||
      !c.env.OWNER_EMAIL ||
      c.env.DEV_AUTH_BYPASS === "true"
    )
      throw new ApiError(403, "FORBIDDEN", "ยังไม่ได้ตั้งค่าการเข้าสู่ระบบ");

    const token = c.req.header("Cf-Access-Jwt-Assertion");

    if (!token) throw new ApiError(401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบอีกครั้ง");

    let email: unknown;

    try {
      const issuer = c.env.ACCESS_ISSUER.replace(/\/$/, "");
      let jwks = keySets.get(issuer);

      if (!jwks) {
        jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
        keySets.set(issuer, jwks);
      }

      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: c.env.ACCESS_AUD,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "email"],
      });

      email = payload.email;
    } catch {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
      );
    }

    if (
      typeof email !== "string" ||
      email.toLowerCase() !== c.env.OWNER_EMAIL.toLowerCase()
    )
      throw new ApiError(403, "FORBIDDEN", "บัญชีนี้ไม่มีสิทธิ์เข้าถึง");

    if (url.origin !== c.env.APP_ORIGIN)
      throw new ApiError(403, "FORBIDDEN", "ไม่อนุญาตให้เข้าผ่านที่อยู่นี้");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const expectedOrigin = local ? url.origin : c.env.APP_ORIGIN;

    if (
      c.req.header("Origin") !== expectedOrigin ||
      (!c.req.header("Content-Type")?.startsWith("application/json") &&
        c.req.method !== "DELETE")
    )
      throw new ApiError(403, "FORBIDDEN", "คำขอไม่ผ่านการตรวจสอบต้นทาง");

    const site = c.req.header("Sec-Fetch-Site");

    if (site && !["same-origin", "none"].includes(site))
      throw new ApiError(403, "FORBIDDEN", "คำขอไม่ผ่านการตรวจสอบต้นทาง");
  }

  await next();
});
