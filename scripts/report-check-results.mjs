import { readFile } from "node:fs/promises";
import { join } from "node:path";

const marker = "<!-- stacklet-check-results -->";
const labels = {
  success: "✅ Passed",
  failure: "❌ Failed",
  cancelled: "⏹️ Cancelled",
  skipped: "⏭️ Skipped",
};
const checks = [
  ["check", "TypeScript / lint / format"],
  ["unit", "Unit tests"],
  ["integration", "Integration tests"],
  ["e2e", "E2E — desktop / mobile"],
  ["build", "Build"],
];

const testIds = ["unit", "integration", "e2e"];
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readCheckMetrics(directory = ".ci-results") {
  const entries = await Promise.all(
    checks.map(async ([id]) => {
      const timing = await readJson(join(directory, `${id}-timing.json`));
      const metric = {};

      if (Number.isFinite(timing?.durationMs) && timing.durationMs >= 0)
        metric.durationMs = timing.durationMs;

      if (testIds.includes(id)) {
        const report = await readJson(join(directory, `${id}.json`));
        const counts =
          id === "e2e"
            ? {
                passed: report?.stats?.expected,
                failed: report?.stats?.unexpected,
                skipped: report?.stats?.skipped,
                flaky: report?.stats?.flaky,
              }
            : {
                passed: report?.numPassedTests,
                failed: report?.numFailedTests,
                skipped:
                  (report?.numPendingTests ?? NaN) +
                  (report?.numTodoTests ?? 0),
                flaky: 0,
              };

        if (Object.values(counts).every(validCount)) {
          Object.assign(metric, counts);
          // Playwright's flaky category passed after a retry; count each test once.
          metric.passed += metric.flaky;
        }
      }

      return [id, metric];
    }),
  );

  return Object.fromEntries(entries);
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";

  const tenths = Math.round(durationMs / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1);

  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function buildCheckSummary({ context, steps, status, metrics = {} }) {
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const server = context.serverUrl ?? "https://github.com";
  const sha = context.payload.pull_request?.head.sha ?? context.sha;
  const runUrl = `${server}/${repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`;
  const rows = checks.map(([id, name]) => {
    const metric = metrics[id] ?? {};
    const count = (key) => metric[key] ?? "—";

    return `| ${name} | ${labels[steps[id]?.outcome] ?? labels.skipped} | ${count("passed")} | ${count("failed")} | ${count("skipped")} | ${formatDuration(metric.durationMs)} |`;
  });
  const reported = testIds
    .map((id) => metrics[id])
    .filter((metric) => validCount(metric?.passed));

  if (reported.length) {
    const sum = (key) =>
      reported.reduce((total, metric) => total + metric[key], 0);
    const duration = reported.every((metric) =>
      Number.isFinite(metric.durationMs),
    )
      ? sum("durationMs")
      : undefined;

    rows.push(
      `| **Reported test totals** | — | **${sum("passed")}** | **${sum("failed")}** | **${sum("skipped")}** | **${formatDuration(duration)}** |`,
    );
  }
  const flaky = metrics.e2e?.flaky ?? 0;

  return [
    marker,
    `<!-- stacklet-check-run:${context.runId}:${context.runAttempt} -->`,
    `### Verification results: ${labels[status] ?? status}`,
    "",
    `Commit: [\`${sha.slice(0, 7)}\`](${server}/${repository}/commit/${sha}) · [View logs and artifacts](${runUrl})`,
    "",
    "| Check | Status | Passed | Failed | Skipped | Duration |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    ...(flaky
      ? [
          ``,
          `Flaky E2E tests: **${flaky}** (passed after retry; included in Passed).`,
        ]
      : []),
    "_Durations are command wall-clock times. Totals include reported test suites only; check/build counts and unavailable data are shown as —._",
    "_This comment is updated on each CI run._",
  ].join("\n");
}

export async function reportCheckResults({
  github,
  context,
  core,
  steps,
  status,
  metrics = {},
}) {
  const body = buildCheckSummary({ context, steps, status, metrics });

  await core.summary.addRaw(body).write();

  const pr = context.payload.pull_request;
  const repository = `${context.repo.owner}/${context.repo.repo}`;

  // Fork pull requests have read-only tokens; still publish their job summary.
  if (
    context.eventName !== "pull_request" ||
    pr?.head.repo.full_name !== repository
  )
    return;

  const { data: current } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: pr.number,
  });

  // An older run must not overwrite the result for a newer commit.
  if (current.state !== "open" || current.head.sha !== pr.head.sha) return;

  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.includes(marker),
  );
  const previous = existing?.body?.match(
    /<!-- stacklet-check-run:(\d+):(\d+) -->/,
  );

  if (
    previous &&
    (Number(previous[1]) > context.runId ||
      (Number(previous[1]) === context.runId &&
        Number(previous[2]) > context.runAttempt))
  )
    return;

  if (existing) {
    await github.rest.issues.updateComment({
      ...context.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      ...context.repo,
      issue_number: pr.number,
      body,
    });
  }
}
