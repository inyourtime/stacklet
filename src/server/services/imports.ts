import { SignJWT, jwtVerify } from "jose";
import type { Bindings } from "../types";
import type { Backup, ImportPreview, Meta } from "../../shared/contracts";
import { backupSchema } from "../../shared/contracts";
import { formatThb, parseThb, safeSum } from "../../shared/money";
import { formatBtc, parseBtc } from "../../shared/btc";
import { ApiError } from "../middleware/errors";
import { canonical, sha256 } from "./mutations";
import { assertSql, statement } from "../repositories/db";

export const MAX_IMPORT_BYTES = 1024 * 1024;

export function validateBackup(input: unknown): Backup {
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_IMPORT_BYTES)
    throw new ApiError(413, "IMPORT_TOO_LARGE", "ไฟล์สำรองต้องไม่เกิน 1 MiB");

  const parsed = backupSchema.safeParse(input);

  if (!parsed.success)
    throw new ApiError(
      400,
      "INVALID_BACKUP",
      parsed.error.issues[0]?.message ?? "ไฟล์สำรองไม่ถูกต้อง",
    );

  if (parsed.data.transactions.length > 1000)
    throw new ApiError(
      400,
      "INVALID_BACKUP",
      "ไฟล์ต้องมีรายการซื้อไม่เกิน 1,000 รายการ",
    );

  return parsed.data;
}

export async function preview(
  input: unknown,
  meta: Meta,
): Promise<ImportPreview> {
  const b = validateBackup(input);

  return {
    cashAccountCount: b.cashAccounts.length,
    transactionCount: b.transactions.length,
    totalPrincipalThb: formatThb(
      safeSum([
        ...b.cashAccounts.map((a) => parseThb(a.balanceThb)),
        ...b.transactions.map((t) => parseThb(t.amountThb)),
      ]),
    ),
    btcQuantity: formatBtc(
      safeSum(
        b.transactions.map((t) =>
          t.btcQuantity ? parseBtc(t.btcQuantity) : 0,
        ),
      ),
    ),
    targetBtc: b.btcGoal.targetBtc,
    fileHash: await sha256(canonical(b)),
    snapshotRevision: meta.revision,
  };
}

function secret(env: Bindings): Uint8Array {
  const value =
    env.IMPORT_SIGNING_SECRET ??
    (env.APP_ENV === "local"
      ? "stacklet-local-only-import-receipt-secret"
      : "");

  if (value.length < 32)
    throw new ApiError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "ยังไม่ได้ตั้งค่า backup signing secret",
    );

  return new TextEncoder().encode(value);
}

export const backupReceipt = (env: Bindings, meta: Meta) =>
  new SignJWT({ revision: meta.revision, epoch: meta.datasetEpoch })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("stacklet-backup")
    .setAudience("stacklet-import")
    .setExpirationTime("15m")
    .sign(secret(env));

export async function verifyBackupReceipt(
  env: Bindings,
  receipt: string,
  revision: number,
  epoch: string,
) {
  try {
    const { payload } = await jwtVerify(receipt, secret(env), {
      issuer: "stacklet-backup",
      audience: "stacklet-import",
      algorithms: ["HS256"],
    });

    if (payload.revision !== revision || payload.epoch !== epoch)
      throw new Error("stale");
  } catch {
    throw new ApiError(
      409,
      "SNAPSHOT_CONFLICT",
      "กรุณาดาวน์โหลด backup ล่าสุดก่อนแทนที่ข้อมูล",
    );
  }
}

export function restoreStatements(
  db: D1Database,
  b: Backup,
  p: ImportPreview,
  now: string,
): D1PreparedStatement[] {
  const accounts = b.cashAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    balance: parseThb(a.balanceThb),
    created: a.createdAt,
    updated: a.updatedAt,
  }));

  const transactions = b.transactions.map((t) => ({
    id: t.id,
    type: t.assetType,
    name: t.assetName,
    date: t.tradeDate,
    amount: parseThb(t.amountThb),
    satoshis: t.btcQuantity ? parseBtc(t.btcQuantity) : null,
    account: t.cashAccountId,
    note: t.note,
    created: t.createdAt,
    updated: t.updatedAt,
  }));

  const accountJson = JSON.stringify(accounts);
  const txJson = JSON.stringify(transactions);

  if (new TextEncoder().encode(accountJson + txJson).length > MAX_IMPORT_BYTES)
    throw new ApiError(
      413,
      "IMPORT_TOO_LARGE",
      "ข้อมูลหลังแปลงเกินขนาด restore batch ที่รองรับ",
    );

  return [
    assertSql(
      db,
      "(SELECT revision FROM app_meta WHERE id=1)=?",
      "SNAPSHOT_CONFLICT",
      p.snapshotRevision,
    ),
    statement(db, "UPDATE mutation_context SET restore=1 WHERE id=1"),
    statement(db, "DELETE FROM transactions"),
    statement(db, "DELETE FROM cash_balance_events"),
    statement(db, "DELETE FROM cash_accounts"),
    statement(
      db,
      `INSERT INTO cash_accounts SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),'THB',json_extract(value,'$.balance'),1,json_extract(value,'$.created'),json_extract(value,'$.updated') FROM json_each(?)`,
      accountJson,
    ),
    statement(
      db,
      `INSERT INTO transactions SELECT json_extract(value,'$.id'),json_extract(value,'$.type'),json_extract(value,'$.name'),json_extract(value,'$.date'),json_extract(value,'$.amount'),json_extract(value,'$.satoshis'),json_extract(value,'$.account'),json_extract(value,'$.note'),1,json_extract(value,'$.created'),json_extract(value,'$.updated') FROM json_each(?)`,
      txJson,
    ),
    statement(
      db,
      "UPDATE btc_goal SET target_satoshis=?,version=1,updated_at=? WHERE id=1",
      b.btcGoal.targetBtc ? parseBtc(b.btcGoal.targetBtc) : null,
      now,
    ),
    assertSql(
      db,
      "(SELECT COUNT(*) FROM cash_accounts)=? AND (SELECT COUNT(*) FROM transactions)=? AND (SELECT COALESCE(SUM(balance_satang),0) FROM cash_accounts)+(SELECT COALESCE(SUM(amount_satang),0) FROM transactions)=? AND (SELECT COALESCE(SUM(btc_satoshis),0) FROM transactions)=? AND (SELECT target_satoshis FROM btc_goal WHERE id=1) IS ?",
      "RESTORE_MISMATCH",
      accounts.length,
      transactions.length,
      Number(BigInt(p.totalPrincipalThb.replace(".", ""))),
      Number(BigInt(p.btcQuantity.replace(".", ""))),
      b.btcGoal.targetBtc ? parseBtc(b.btcGoal.targetBtc) : null,
    ),
    statement(
      db,
      "UPDATE app_meta SET dataset_epoch=? WHERE id=1",
      crypto.randomUUID(),
    ),
  ];
}
