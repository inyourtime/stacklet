import { test, expect, type Page } from "./fixtures";
import type {
  Envelope,
  Summary,
  Transaction,
} from "../../src/shared/contracts";

const timestamp = "2026-11-11T12:00:00.000Z";
const meta = { revision: 1, datasetEpoch: "chart-preview" };

const summary: Summary = {
  month: "2026-11",
  totalPrincipalThb: "100000.00",
  investedThb: "50000.00",
  cashThb: "50000.00",
  monthPurchasesThb: "50000.00",
  monthPurchaseCount: 3,
  allocations: [
    { type: "stock", amountThb: "25000.00" },
    { type: "fund", amountThb: "15000.00" },
    { type: "btc", amountThb: "10000.00" },
    { type: "gold", amountThb: "0.00" },
    { type: "cash", amountThb: "50000.00" },
  ],
  cashAccounts: [
    {
      id: "22222222-2222-4222-a222-222222222222",
      name: "เงินลงทุน",
      currency: "THB",
      balanceThb: "50000.00",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  btc: {
    quantity: "0.00300000",
    targetBtc: null,
    remainingBtc: null,
    progressPercent: null,
    version: 1,
    updatedAt: timestamp,
  },
};

async function showDashboard(page: Page, data: Summary) {
  const response: Envelope<Summary> = { data, meta };

  // Keep chart fixtures separate from the user's database and the ledger E2E flow.
  await page.route("**/api/v1/summary?*", (route) =>
    route.fulfill({ json: response }),
  );
  await page.route("**/api/v1/transactions?*", (route) =>
    route.fulfill({ json: { data: { items: [], nextCursor: null }, meta } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "กราฟวงกลมสัดส่วนเงินต้น" }),
  ).toBeVisible();
}

test("shows allocation amounts and lets pointer and keyboard select a category", async ({
  page,
}, testInfo) => {
  await showDashboard(page, summary);

  const chart = page.locator(".allocation-section");
  const stock = chart.getByRole("button", {
    name: "หุ้น 25,000.00 บาท สัดส่วน 25.0%",
    exact: true,
  });
  const fund = chart.getByRole("button", {
    name: "กองทุน 15,000.00 บาท สัดส่วน 15.0%",
    exact: true,
  });

  await expect(chart.locator(".donut-center")).toContainText("100%");

  const ring = chart.getByRole("img");
  await ring.scrollIntoViewIfNeeded();
  const bounds = await ring.boundingBox();
  if (!bounds) throw new Error("Allocation chart has no visible bounds");

  // Hit the painted middle of each slice, rather than the legend or an SVG bounding box.
  for (const target of [
    {
      x: 0.776,
      y: 0.224,
      label: "หุ้น",
      percentage: "25.0%",
      amount: "25,000.00",
    },
    {
      x: 0.847,
      y: 0.677,
      label: "กองทุน",
      percentage: "15.0%",
      amount: "15,000.00",
    },
    {
      x: 0.621,
      y: 0.871,
      label: "Bitcoin",
      percentage: "10.0%",
      amount: "10,000.00",
    },
    {
      x: 0.11,
      y: 0.5,
      label: "เงินสด",
      percentage: "50.0%",
      amount: "50,000.00",
    },
  ]) {
    await page.mouse.move(
      bounds.x + bounds.width * target.x,
      bounds.y + bounds.height * target.y,
    );
    await expect(chart.locator(".donut-center")).toContainText(target.label);
    await expect(chart.locator(".donut-center")).toContainText(
      target.percentage,
    );
    await expect(chart.locator(".donut-center")).toContainText(target.amount);
    await expect(chart.locator(".allocation-list .is-active")).toContainText(
      target.label,
    );
  }

  await chart.screenshot({ path: testInfo.outputPath("allocation-hover.png") });

  // Taking a section screenshot can scroll the mobile viewport; use its current position.
  const currentBounds = await ring.boundingBox();
  if (!currentBounds) throw new Error("Allocation chart is no longer visible");

  await page.mouse.move(
    currentBounds.x + currentBounds.width / 2,
    currentBounds.y + currentBounds.height / 2,
  );
  await expect(chart.locator(".donut-center")).toContainText("100%");

  await stock.click();
  await expect(stock).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".donut-center")).toContainText("25.0%");
  await fund.focus();
  await fund.press("Enter");
  await expect(fund).toHaveAttribute("aria-pressed", "true");
  await expect(stock).toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator(".donut-center")).toContainText("15.0%");
  await expect(page.locator(".principal-amount")).toContainText("100,000.00");
  await expect(
    chart.getByRole("button", {
      name: "เงินสด 50,000.00 บาท สัดส่วน 50.0%",
      exact: true,
    }),
  ).toBeVisible();
  await expect(chart.getByRole("img")).toHaveAccessibleDescription(
    /หุ้น 25\.0 เปอร์เซ็นต์.*กองทุน 15\.0 เปอร์เซ็นต์.*Bitcoin 10\.0 เปอร์เซ็นต์.*เงินสด 50\.0 เปอร์เซ็นต์/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await chart.screenshot({ path: testInfo.outputPath("allocation-chart.png") });

  // The month picker scopes purchase activity; the current portfolio stays visible.
  await page.route("**/api/v1/summary?month=2026-10", (route) =>
    route.fulfill({
      json: {
        data: {
          ...summary,
          month: "2026-10",
          monthPurchasesThb: "700.00",
          monthPurchaseCount: 1,
        },
        meta,
      },
    }),
  );
  await page.getByLabel("เดือนรายงาน", { exact: true }).fill("2026-10");
  await expect(page.locator(".monthly-purchases")).toContainText("฿700.00");
  await expect(page.locator(".monthly-purchases")).toContainText(
    "จาก 1 รายการซื้อ",
  );
  await expect(page.locator(".principal-amount")).toContainText("100,000.00");
  await expect(page.locator(".metric-strip")).toContainText("เงินที่ลงทุนแล้ว");
  await expect(page.locator(".metric-strip")).toContainText("เงินสดคงเหลือ");
});

test("shows a neutral empty chart when the portfolio has no money", async ({
  page,
}) => {
  await showDashboard(page, {
    ...summary,
    totalPrincipalThb: "0.00",
    investedThb: "0.00",
    cashThb: "0.00",
    monthPurchasesThb: "0.00",
    monthPurchaseCount: 0,
    allocations: summary.allocations.map((allocation) => ({
      ...allocation,
      amountThb: "0.00",
    })),
    cashAccounts: [],
    btc: { ...summary.btc, quantity: "0.00000000" },
  });

  const chart = page.locator(".allocation-section");

  await expect(chart.locator(".donut-center")).toContainText("ยังไม่มีข้อมูล");
  await expect(chart.locator(".donut-center")).toContainText("0%");
  await expect(chart.getByRole("img")).toHaveAccessibleDescription(
    "ยังไม่มีเงินต้นสำหรับแสดงสัดส่วน",
  );
  for (const category of ["หุ้น", "กองทุน", "Bitcoin", "ทองคำ", "เงินสด"]) {
    await expect(
      chart.getByRole("button", {
        name: `${category} 0.00 บาท สัดส่วน 0.0%`,
        exact: true,
      }),
    ).toBeDisabled();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a full ring can be inspected from either side and tapped directly", async ({
  page,
}, testInfo) => {
  await showDashboard(page, {
    ...summary,
    investedThb: "0.00",
    cashThb: "100000.00",
    allocations: summary.allocations.map((allocation) => ({
      ...allocation,
      amountThb: allocation.type === "cash" ? "100000.00" : "0.00",
    })),
    cashAccounts: summary.cashAccounts.map((account) => ({
      ...account,
      balanceThb: "100000.00",
    })),
    btc: { ...summary.btc, quantity: "0.00000000" },
  });

  const chart = page.locator(".allocation-section");
  const ring = chart.getByRole("img");
  await ring.scrollIntoViewIfNeeded();
  const bounds = await ring.boundingBox();
  if (!bounds) throw new Error("Allocation chart has no visible bounds");

  const left = {
    x: bounds.x + bounds.width * 0.11,
    y: bounds.y + bounds.height * 0.5,
  };
  const right = { x: bounds.x + bounds.width * 0.89, y: left.y };
  await page.mouse.move(left.x, left.y);
  await expect(chart.locator(".donut-center")).toContainText("เงินสด");
  await expect(chart.locator(".donut-center")).toContainText("100.0%");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(chart.locator(".donut-center")).toContainText("เงินต้นรวม");

  if (testInfo.project.name === "mobile")
    await page.touchscreen.tap(right.x, right.y);
  else await page.mouse.click(right.x, right.y);

  await expect(
    chart.getByRole("button", {
      name: "เงินสด 100,000.00 บาท สัดส่วน 100.0%",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".donut-center")).toContainText("100,000.00");
});

test("hides amounts across pages and chart labels, remembers on reload and syncs tabs", async ({
  page,
  context,
}, testInfo) => {
  const data: Summary = {
    ...summary,
    btc: {
      ...summary.btc,
      targetBtc: "1.00000000",
      remainingBtc: "0.99700000",
      progressPercent: 0.3,
    },
  };
  const purchase: Transaction = {
    id: "33333333-3333-4333-a333-333333333333",
    assetType: "btc",
    assetName: "BTC",
    tradeDate: "2026-11-11",
    amountThb: "10000.00",
    btcQuantity: "0.00300000",
    cashAccountId: data.cashAccounts[0].id,
    note: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await showDashboard(page, data);
  await page.route("**/api/v1/cash-accounts", (route) =>
    route.fulfill({ json: { data: data.cashAccounts, meta } }),
  );
  await page.route("**/api/v1/transactions?*", (route) =>
    route.fulfill({
      json: { data: { items: [purchase], nextCursor: null }, meta },
    }),
  );

  const other = await context.newPage();
  await showDashboard(other, data);
  const toggle = page.getByRole("button", { name: "ซ่อนจำนวนเงิน", exact: true });
  await expect(page.locator(".principal-amount")).toContainText("100,000.00");
  await toggle.focus();
  await toggle.press("Enter");
  await expect(
    page.getByRole("button", { name: "แสดงจำนวนเงิน", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".principal-amount")).toContainText("••••••");
  await expect(other.locator(".principal-amount")).toContainText("••••••");
  await expect(page.locator(".metric-strip")).not.toContainText(
    /\d[\d,]*\.\d{2}/,
  );
  await expect(page.locator(".monthly-total strong")).toHaveText("฿••••••");
  await expect(page.locator(".btc-section")).not.toContainText(/\d\.\d{8}/);
  await expect(page.locator(".btc-section")).toContainText("0.3%");

  const chart = page.locator(".allocation-section");
  const stock = chart.getByRole("button", {
    name: "หุ้น •••••• บาท สัดส่วน 25.0%",
    exact: true,
  });
  await stock.click();
  await expect(chart.locator(".donut-center")).toContainText("••••••");
  await expect(chart.locator(".donut-center")).toContainText("25.0%");
  await expect(chart.getByRole("img")).toHaveAccessibleDescription(
    /จำนวน •••••• บาท/,
  );
  expect(await chart.innerHTML()).not.toMatch(/\d,\d{3}\.\d{2}/);

  await page.reload();
  await expect(page.locator(".principal-amount")).toContainText("••••••");
  await page.getByRole("link", { name: "บัญชีเงินสด", exact: true }).click();
  await expect(page.locator(".account-value")).toHaveText("฿••••••");
  await page.getByRole("link", { name: "รายการซื้อ", exact: true }).click();
  await expect(page.locator("tbody .numeric")).toHaveText(["••••••", "••••••"]);
  await page.getByRole("button", { name: "ลบ BTC", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("฿••••••");
  await expect(page.getByRole("alertdialog")).not.toContainText("10,000.00");
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();

  await other
    .getByRole("button", { name: "แสดงจำนวนเงิน", exact: true })
    .click();
  await expect(page.locator("tbody .numeric")).toHaveText([
    "10,000.00",
    "0.00300000",
  ]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ซ่อนจำนวนเงิน", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "ซ่อนจำนวนเงิน", exact: true }).click();
  await page.getByRole("link", { name: "ภาพรวม", exact: true }).click();
  await expect(page.locator(".principal-amount")).toContainText("••••••");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("hidden-amounts.png"),
    fullPage: true,
  });
  await other.close();
});

test("amount toggle remains usable when browser storage is blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
      });
    }
  });
  await showDashboard(page, summary);
  await page.getByRole("button", { name: "ซ่อนจำนวนเงิน", exact: true }).click();
  await expect(page.locator(".principal-amount")).toContainText("••••••");
  await page.getByRole("button", { name: "แสดงจำนวนเงิน", exact: true }).click();
  await expect(page.locator(".principal-amount")).toContainText("100,000.00");
});

test("theme follows the device, remembers an explicit choice and syncs tabs", async ({
  page,
  context,
}, testInfo) => {
  const root = page.locator("html");

  await page.emulateMedia({ colorScheme: "dark" });
  await showDashboard(page, summary);
  await expect(root).toHaveClass(/dark/);
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(root).toHaveCSS("background-color", "rgb(20, 28, 24)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveClass(/dark/);

  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "dark" });
  await showDashboard(other, summary);
  await page.getByRole("button", { name: "ใช้โหมดสว่าง", exact: true }).click();
  await expect(root).not.toHaveClass(/dark/);
  await expect(other.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ใช้โหมดมืด", exact: true }),
  ).toBeVisible();
  await expect(root).toHaveCSS("color-scheme", "light");
  await expect(root).toHaveCSS("background-color", "rgb(250, 251, 249)");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: "ใช้โหมดมืด", exact: true }).click();
  await expect(other.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "ใช้โหมดสว่าง", exact: true }),
  ).toBeVisible();
  await expect(root).toHaveClass(/dark/);
  await expect(page.locator(".principal-amount")).toContainText("100,000.00");
  await page.screenshot({
    path: testInfo.outputPath("dark-dashboard.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "บันทึกการซื้อ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("background-color", "rgb(27, 37, 31)");
  await dialog.getByLabel("ประเภทสินทรัพย์", { exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCSS(
    "background-color",
    "rgb(27, 37, 31)",
  );
  await page.screenshot({
    path: testInfo.outputPath("dark-form.png"),
    animations: "disabled",
  });
  await page.getByRole("option", { name: "Bitcoin", exact: true }).click();
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.getByRole("link", { name: "ตั้งค่า", exact: true }).click();
  await expect(page.locator(".upload-zone")).toHaveCSS(
    "background-color",
    "rgb(32, 46, 36)",
  );
  await page.screenshot({
    path: testInfo.outputPath("dark-settings.png"),
    animations: "disabled",
  });
  await other.close();
});

test("theme bootstrap and toggle work when storage is blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
      });
    }
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await showDashboard(page, summary);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "ใช้โหมดสว่าง", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "ใช้โหมดมืด", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("shows gold allocation in light and dark themes", async ({
  page,
}, testInfo) => {
  await showDashboard(page, {
    ...summary,
    allocations: [
      { type: "stock", amountThb: "25000.00" },
      { type: "fund", amountThb: "10000.00" },
      { type: "btc", amountThb: "5000.00" },
      { type: "gold", amountThb: "10000.00" },
      { type: "cash", amountThb: "50000.00" },
    ],
  });
  const chart = page.locator(".allocation-section");
  const gold = chart.getByRole("button", {
    name: "ทองคำ 10,000.00 บาท สัดส่วน 10.0%",
    exact: true,
  });
  await gold.click();
  await expect(gold).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".donut-center")).toContainText("ทองคำ");
  await expect(chart.locator(".donut-center")).toContainText("10.0%");
  await expect(chart.locator(".donut-center")).toContainText("10,000.00");
  await expect(chart.locator("path.gold")).toHaveCSS(
    "fill",
    "rgb(163, 138, 22)",
  );
  await chart.screenshot({
    path: testInfo.outputPath("gold-allocation-light.png"),
  });
  await page.getByRole("button", { name: "ใช้โหมดมืด", exact: true }).click();
  await expect(chart.locator("path.gold")).toHaveCSS(
    "fill",
    "rgb(220, 201, 92)",
  );
  await chart.screenshot({
    path: testInfo.outputPath("gold-allocation-dark.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
