import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [action, environment] = process.argv.slice(2);

if (
  !["init", "deploy"].includes(action) ||
  !["staging", "production"].includes(environment)
)
  throw new Error(
    "Usage: node scripts/cloudflare.mjs init|deploy staging|production",
  );

const configPath = process.env.STACKLET_CONFIG ?? "wrangler.jsonc";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const target = config.env?.[environment];

if (!target) throw new Error(`Missing ${environment} configuration`);

const vars = target.vars ?? {};
const db = target.d1_databases?.find((d) => d.binding === "DB");

const validId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (
  !db ||
  !validId.test(db.database_id) ||
  /^0{8}|^11111111/.test(db.database_id)
)
  throw new Error(
    "Set a real remote D1 database ID before running this command",
  );

const other = config.env?.[
  environment === "staging" ? "production" : "staging"
]?.d1_databases?.find((d) => d.binding === "DB");

if (other?.database_id === db.database_id)
  throw new Error("Staging and production must use different D1 databases");

const args = ["--config", configPath, "--env", environment];

const run = (command, values, options = {}) =>
  execFileSync(command, values, { stdio: "inherit", ...options });

if (action === "init") {
  // Inspect before initialization; schema.sql is never used as a reset or deploy migration.
  const output = execFileSync(
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
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'",
      "--json",
    ],
    { encoding: "utf8" },
  );

  const rows = JSON.parse(output);

  if (rows.some((r) => r.results?.length))
    throw new Error(
      "Database is not empty. Refusing to initialize existing data; use a reviewed forward migration.",
    );

  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    ...args,
    "--file",
    "db/schema.sql",
  ]);
} else {
  const origin = new URL(vars.APP_ORIGIN ?? "https://example.invalid");

  if (
    vars.APP_ENV !== environment ||
    vars.DEV_AUTH_BYPASS !== "false" ||
    origin.protocol !== "https:" ||
    origin.hostname.endsWith(".invalid") ||
    !vars.OWNER_EMAIL ||
    vars.OWNER_EMAIL.endsWith(".invalid") ||
    !vars.ACCESS_AUD ||
    vars.ACCESS_AUD.includes("REPLACE") ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
      vars.ACCESS_ISSUER ?? "",
    )
  )
    throw new Error(
      "Set APP_ORIGIN, owner email, Access issuer/audience, and disable development bypass",
    );

  if (target.workers_dev !== false || target.preview_urls !== false)
    throw new Error("Disable workers.dev and preview URLs explicitly");

  if (
    !target.routes?.some(
      (r) =>
        typeof r === "object" &&
        r.custom_domain === true &&
        r.pattern === origin.hostname,
    )
  )
    throw new Error(
      "Configure the matching custom domain in the environment routes",
    );

  const secrets = JSON.parse(
    execFileSync("pnpm", ["exec", "wrangler", "secret", "list", ...args], {
      encoding: "utf8",
    }),
  );

  if (!secrets.some((s) => s.name === "IMPORT_SIGNING_SECRET"))
    throw new Error(
      "Set IMPORT_SIGNING_SECRET with wrangler secret put before deploy",
    );

  const runtimeEnv = {
    ...process.env,
    CLOUDFLARE_ENV: environment,
    STACKLET_CONFIG: configPath,
  };

  run("pnpm", ["check"], { env: runtimeEnv });
  run("pnpm", ["build"], { env: runtimeEnv });
  // Vite plugin writes the correct deployment configuration; do not assume output paths.
  run("pnpm", ["exec", "wrangler", "deploy"], { env: runtimeEnv });
}
