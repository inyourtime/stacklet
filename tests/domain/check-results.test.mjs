import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCheckSummary,
  formatDuration,
  readCheckMetrics,
  reportCheckResults,
} from "../../scripts/report-check-results.mjs";

const sha = "1234567890abcdef1234567890abcdef12345678";
const marker = "<!-- stacklet-check-results -->";
const directories = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function reports(files) {
  const directory = await mkdtemp(join(tmpdir(), "stacklet-ci-reports-"));
  directories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, value]) =>
      writeFile(
        join(directory, name),
        typeof value === "string" ? value : JSON.stringify(value),
      ),
    ),
  );

  return readCheckMetrics(directory);
}

function fixture() {
  return {
    context: {
      eventName: "pull_request",
      repo: { owner: "inyourtime", repo: "stacklet" },
      payload: {
        pull_request: {
          number: 1,
          head: { sha, repo: { full_name: "inyourtime/stacklet" } },
        },
      },
      sha: "merge-commit",
      serverUrl: "https://github.com",
      runId: 200,
      runAttempt: 1,
    },
    steps: Object.fromEntries(
      ["check", "unit", "integration", "e2e", "build"].map((id) => [
        id,
        { outcome: "success" },
      ]),
    ),
    status: "success",
    core: {
      summary: {
        addRaw: vi.fn().mockReturnThis(),
        write: vi.fn().mockResolvedValue(undefined),
      },
    },
    github: {
      rest: {
        pulls: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { state: "open", head: { sha } } }),
        },
        issues: {
          listComments: vi.fn(),
          createComment: vi.fn().mockResolvedValue({}),
          updateComment: vi.fn().mockResolvedValue({}),
        },
      },
      paginate: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("check result summary", () => {
  it("links the tested PR commit and run attempt with every check result", () => {
    const body = buildCheckSummary(fixture());

    expect(body).toContain("### Verification results: ✅ Passed");
    expect(body).toContain(`/commit/${sha}`);
    expect(body).not.toContain("merge-commit");
    expect(body).toContain("/actions/runs/200/attempts/1");
    expect(body).toContain("| TypeScript / lint / format | ✅ Passed |");
    expect(body).toContain("| E2E — desktop / mobile | ✅ Passed |");
    expect(body.match(/\| ✅ Passed \|/g)).toHaveLength(5);
    expect(body).not.toMatch(/[\u0E00-\u0E7F]/);
  });

  it("distinguishes failed, cancelled, and unrun steps", () => {
    const input = fixture();
    input.status = "failure";
    input.steps.unit.outcome = "failure";
    input.steps.integration.outcome = "cancelled";
    input.steps.e2e.outcome = "skipped";
    delete input.steps.build;
    const body = buildCheckSummary(input);

    expect(body).toContain("### Verification results: ❌ Failed");
    expect(body).toContain("| Unit tests | ❌ Failed |");
    expect(body).toContain("| Integration tests | ⏹️ Cancelled |");
    expect(body).toContain("| E2E — desktop / mobile | ⏭️ Skipped |");
    expect(body).toContain("| Build | ⏭️ Skipped |");
  });

  it("uses the branch commit in a non-PR job summary", () => {
    const input = fixture();
    delete input.context.payload.pull_request;
    input.context.sha = sha;

    expect(buildCheckSummary(input)).toContain(`/commit/${sha}`);
  });

  it("shows counts, command durations, totals, and flaky retries in English", () => {
    const input = fixture();
    input.status = "failure";
    input.steps.unit.outcome = "failure";
    input.steps.e2e.outcome = "failure";
    input.metrics = {
      check: { durationMs: 2200 },
      unit: { passed: 31, failed: 2, skipped: 1, durationMs: 1023 },
      integration: { passed: 36, failed: 0, skipped: 2, durationMs: 12500 },
      e2e: { passed: 28, failed: 1, skipped: 0, flaky: 1, durationMs: 64222 },
      build: { durationMs: 3500 },
    };
    const body = buildCheckSummary(input);

    expect(body).toContain("| Unit tests | ❌ Failed | 31 | 2 | 1 | 1.0s |");
    expect(body).toContain(
      "| E2E — desktop / mobile | ❌ Failed | 28 | 1 | 0 | 1m 4.2s |",
    );
    expect(body).toContain("| Build | ✅ Passed | — | — | — | 3.5s |");
    expect(body).toContain(
      "| **Reported test totals** | — | **95** | **3** | **3** | **1m 17.7s** |",
    );
    expect(body).toContain("Flaky E2E tests: **1**");
    expect(body).not.toMatch(/[\u0E00-\u0E7F]/);
  });

  it("keeps absent reports unknown rather than reporting zero passed or failed", () => {
    const body = buildCheckSummary(fixture());

    expect(body).toContain("| Unit tests | ✅ Passed | — | — | — | — |");
    expect(body).not.toContain("Reported test totals");
  });
});

describe("test reports and timings", () => {
  it("reads Vitest counts, includes todos as skipped, and counts flaky E2E tests once", async () => {
    const metrics = await reports({
      "unit.json": {
        numPassedTests: 10,
        numFailedTests: 2,
        numPendingTests: 1,
        numTodoTests: 2,
      },
      "integration.json": {
        numPassedTests: 3,
        numFailedTests: 0,
        numPendingTests: 0,
      },
      "e2e.json": {
        stats: { expected: 5, unexpected: 1, skipped: 2, flaky: 2 },
      },
      "unit-timing.json": { durationMs: 1234 },
      "e2e-timing.json": { durationMs: 60234 },
      "check-timing.json": { durationMs: 2000 },
    });

    expect(metrics.unit).toEqual({
      passed: 10,
      failed: 2,
      skipped: 3,
      flaky: 0,
      durationMs: 1234,
    });
    expect(metrics.integration).toMatchObject({
      passed: 3,
      failed: 0,
      skipped: 0,
    });
    expect(metrics.e2e).toEqual({
      passed: 7,
      failed: 1,
      skipped: 2,
      flaky: 2,
      durationMs: 60234,
    });
    expect(metrics.check).toEqual({ durationMs: 2000 });
    expect(metrics.build).toEqual({});
  });

  it("keeps missing and malformed reports unavailable without losing valid timings", async () => {
    const metrics = await reports({
      "unit.json": "invalid json",
      "unit-timing.json": { durationMs: 1000 },
      "integration-timing.json": { durationMs: -1 },
      "e2e.json": {
        stats: { expected: -1, unexpected: 0, skipped: 0, flaky: 0 },
      },
    });

    expect(metrics.unit).toEqual({ durationMs: 1000 });
    expect(metrics.integration).toEqual({});
    expect(metrics.e2e).toEqual({});
  });

  it.each([
    [0, "0.0s"],
    [1234, "1.2s"],
    [59999, "1m 0.0s"],
    [123456, "2m 3.5s"],
    [undefined, "—"],
    [-1, "—"],
    [NaN, "—"],
  ])("formats duration %s as %s", (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});

describe("PR check result comment", () => {
  it("creates the bot comment and publishes an Actions summary", async () => {
    const input = fixture();
    await reportCheckResults(input);

    expect(input.core.summary.write).toHaveBeenCalledOnce();
    expect(
      input.github.rest.issues.createComment,
    ).toHaveBeenCalledExactlyOnceWith({
      ...input.context.repo,
      issue_number: 1,
      body: buildCheckSummary(input),
    });
    expect(input.github.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing bot report, leaving human comments untouched", async () => {
    const input = fixture();
    input.github.paginate.mockResolvedValue([
      { id: 1, user: { login: "inyourtime" }, body: marker },
      { id: 2, user: { login: "github-actions[bot]" }, body: marker },
    ]);
    await reportCheckResults(input);

    expect(
      input.github.rest.issues.updateComment,
    ).toHaveBeenCalledExactlyOnceWith({
      ...input.context.repo,
      comment_id: 2,
      body: buildCheckSummary(input),
    });
    expect(input.github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it.each(["push", "fork"])(
    "only writes a job summary for %s runs",
    async (kind) => {
      const input = fixture();
      if (kind === "push") input.context.eventName = "push";
      else
        input.context.payload.pull_request.head.repo.full_name =
          "someone/stacklet";
      await reportCheckResults(input);

      expect(input.core.summary.write).toHaveBeenCalledOnce();
      expect(input.github.rest.pulls.get).not.toHaveBeenCalled();
      expect(input.github.rest.issues.createComment).not.toHaveBeenCalled();
    },
  );

  it.each([
    { state: "closed", head: { sha } },
    { state: "open", head: { sha: "newer-commit" } },
  ])(
    "does not post results for a closed PR or superseded commit: %j",
    async (current) => {
      const input = fixture();
      input.github.rest.pulls.get.mockResolvedValue({ data: current });
      await reportCheckResults(input);

      expect(input.github.paginate).not.toHaveBeenCalled();
      expect(input.github.rest.issues.createComment).not.toHaveBeenCalled();
    },
  );

  it.each(["201:1", "200:2"])(
    "does not overwrite newer run %s",
    async (run) => {
      const input = fixture();
      input.github.paginate.mockResolvedValue([
        {
          id: 2,
          user: { login: "github-actions[bot]" },
          body: `${marker}\n<!-- stacklet-check-run:${run} -->`,
        },
      ]);
      await reportCheckResults(input);

      expect(input.github.rest.issues.updateComment).not.toHaveBeenCalled();
      expect(input.github.rest.issues.createComment).not.toHaveBeenCalled();
    },
  );

  it("updates the comment when the same run is retried", async () => {
    const input = fixture();
    input.context.runAttempt = 2;
    input.github.paginate.mockResolvedValue([
      {
        id: 2,
        user: { login: "github-actions[bot]" },
        body: `${marker}\n<!-- stacklet-check-run:200:1 -->`,
      },
    ]);
    await reportCheckResults(input);

    expect(input.github.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("stacklet-check-run:200:2"),
      }),
    );
  });
});
