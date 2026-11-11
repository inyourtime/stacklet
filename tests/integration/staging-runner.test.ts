import { afterEach, beforeEach, expect, it } from "vitest";
import { harness } from "./harness";
import runner from "./staging-worker";

let h: Awaited<ReturnType<typeof harness>>;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h?.mf.dispose();
});

it("runs the remote acceptance harness against local D1 before deployment", async () => {
  const secret = "only-test-secret-not-a-real-credential-12345";

  const env = {
    DB: h.db,
    TEST_RUNNER_SECRET: secret,
    TEST_DATABASE_NAME: "stacklet-integration-tests",
  };

  expect(
    (
      await runner.fetch(
        new Request("https://test.example/run", { method: "POST" }),
        env,
      )
    ).status,
  ).toBe(403);

  const response = await runner.fetch(
    new Request("https://test.example/run", {
      method: "POST",
      headers: { "X-Test-Token": secret },
    }),
    env,
  );

  const result = (await response.json()) as {
    failed: number;
    passed: string[];
  };

  expect(result.failed).toBe(0);
  expect(result.passed.length).toBeGreaterThanOrEqual(9);
  expect(response.status).toBe(200);
});
