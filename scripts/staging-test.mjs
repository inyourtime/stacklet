import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const configPath =
  process.env.STACKLET_TEST_CONFIG ?? "wrangler.integration.local.json";

let config;

try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  throw new Error(
    "Copy wrangler.integration.example.json to wrangler.integration.local.json and configure a dedicated test D1 first",
  );
}

const database = config.d1_databases?.find((d) => d.binding === "DB");

if (
  !config.name?.startsWith("stacklet-integration-") ||
  !database?.database_name?.startsWith("stacklet-integration-") ||
  config.vars?.TEST_DATABASE_NAME !== database.database_name ||
  !/^[0-9a-f-]{36}$/i.test(database.database_id)
)
  throw new Error(
    "Remote tests require a dedicated stacklet-integration-* Worker and D1 database",
  );

const main = JSON.parse(
  readFileSync(process.env.STACKLET_CONFIG ?? "wrangler.jsonc", "utf8"),
);

if (
  Object.values(main.env ?? {}).some((e) =>
    e.d1_databases?.some((d) => d.database_id === database.database_id),
  )
)
  throw new Error(
    "Refusing to run against a staging/production application database",
  );

const token = process.env.STACKLET_TEST_TOKEN;
const origin = process.env.STACKLET_TEST_ORIGIN;

if (!token || token.length < 32 || !origin?.startsWith("https://"))
  throw new Error(
    "Set STACKLET_TEST_TOKEN (matching TEST_RUNNER_SECRET) and STACKLET_TEST_ORIGIN",
  );

const args = ["--config", configPath];

const secrets = JSON.parse(
  execFileSync("pnpm", ["exec", "wrangler", "secret", "list", ...args], {
    encoding: "utf8",
  }),
);

if (!secrets.some((s) => s.name === "TEST_RUNNER_SECRET"))
  throw new Error("Set TEST_RUNNER_SECRET with wrangler secret put first");

const rows = JSON.parse(
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      ...args,
      "--command",
      "SELECT name FROM sqlite_master WHERE name='app_meta'",
      "--json",
    ],
    { encoding: "utf8" },
  ),
);

if (!rows.some((r) => r.results?.length))
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      ...args,
      "--file",
      "db/schema.sql",
    ],
    { stdio: "inherit" },
  );

execFileSync("pnpm", ["exec", "wrangler", "deploy", ...args], {
  stdio: "inherit",
});

const response = await fetch(`${origin.replace(/\/$/, "")}/run`, {
  method: "POST",
  headers: { "X-Test-Token": token },
});

const result = await response.json();

console.log(JSON.stringify(result, null, 2));

if (!response.ok || result.failed) process.exitCode = 1;
