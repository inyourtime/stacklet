import { describe, expect, it, vi } from "vitest";
import {
  buildCheckSummary,
  reportCheckResults,
} from "../../scripts/report-check-results.mjs";

const sha = "1234567890abcdef1234567890abcdef12345678";
const marker = "<!-- stacklet-check-results -->";

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

    expect(body).toContain("### ผลตรวจสอบ: ✅ ผ่าน");
    expect(body).toContain(`/commit/${sha}`);
    expect(body).not.toContain("merge-commit");
    expect(body).toContain("/actions/runs/200/attempts/1");
    expect(body).toContain("| TypeScript / lint / format | ✅ ผ่าน |");
    expect(body).toContain("| E2E — desktop / mobile | ✅ ผ่าน |");
    expect(body.match(/\| ✅ ผ่าน \|/g)).toHaveLength(5);
  });

  it("distinguishes failed, cancelled, and unrun steps", () => {
    const input = fixture();
    input.status = "failure";
    input.steps.unit.outcome = "failure";
    input.steps.integration.outcome = "cancelled";
    input.steps.e2e.outcome = "skipped";
    delete input.steps.build;
    const body = buildCheckSummary(input);

    expect(body).toContain("### ผลตรวจสอบ: ❌ ไม่ผ่าน");
    expect(body).toContain("| Unit tests | ❌ ไม่ผ่าน |");
    expect(body).toContain("| Integration tests | ⏹️ ยกเลิก |");
    expect(body).toContain("| E2E — desktop / mobile | ⏭️ ไม่ได้รัน |");
    expect(body).toContain("| Build | ⏭️ ไม่ได้รัน |");
  });

  it("uses the branch commit in a non-PR job summary", () => {
    const input = fixture();
    delete input.context.payload.pull_request;
    input.context.sha = sha;

    expect(buildCheckSummary(input)).toContain(`/commit/${sha}`);
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
