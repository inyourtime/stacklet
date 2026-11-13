import { expect, test } from "./fixtures";

test("records, filters, edits and deletes gold purchases", async ({
  page,
}, testInfo) => {
  const assetName = `ทองคำแท่ง ${testInfo.project.name}`;
  await page.goto("/transactions");
  await page.getByRole("button", { name: "เพิ่มรายการซื้อ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ประเภทสินทรัพย์", { exact: true }).click();
  await page.getByRole("option", { name: "ทองคำ", exact: true }).click();
  await expect(
    dialog.getByLabel("จำนวน BTC ที่ได้รับจริง", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("ชื่อหรือสัญลักษณ์สินทรัพย์", { exact: true }).fill(assetName);
  await dialog
    .getByLabel("เงินต้นที่จ่ายจริง (บาท)", { exact: true })
    .fill("10000.25");
  await dialog.getByLabel("แหล่งเงิน", { exact: true }).click();
  await page
    .getByRole("option", { name: "เงินใหม่จากภายนอก", exact: true })
    .click();
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();

  const filters = page.getByRole("group", {
    name: "ประเภทสินทรัพย์",
    exact: true,
  });
  await filters.getByRole("button", { name: "ทองคำ", exact: true }).click();
  await expect(
    filters.getByRole("button", { name: "ทองคำ", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("ค้นหาชื่อสินทรัพย์", { exact: true }).fill(assetName);
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: `แก้ไข ${assetName}`, exact: true }),
  });
  await expect(row).toContainText("ทองคำ");
  await expect(row).toContainText("10,000.25");
  await expect(row.locator(".asset-symbol.gold")).toHaveCSS(
    "color",
    "rgb(163, 138, 22)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.reload();
  await page
    .getByRole("button", { name: `แก้ไข ${assetName}`, exact: true })
    .click();
  await expect(
    dialog.getByLabel("ประเภทสินทรัพย์", { exact: true }),
  ).toContainText("ทองคำ");
  await dialog
    .getByLabel("เงินต้นที่จ่ายจริง (บาท)", { exact: true })
    .fill("5000.10");
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("5,000.10");
  await page
    .getByRole("button", { name: `ลบ ${assetName}`, exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยันการลบ", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
});
