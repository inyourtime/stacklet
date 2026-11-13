import { expect, test, type Page } from "./fixtures";
import type { Summary } from "../../src/shared/contracts";
import { BTC_PRICE_URL } from "../../src/web/lib/btc-price";

const meta = { revision: 1, datasetEpoch: "btc-performance-preview" };
const summary: Summary = {
  month: "2026-11",
  totalPrincipalThb: "50000.00",
  investedThb: "20000.00",
  cashThb: "30000.00",
  monthPurchasesThb: "20000.00",
  monthPurchaseCount: 2,
  allocations: [
    { type: "btc", amountThb: "20000.00" },
    { type: "cash", amountThb: "30000.00" },
  ],
  cashAccounts: [],
  btc: {
    quantity: "0.01000000",
    targetBtc: null,
    remainingBtc: null,
    progressPercent: null,
    version: 1,
    updatedAt: "2026-11-11T12:00:00.000Z",
  },
};

async function mockPortfolio(page: Page, data = summary) {
  await page.route("**/api/v1/summary?*", (route) =>
    route.fulfill({ json: { data, meta } }),
  );
  await page.route("**/api/v1/transactions?*", (route) =>
    route.fulfill({ json: { data: { items: [], nextCursor: null }, meta } }),
  );
}

test("uses the default BTC quote across tabs and separate browser contexts", async ({
  page,
  context,
  newContext,
}) => {
  const otherTab = await context.newPage();
  const otherContext = await newContext();
  const otherDevice = await otherContext.newPage();

  for (const target of [page, otherTab, otherDevice]) {
    await mockPortfolio(target);
    await target.goto("/");
    const performance = target.getByRole("region", {
      name: "กำไร / ขาดทุน BTC",
    });

    await expect(performance.locator(".btc-valuation dd")).toHaveText([
      "฿20,000.00",
      "฿30,000.00",
      "฿3,000,000.00",
    ]);
    await expect(performance.locator(".btc-profit")).toHaveText(
      "+฿10,000.00(+50.00%)",
    );
  }
});

test("shows BTC profit, refreshes to a loss, and labels stale prices on failure", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await mockPortfolio(page);
  let price = "3000000.00000000";
  let fail = false;
  await page.route(BTC_PRICE_URL, (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { message: "Unavailable" } }
        : { json: { symbol: "BTCTHB", price } },
    ),
  );
  await page.goto("/");
  const performance = page.getByRole("region", { name: "กำไร / ขาดทุน BTC" });
  await expect(performance.locator(".btc-profit")).toHaveText(
    "+฿10,000.00(+50.00%)",
  );
  await expect(performance.locator(".btc-profit")).toHaveAttribute(
    "data-direction",
    "gain",
  );
  await expect(performance.locator(".btc-valuation dd")).toHaveText([
    "฿20,000.00",
    "฿30,000.00",
    "฿3,000,000.00",
  ]);
  await expect(page.locator(".principal-amount")).toContainText("50,000.00");
  await performance.screenshot({ path: testInfo.outputPath("btc-profit.png") });

  price = "1500000.00000000";
  await page.clock.fastForward(60_000);
  await expect(performance.locator(".btc-profit")).toHaveText(
    "฿-5,000.00(-25.00%)",
  );
  await expect(performance.locator(".btc-profit")).toHaveAttribute(
    "data-direction",
    "loss",
  );
  await page.getByRole("button", { name: "ใช้โหมดมืด", exact: true }).click();
  await performance.screenshot({
    path: testInfo.outputPath("btc-loss-dark.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  fail = true;
  await page.clock.fastForward(60_000);
  await expect(performance).toContainText(
    "อัปเดตราคาไม่สำเร็จ กำลังแสดงราคาครั้งล่าสุด",
  );
  await expect(performance.locator(".btc-profit")).toContainText("฿-5,000.00");
  await expect(performance.locator(".btc-price-note")).toContainText("อัปเดต");
  fail = false;
  price = "2000000.00000000";
  await performance.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(performance.locator(".btc-profit")).toHaveText("฿0.00(0.00%)");
  await expect(performance.locator(".btc-price-error")).toHaveCount(0);
});

test("handles initial failure, retry, and hides personal profit amounts and percentages", async ({
  page,
}) => {
  await mockPortfolio(page);
  let fail = true;
  await page.route(BTC_PRICE_URL, (route) =>
    route.fulfill({
      json: fail
        ? { symbol: "BTCUSDT", price: "3000000" }
        : { symbol: "BTCTHB", price: "3000000" },
    }),
  );
  await page.goto("/");
  const performance = page.getByRole("region", { name: "กำไร / ขาดทุน BTC" });
  await expect(performance).toContainText("ไม่สามารถโหลดราคา BTC ได้ในขณะนี้");
  await expect(performance.locator(".btc-profit strong")).toHaveText("—");
  await expect(performance.locator(".btc-valuation dd")).toHaveText([
    "฿20,000.00",
    "—",
    "—",
  ]);
  fail = false;
  await performance.getByRole("button", { name: "ลองใหม่" }).click();
  await expect(performance.locator(".btc-profit")).toContainText("+50.00%");
  await page.getByRole("button", { name: "ซ่อนจำนวนเงิน", exact: true }).click();
  await expect(performance.locator(".btc-profit")).toHaveText(
    "฿••••••(••••••)",
  );
  await expect(performance.locator(".btc-profit")).toHaveAttribute(
    "data-direction",
    "neutral",
  );
  await expect(performance.locator(".btc-valuation dd")).toHaveText([
    "฿••••••",
    "฿••••••",
    "฿••••••",
  ]);
  await page.reload();
  await expect(performance.locator(".btc-profit")).toHaveText(
    "฿••••••(••••••)",
  );
  await page.getByRole("button", { name: "แสดงจำนวนเงิน", exact: true }).click();
  await expect(performance.locator(".btc-profit")).toHaveText(
    "+฿10,000.00(+50.00%)",
  );
});

test("shows zero without a percentage for an empty BTC portfolio", async ({
  page,
}) => {
  await mockPortfolio(page, {
    ...summary,
    allocations: summary.allocations.map((allocation) => ({
      ...allocation,
      amountThb: "0.00",
    })),
    btc: { ...summary.btc, quantity: "0.00000000" },
  });
  await page.route(BTC_PRICE_URL, (route) =>
    route.fulfill({
      json: { symbol: "BTCTHB", price: "3000000.00000000" },
    }),
  );
  await page.goto("/");
  const performance = page.getByRole("region", { name: "กำไร / ขาดทุน BTC" });
  await expect(performance.locator(".btc-profit")).toHaveText("฿0.00");
  await expect(performance.locator(".btc-profit")).toHaveAttribute(
    "data-direction",
    "neutral",
  );
  await expect(performance).not.toContainText(/NaN|Infinity/);
});
