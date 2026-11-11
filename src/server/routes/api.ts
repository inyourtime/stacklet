import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import {
  routes,
  cashMutationSchema,
  purchaseMutationSchema,
  deleteMutationSchema,
  goalMutationSchema,
  restoreMutationSchema,
} from "./contracts";
import { uuid, type Meta } from "../../shared/contracts";
import { bangkokMonth, parseThb } from "../../shared/money";
import { parseBtc } from "../../shared/btc";
import type { AppEnv } from "../types";
import { ApiError } from "../middleware/errors";
import {
  assertSql,
  cashDto,
  goalDto,
  metaSql,
  readMeta,
  statement,
  txDto,
  type CashRow,
  type GoalRow,
  type TransactionRow,
} from "../repositories/db";
import {
  affectedCashJson,
  cashJson,
  goalJson,
  mutate,
  txJson,
  versionGuards,
} from "../services/mutations";
import { backup, summary } from "../services/reads";
import {
  backupReceipt,
  preview,
  restoreStatements,
  validateBackup,
  verifyBackupReceipt,
} from "../services/imports";

const router = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (result.success) return;

    const invalidBackup =
      c.req.path.includes("/imports/") &&
      result.target === "json" &&
      result.error.issues.some((issue) => issue.path[0] === "backup");
    throw new ApiError(
      400,
      invalidBackup ? "INVALID_BACKUP" : "VALIDATION_ERROR",
      result.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    );
  },
});

export const api = router
  .openapi(routes.summary, async (c) => {
    const month = c.req.valid("query").month ?? bangkokMonth();

    return c.json(await summary(c.env.DB, month), 200);
  })

  .openapi(routes.cashList, async (c) => {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT * FROM cash_accounts ORDER BY created_at,id"),
      c.env.DB.prepare(metaSql),
    ]);

    return c.json(
      {
        data: (rows[0].results as CashRow[]).map(cashDto),
        meta: rows[1].results[0] as Meta,
      },
      200,
    );
  })

  .openapi(routes.cashCreate, async (c) => {
    const input = c.req.valid("json");
    const cashId = crypto.randomUUID();
    const db = c.env.DB;

    return mutate(
      c,
      input,
      (now) => [
        statement(
          db,
          "INSERT INTO cash_accounts VALUES(?,?,'THB',?,1,?,?)",
          cashId,
          input.name,
          parseThb(input.balanceThb),
          now,
          now,
        ),
      ],
      `json_object('cashAccount',json((SELECT ${cashJson()} FROM cash_accounts a WHERE id='${cashId}')))`,
      cashMutationSchema,
      201,
    );
  })

  .openapi(routes.cashRename, async (c) => {
    const cashId = c.req.valid("param").id;
    const input = c.req.valid("json");
    const db = c.env.DB;

    return mutate(
      c,
      input,
      (now) => [
        ...versionGuards(db, "cash_accounts", cashId, input.expectedVersion),
        statement(
          db,
          "UPDATE cash_accounts SET name=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          input.name,
          now,
          cashId,
          input.expectedVersion,
        ),
      ],
      `json_object('cashAccount',json((SELECT ${cashJson()} FROM cash_accounts a WHERE id='${cashId}')))`,
      cashMutationSchema,
    );
  })

  .openapi(routes.cashAdjust, async (c) => {
    const cashId = c.req.valid("param").id;
    const input = c.req.valid("json");
    const db = c.env.DB;

    const expression = {
      add: "balance_satang+?",
      subtract: "balance_satang-?",
      set: "?",
    }[input.mode];

    return mutate(
      c,
      input,
      (now) => [
        ...versionGuards(db, "cash_accounts", cashId, input.expectedVersion),
        statement(
          db,
          "UPDATE mutation_context SET kind=?,transaction_id=NULL WHERE id=1",
          `manual_${input.mode}`,
        ),
        statement(
          db,
          `UPDATE cash_accounts SET balance_satang=${expression},version=version+1,updated_at=? WHERE id=? AND version=?`,
          parseThb(input.amountThb),
          now,
          cashId,
          input.expectedVersion,
        ),
      ],
      `json_object('cashAccount',json((SELECT ${cashJson()} FROM cash_accounts a WHERE id='${cashId}')))`,
      cashMutationSchema,
    );
  })

  .openapi(routes.purchaseList, async (c) => {
    const {
      type,
      q: query,
      cursor: pageCursor,
      limit: pageLimit,
    } = c.req.valid("query");

    const rawLimit = pageLimit ?? "30";

    const limit = Number(rawLimit);
    const q = query ?? "";
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

    const filters: string[] = [];
    const values: (string | number)[] = [];

    if (type) {
      filters.push("asset_type=?");
      values.push(type);
    }

    if (q) {
      filters.push("asset_name LIKE ? ESCAPE '\\'");
      values.push(pattern);
    }

    if (pageCursor) {
      let cursor: { date: string; id: string };

      try {
        cursor = z
          .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: uuid })
          .parse(JSON.parse(atob(pageCursor)));
      } catch {
        throw new ApiError(400, "VALIDATION_ERROR", "cursor ไม่ถูกต้อง");
      }

      filters.push("(trade_date<? OR (trade_date=? AND id<?))");
      values.push(cursor.date, cursor.date, cursor.id);
    }

    const result = await c.env.DB.batch([
      statement(
        c.env.DB,
        `SELECT * FROM transactions ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY trade_date DESC,id DESC LIMIT ?`,
        ...values,
        limit + 1,
      ),
      c.env.DB.prepare(metaSql),
    ]);

    const rows = result[0].results as TransactionRow[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);

    return c.json(
      {
        data: {
          items: items.map(txDto),
          nextCursor:
            more && last
              ? btoa(JSON.stringify({ date: last.trade_date, id: last.id }))
              : null,
        },
        meta: result[1].results[0] as Meta,
      },
      200,
    );
  })

  .openapi(routes.purchaseCreate, async (c) => {
    const input = c.req.valid("json");
    const txId = crypto.randomUUID();
    const db = c.env.DB;

    return mutate(
      c,
      input,
      (now) => [
        ...(input.cashAccountId
          ? [
              assertSql(
                db,
                "EXISTS(SELECT 1 FROM cash_accounts WHERE id=?)",
                "CASH_ACCOUNT_NOT_FOUND",
                input.cashAccountId,
              ),
            ]
          : []),
        statement(
          db,
          "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,1,?,?)",
          txId,
          input.assetType,
          input.assetName,
          input.tradeDate,
          parseThb(input.amountThb),
          input.btcQuantity ? parseBtc(input.btcQuantity) : null,
          input.cashAccountId,
          input.note,
          now,
          now,
        ),
      ],
      `json_object('transaction',json((SELECT ${txJson()} FROM transactions t WHERE id='${txId}')),'affectedCashAccounts',json(${affectedCashJson}))`,
      purchaseMutationSchema,
      201,
    );
  })

  .openapi(routes.purchaseEdit, async (c) => {
    const txId = c.req.valid("param").id;
    const input = c.req.valid("json");
    const db = c.env.DB;

    return mutate(
      c,
      input,
      (now) => [
        ...versionGuards(db, "transactions", txId, input.expectedVersion),
        ...(input.cashAccountId
          ? [
              assertSql(
                db,
                "EXISTS(SELECT 1 FROM cash_accounts WHERE id=?)",
                "CASH_ACCOUNT_NOT_FOUND",
                input.cashAccountId,
              ),
            ]
          : []),
        statement(
          db,
          "UPDATE transactions SET asset_type=?,asset_name=?,trade_date=?,amount_satang=?,btc_satoshis=?,cash_account_id=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          input.assetType,
          input.assetName,
          input.tradeDate,
          parseThb(input.amountThb),
          input.btcQuantity ? parseBtc(input.btcQuantity) : null,
          input.cashAccountId,
          input.note,
          now,
          txId,
          input.expectedVersion,
        ),
      ],
      `json_object('transaction',json((SELECT ${txJson()} FROM transactions t WHERE id='${txId}')),'affectedCashAccounts',json(${affectedCashJson}))`,
      purchaseMutationSchema,
    );
  })

  .openapi(routes.purchaseDelete, async (c) => {
    const txId = c.req.valid("param").id;
    const match = c.req.valid("header")["If-Match"];

    const expectedVersion = Number(match.slice(1, -1));
    const db = c.env.DB;

    return mutate(
      c,
      { expectedVersion },
      () => [
        ...versionGuards(db, "transactions", txId, expectedVersion),
        statement(
          db,
          "DELETE FROM transactions WHERE id=? AND version=?",
          txId,
          expectedVersion,
        ),
      ],
      `json_object('deleted',json('true'),'affectedCashAccounts',json(${affectedCashJson}))`,
      deleteMutationSchema,
    );
  })

  .openapi(routes.goalRead, async (c) => {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT * FROM btc_goal WHERE id=1"),
      c.env.DB.prepare(metaSql),
    ]);

    return c.json(
      {
        data: goalDto(rows[0].results[0] as GoalRow),
        meta: rows[1].results[0] as Meta,
      },
      200,
    );
  })

  .openapi(routes.goalWrite, async (c) => {
    const input = c.req.valid("json");
    const db = c.env.DB;

    return mutate(
      c,
      input,
      (now) => [
        ...versionGuards(db, "btc_goal", 1, input.expectedVersion),
        statement(
          db,
          "UPDATE btc_goal SET target_satoshis=?,version=version+1,updated_at=? WHERE id=1 AND version=?",
          input.targetBtc ? parseBtc(input.targetBtc) : null,
          now,
          input.expectedVersion,
        ),
      ],
      `json_object('goal',json((SELECT ${goalJson} FROM btc_goal WHERE id=1)))`,
      goalMutationSchema,
    );
  })

  .openapi(routes.backup, async (c) => {
    const result = await backup(c.env.DB);

    try {
      validateBackup(result.data);
      c.header("X-Backup-Restorable", "true");
      c.header("X-Backup-Receipt", await backupReceipt(c.env, result.meta));
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !["IMPORT_TOO_LARGE", "INVALID_BACKUP"].includes(error.code)
      )
        throw error;

      c.header("X-Backup-Restorable", "false");
    }

    return c.json(result, 200);
  })

  .openapi(routes.importValidate, async (c) => {
    const input = c.req.valid("json");
    const meta = await readMeta(c.env.DB);

    return c.json({ data: await preview(input.backup, meta), meta }, 200);
  })

  .openapi(routes.importReplace, async (c) => {
    const input = c.req.valid("json");

    const b = validateBackup(input.backup);
    const meta = await readMeta(c.env.DB);
    const p = await preview(b, { ...meta, revision: input.snapshotRevision });

    if (p.fileHash !== input.fileHash)
      throw new ApiError(400, "INVALID_BACKUP", "ไฟล์ไม่ตรงกับ preview");

    return mutate(
      c,
      input,
      async (now) => {
        await verifyBackupReceipt(
          c.env,
          input.backupReceipt,
          input.snapshotRevision,
          c.req.header("X-Dataset-Epoch") ?? "",
        );

        return restoreStatements(c.env.DB, b, p, now);
      },
      `json_object('restored',json('true'))`,
      restoreMutationSchema,
    );
  });

export type ApiType = typeof api;
