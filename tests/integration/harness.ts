import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import app from "../../src/server";
import type { Bindings } from "../../src/server/types";

export async function harness() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-11-10",
      d1Databases: ["DB"],
    }),
  );

  const db = (await mf.getD1Database("DB")) as unknown as D1Database;

  const schema = (
    await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8")
  ).replace(/^--.*$/gm, "");

  const statements: string[] = [];
  let buffer = "";

  for (const line of schema.split("\n")) {
    buffer += line + "\n";

    const trigger = buffer.trimStart().startsWith("CREATE TRIGGER");

    if ((trigger ? /END;\s*$/ : /;\s*$/).test(buffer)) {
      statements.push(buffer.trim());
      buffer = "";
    }
  }

  try {
    await db.batch(statements.map((s) => db.prepare(s)));
  } catch (error) {
    await mf.dispose();
    throw error;
  }

  const env: Bindings = {
    DB: db,
    APP_ENV: "local",
    DEV_AUTH_BYPASS: "true",
    APP_ORIGIN: "http://localhost",
  };

  let epoch = (await db
    .prepare("SELECT dataset_epoch AS epoch FROM app_meta")
    .first<{ epoch: string }>())!.epoch;

  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
    bindings = env,
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
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      bindings,
    );

    const json = (await response.json()) as any;

    if (json.meta?.datasetEpoch) epoch = json.meta.datasetEpoch;

    return { status: response.status, json, headers: response.headers };
  };

  return { db, env, request, mf, epoch: () => epoch };
}
