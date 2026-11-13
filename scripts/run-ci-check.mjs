import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [id, command, ...args] = process.argv.slice(2);

if (!id || !/^[a-z][a-z0-9-]*$/.test(id) || !command)
  throw new Error(
    "Usage: node scripts/run-ci-check.mjs <id> <command> [args...]",
  );

const directory = ".ci-results";
mkdirSync(directory, { recursive: true });
rmSync(join(directory, `${id}.json`), { force: true });

const start = performance.now();
const result = spawnSync(command, args, { stdio: "inherit" });

writeFileSync(
  join(directory, `${id}-timing.json`),
  JSON.stringify({ durationMs: performance.now() - start }),
);

if (result.error) console.error(result.error.message);

process.exit(result.status ?? 1);
