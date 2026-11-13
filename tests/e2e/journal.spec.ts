import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";

test("cash → BTC → edit → delete → another device → backup/restore", async ({
  page,
  newContext,
}, testInfo) => {
  const name = `เงินลงทุน ${testInfo.project.name}`;
  const errors: string[] = [];

  await page.clock.install();

  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/cash");
  await page.getByRole("button", { name: "เพิ่มบัญชี", exact: true }).click();

  let dialog = page.getByRole("dialog");

  await dialog.getByLabel("ชื่อบัญชี", { exact: true }).fill(name);
  await dialog.getByLabel("ยอดเริ่มต้น (บาท)", { exact: true }).fill("50000");
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();

  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

  await expect(card).toContainText("50,000.00");
  await card.getByRole("button", { name: "ปรับยอดเงินสด" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("จำนวนเงิน (บาท)", { exact: true }).fill("5000");
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("55,000.00");

  await page.getByRole("button", { name: "บันทึกการซื้อ", exact: true }).click();

  dialog = page.getByRole("dialog");
  await dialog.getByLabel("ประเภทสินทรัพย์", { exact: true }).click();
  await page.getByRole("option", { name: "Bitcoin", exact: true }).click();

  await dialog.getByLabel("เงินต้นที่จ่ายจริง (บาท)", { exact: true }).fill("10000");

  await dialog
    .getByLabel("จำนวน BTC ที่ได้รับจริง", { exact: true })
    .fill("0.00300001");

  await dialog.getByLabel("แหล่งเงิน", { exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(dialog).toContainText("45,000.00");
  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("45,000.00");

  const notice = page.locator(".success-notice");

  await expect(notice).toContainText("บันทึกรายการเรียบร้อยแล้ว");
  await page.clock.runFor(5100);
  await expect(notice).toBeHidden();

  await page.getByRole("link", { name: "รายการซื้อ", exact: true }).click();
  await page.getByRole("button", { name: "แก้ไข BTC", exact: true }).click();
  dialog = page.getByRole("dialog");

  await dialog.getByLabel("เงินต้นที่จ่ายจริง (บาท)", { exact: true }).fill("5000");

  await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole("cell", { name: "5,000.00", exact: true }),
  ).toBeVisible();

  await expect(notice).toContainText("บันทึกรายการเรียบร้อยแล้ว");
  await page.clock.runFor(3000);

  // Repeating the same success message starts a fresh dismissal timer.
  await page.getByRole("button", { name: "แก้ไข BTC", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "บันทึก", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.clock.runFor(2500);
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "ปิดข้อความ", exact: true }).click();
  await expect(notice).toBeHidden();

  await page.getByRole("button", { name: "ลบ BTC", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("5,000.00");
  await page.getByRole("button", { name: "ยืนยันการลบ", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.getByRole("link", { name: "บัญชีเงินสด", exact: true }).click();
  await expect(card).toContainText("55,000.00");
  await page.reload();
  await expect(card).toContainText("55,000.00");

  const second = await newContext();
  const other = await second.newPage();

  await other.goto("http://127.0.0.1:4173/cash");

  await expect(
    other
      .locator('[data-slot="card"]')
      .filter({ has: other.getByRole("heading", { name, exact: true }) }),
  ).toContainText("55,000.00");

  await second.close();
  await page.getByRole("link", { name: "ตั้งค่า", exact: true }).click();

  const event = page.waitForEvent("download");

  await page
    .getByRole("button", { name: "ดาวน์โหลด backup", exact: true })
    .click();

  const downloaded = await event;
  const backupPath = await downloaded.path();

  expect(backupPath).toBeTruthy();

  const saved = JSON.parse(await readFile(backupPath!, "utf8"));

  await page.getByLabel("ไฟล์สำรอง JSON", { exact: true }).setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });

  await expect(page.getByRole("heading", { name: "ข้อมูลที่จะกู้คืน" })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "2. ยืนยันแทนที่ข้อมูล" }),
  ).toBeDisabled();

  const before = page.waitForEvent("download");

  await page.getByRole("button", { name: "1. ดาวน์โหลด backup ปัจจุบัน" }).click();

  await before;

  await expect(
    page.getByRole("button", { name: "2. ยืนยันแทนที่ข้อมูล" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "2. ยืนยันแทนที่ข้อมูล" }).click();

  await page
    .getByRole("button", { name: "แทนที่ข้อมูลทั้งหมด", exact: true })
    .click();

  await expect(
    page.getByText("กู้คืนข้อมูลเรียบร้อยแล้ว ยอดตรงกับไฟล์สำรอง"),
  ).toBeVisible();

  await page.getByRole("link", { name: "บัญชีเงินสด", exact: true }).click();
  await expect(card).toContainText("55,000.00");
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "ภาพรวม", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "ภาพรวมการลงทุน" }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
