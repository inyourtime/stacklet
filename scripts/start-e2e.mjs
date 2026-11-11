import { rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";

rmSync(".wrangler/e2e", { recursive: true, force: true });

execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--env",
    "e2e",
    "--persist-to",
    ".wrangler/e2e",
    "--file",
    "db/schema.sql",
  ],
  { stdio: "pipe" },
);

const child = spawn(
  "pnpm",
  ["exec", "vite", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_ENV: "e2e", STACKLET_E2E: "1" },
  },
);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));

child.on("exit", (code) => process.exit(code ?? 1));
