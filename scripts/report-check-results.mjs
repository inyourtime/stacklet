const marker = "<!-- stacklet-check-results -->";
const labels = {
  success: "✅ ผ่าน",
  failure: "❌ ไม่ผ่าน",
  cancelled: "⏹️ ยกเลิก",
  skipped: "⏭️ ไม่ได้รัน",
};
const checks = [
  ["check", "TypeScript / lint / format"],
  ["unit", "Unit tests"],
  ["integration", "Integration tests"],
  ["e2e", "E2E — desktop / mobile"],
  ["build", "Build"],
];

export function buildCheckSummary({ context, steps, status }) {
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const server = context.serverUrl ?? "https://github.com";
  const sha = context.payload.pull_request?.head.sha ?? context.sha;
  const runUrl = `${server}/${repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`;
  const rows = checks.map(
    ([id, name]) =>
      `| ${name} | ${labels[steps[id]?.outcome] ?? labels.skipped} |`,
  );

  return [
    marker,
    `<!-- stacklet-check-run:${context.runId}:${context.runAttempt} -->`,
    `### ผลตรวจสอบ: ${labels[status] ?? status}`,
    "",
    `Commit: [\`${sha.slice(0, 7)}\`](${server}/${repository}/commit/${sha}) · [ดู logs และ artifacts](${runUrl})`,
    "",
    "| รายการ | ผล |",
    "| --- | --- |",
    ...rows,
    "",
    "_อัปเดตคอมเมนต์นี้เมื่อ CI รันใหม่ ขั้นตอนที่ถูกข้ามจะแสดงว่าไม่ได้รัน_",
  ].join("\n");
}

export async function reportCheckResults({
  github,
  context,
  core,
  steps,
  status,
}) {
  const body = buildCheckSummary({ context, steps, status });

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
