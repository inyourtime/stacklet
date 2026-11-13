import {
  cashDto,
  txDto,
  goalDto,
  metaSql,
  type CashRow,
  type GoalRow,
  type TransactionRow,
} from "../repositories/db";
import { formatThb, safeSum } from "../../shared/money";
import { formatBtc } from "../../shared/btc";
import type { Backup, Envelope, Meta, Summary } from "../../shared/contracts";
import { assetTypes } from "../../shared/contracts";

export async function summary(
  db: D1Database,
  month: string,
): Promise<Envelope<Summary>> {
  const result = await db.batch([
    db.prepare("SELECT * FROM cash_accounts ORDER BY created_at,id"),
    db.prepare(
      "SELECT asset_type,SUM(amount_satang) AS amount,COALESCE(SUM(btc_satoshis),0) AS satoshis FROM transactions GROUP BY asset_type",
    ),
    db
      .prepare(
        "SELECT COALESCE(SUM(amount_satang),0) AS amount,COUNT(*) AS count FROM transactions WHERE substr(trade_date,1,7)=?",
      )
      .bind(month),
    db.prepare("SELECT * FROM btc_goal WHERE id=1"),
    db.prepare(metaSql),
  ]);

  const aggregates = result[1].results as {
    asset_type: string;
    amount: number;
    satoshis: number;
  }[];

  const monthly = result[2].results[0] as { amount: number; count: number };
  const accounts = (result[0].results as CashRow[]).map(cashDto);

  const allocations = assetTypes.map((type) => ({
    type,
    amount: Number(aggregates.find((r) => r.asset_type === type)?.amount ?? 0),
  }));

  const cash = safeSum(
    (result[0].results as CashRow[]).map((a) => a.balance_satang),
  );

  const invested = safeSum(allocations.map((a) => a.amount));

  const satoshis = Number(
    aggregates.find((r) => r.asset_type === "btc")?.satoshis ?? 0,
  );

  const g = result[3].results[0] as GoalRow;

  return {
    meta: result[4].results[0] as Meta,
    data: {
      month,
      totalPrincipalThb: formatThb(safeSum([cash, invested])),
      investedThb: formatThb(invested),
      cashThb: formatThb(cash),
      monthPurchasesThb: formatThb(Number(monthly.amount)),
      monthPurchaseCount: Number(monthly.count),
      cashAccounts: accounts,
      allocations: [
        ...allocations.map((a) => ({
          type: a.type,
          amountThb: formatThb(a.amount),
        })),
        { type: "cash", amountThb: formatThb(cash) },
      ],
      btc: {
        quantity: formatBtc(satoshis),
        ...goalDto(g),
        remainingBtc:
          g.target_satoshis === null
            ? null
            : formatBtc(Math.max(0, g.target_satoshis - satoshis)),
        progressPercent:
          g.target_satoshis === null
            ? null
            : Number((BigInt(satoshis) * 10000n) / BigInt(g.target_satoshis)) /
              100,
      },
    },
  };
}

export async function backup(db: D1Database): Promise<Envelope<Backup>> {
  const result = await db.batch([
    db.prepare("SELECT * FROM cash_accounts ORDER BY id"),
    db.prepare("SELECT * FROM transactions ORDER BY id"),
    db.prepare("SELECT * FROM btc_goal WHERE id=1"),
    db.prepare(metaSql),
  ]);

  return {
    data: {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      cashAccounts: (result[0].results as CashRow[]).map((r) => {
        const { version: _, ...a } = cashDto(r);

        return a;
      }),
      transactions: (result[1].results as TransactionRow[]).map((r) => {
        const { version: _, ...t } = txDto(r);

        return t;
      }),
      btcGoal: {
        targetBtc: goalDto(result[2].results[0] as GoalRow).targetBtc,
      },
    },
    meta: result[3].results[0] as Meta,
  };
}
