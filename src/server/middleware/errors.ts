import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const messages: Record<string, string> = {
  VERSION_CONFLICT: "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก",
  DATASET_CONFLICT: "มีการกู้คืนข้อมูล กรุณาโหลดหน้าใหม่ก่อนบันทึก",
  SNAPSHOT_CONFLICT: "ข้อมูลเปลี่ยนหลัง preview กรุณาตรวจไฟล์และดาวน์โหลด backup ใหม่",
  CASH_ACCOUNT_NOT_FOUND: "ไม่พบบัญชีเงินสด",
  TRANSACTION_NOT_FOUND: "ไม่พบรายการซื้อ",
  AMOUNT_LIMIT: "ยอดเงินหรือผลรวมเกินขอบเขตที่รองรับ",
  RESTORE_MISMATCH: "ผลรวมหลังนำเข้าไม่ตรงกับไฟล์",
};

export function translateDbError(error: unknown): never {
  const text = String(
    error instanceof Error ? `${error.message} ${String(error.cause)}` : error,
  );

  for (const [code, message] of Object.entries(messages))
    if (text.includes(code))
      throw new ApiError(code.endsWith("NOT_FOUND") ? 404 : 409, code, message);

  if (text.includes("balance_satang") && text.includes("CHECK constraint"))
    throw new ApiError(
      409,
      "INSUFFICIENT_CASH",
      "เงินสดไม่พอ กรุณาลดยอดซื้อหรือเติมเงินก่อน",
    );

  throw error;
}
