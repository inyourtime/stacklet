import { z } from "zod";
import { metaSchema } from "../../shared/contracts";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { ApiError, translateDbError } from "../middleware/errors";
import { assertSql, statement } from "../repositories/db";

export async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;

  return JSON.stringify(value);
}

export const sqlMoney = (field: string) =>
  `printf('%d.%02d',${field}/100,${field}%100)`;

export const sqlBtc = (field: string) =>
  `CASE WHEN ${field} IS NULL THEN NULL ELSE printf('%d.%08d',${field}/100000000,${field}%100000000) END`;

export const cashJson = (a = "a") =>
  `json_object('id',${a}.id,'name',${a}.name,'currency',${a}.currency,'balanceThb',${sqlMoney(`${a}.balance_satang`)},'version',${a}.version,'createdAt',${a}.created_at,'updatedAt',${a}.updated_at)`;

export const txJson = (t = "t") =>
  `json_object('id',${t}.id,'assetType',${t}.asset_type,'assetName',${t}.asset_name,'tradeDate',${t}.trade_date,'amountThb',${sqlMoney(`${t}.amount_satang`)},'btcQuantity',${sqlBtc(`${t}.btc_satoshis`)},'cashAccountId',${t}.cash_account_id,'note',${t}.note,'version',${t}.version,'createdAt',${t}.created_at,'updatedAt',${t}.updated_at)`;

export const goalJson = `json_object('targetBtc',${sqlBtc("target_satoshis")},'version',version,'updatedAt',updated_at)`;
export const affectedCashJson = `(SELECT json_group_array(${cashJson()}) FROM cash_accounts a WHERE a.id IN (SELECT cash_account_id FROM cash_balance_events WHERE operation_id=(SELECT operation_id FROM mutation_context WHERE id=1)))`;

export function versionGuards(
  db: D1Database,
  table: "transactions" | "cash_accounts" | "btc_goal",
  id: string | number,
  version: number,
) {
  const missing =
    table === "transactions"
      ? "TRANSACTION_NOT_FOUND"
      : "CASH_ACCOUNT_NOT_FOUND";

  return [
    assertSql(db, `EXISTS(SELECT 1 FROM ${table} WHERE id=?)`, missing, id),
    assertSql(
      db,
      `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=?)`,
      "VERSION_CONFLICT",
      id,
      version,
    ),
  ];
}

type Stored = {
  request_hash: string;
  response_status: number;
  response_json: string;
};

export async function mutate<
  T extends z.ZodType,
  Status extends 200 | 201 = 200,
>(
  c: Context<AppEnv>,
  input: unknown,
  commands: (
    now: string,
    key: string,
  ) => D1PreparedStatement[] | Promise<D1PreparedStatement[]>,
  result: string,
  resultSchema: T,
  status: Status = 200 as Status,
) {
  const db = c.env.DB;
  const key = c.req.header("Idempotency-Key");
  const epoch = c.req.header("X-Dataset-Epoch");

  if (
    !key ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
    !epoch ||
    epoch.length > 128
  )
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "ต้องระบุ Idempotency-Key และ X-Dataset-Epoch",
    );

  const route = new URL(c.req.url).pathname;

  const hash = await sha256(
    canonical({ method: c.req.method, route, input, epoch }),
  );

  const stored = () =>
    statement(
      db,
      "SELECT request_hash,response_status,response_json FROM mutation_requests WHERE idempotency_key=?",
      key,
    ).first<Stored>();

  const respond = (json: string) =>
    c.json(
      z
        .object({ data: resultSchema, meta: metaSchema })
        .parse(JSON.parse(json)),
      status,
    );

  const replay = (row: Stored) => {
    if (row.request_hash !== hash)
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "คำขอนี้ใช้รหัสซ้ำกับข้อมูลอีกชุด กรุณาส่งใหม่",
      );

    return respond(row.response_json);
  };

  const prior = await stored();

  if (prior) return replay(prior);

  const now = new Date().toISOString();

  const statements = [
    statement(
      db,
      "INSERT INTO mutation_requests VALUES(?,?,?,?,?,?,?)",
      key,
      c.req.method,
      route,
      hash,
      status,
      "{}",
      now,
    ),
    assertSql(
      db,
      "(SELECT dataset_epoch FROM app_meta WHERE id=1)=?",
      "DATASET_CONFLICT",
      epoch,
    ),
    statement(
      db,
      "UPDATE mutation_context SET operation_id=?,kind='opening',transaction_id=NULL,restore=0,now=? WHERE id=1",
      key,
      now,
    ),
    ...(await commands(now, key)),
    assertSql(
      db,
      "NOT EXISTS(SELECT 1 FROM cash_accounts WHERE balance_satang>100000000000) AND (SELECT COALESCE(SUM(balance_satang),0) FROM cash_accounts)+(SELECT COALESCE(SUM(amount_satang),0) FROM transactions)<=9007199254740991 AND (SELECT COALESCE(SUM(btc_satoshis),0) FROM transactions)<=9007199254740991",
      "AMOUNT_LIMIT",
    ),
    statement(db, "UPDATE app_meta SET revision=revision+1 WHERE id=1"),
    statement(
      db,
      `UPDATE mutation_requests SET response_json=(SELECT json_object('data',json(${result}),'meta',json_object('revision',revision,'datasetEpoch',dataset_epoch)) FROM app_meta WHERE id=1) WHERE idempotency_key=?`,
      key,
    ),
    statement(
      db,
      "UPDATE mutation_context SET operation_id=NULL,kind='opening',transaction_id=NULL,restore=0,now=NULL WHERE id=1",
    ),
    statement(
      db,
      "SELECT response_json FROM mutation_requests WHERE idempotency_key=?",
      key,
    ),
  ];

  try {
    const rows = await db.batch(statements);

    return respond(
      (rows.at(-1)!.results[0] as { response_json: string }).response_json,
    );
  } catch (error) {
    const race = await stored();

    if (race) return replay(race);

    translateDbError(error);
  }
}
