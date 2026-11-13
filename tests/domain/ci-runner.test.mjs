import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("../../scripts/run-ci-check.mjs", import.meta.url),
);
const directories = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.each([
  ["unit", 0],
  ["unit", 7],
  ["e2e", 0],
])(
  "preserves %s exit code %i and records elapsed time",
  async (id, code) => {
    const directory = await mkdtemp(join(tmpdir(), "stacklet-ci-runner-"));
    directories.push(directory);
    await mkdir(join(directory, ".ci-results"));
    await writeFile(
      join(directory, `.ci-results/${id}.json`),
      '{"stale":true}',
    );
    const result = spawnSync(
      process.execPath,
      [runner, id, process.execPath, "-e", `process.exit(${code})`],
      { cwd: directory },
    );

    expect(result.status).toBe(code);
    const timing = JSON.parse(
      await readFile(join(directory, `.ci-results/${id}-timing.json`), "utf8"),
    );
    expect(Number.isFinite(timing.durationMs)).toBe(true);
    expect(timing.durationMs).toBeGreaterThanOrEqual(0);
    await expect(
      readFile(join(directory, `.ci-results/${id}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("reports command startup failures as failures while recording time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stacklet-ci-runner-"));
  directories.push(directory);
  const result = spawnSync(
    process.execPath,
    [runner, "unit", "stacklet-command-that-does-not-exist"],
    { cwd: directory },
  );

  expect(result.status).toBe(1);
  expect(
    JSON.parse(
      await readFile(join(directory, ".ci-results/unit-timing.json"), "utf8"),
    ),
  ).toHaveProperty("durationMs");
});
