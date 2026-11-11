import { formatThb } from "../../shared/money";
import { formatBtc } from "../../shared/btc";
import type {
  CashAccount,
  Transaction,
  Goal,
  Meta,
} from "../../shared/contracts";

export type CashRow = {
  id: string;
  name: string;
  currency: "THB";
  balance_satang: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export type TransactionRow = {
  id: string;
  asset_type: "stock" | "fund" | "btc";
  asset_name: string;
  trade_date: string;
  amount_satang: number;
  btc_satoshis: number | null;
  cash_account_id: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type GoalRow = {
  target_satoshis: number | null;
  version: number;
  updated_at: string;
};

export const cashDto = (r: CashRow): CashAccount => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  balanceThb: formatThb(r.balance_satang),
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const txDto = (r: TransactionRow): Transaction => ({
  id: r.id,
  assetType: r.asset_type,
  assetName: r.asset_name,
  tradeDate: r.trade_date,
  amountThb: formatThb(r.amount_satang),
  btcQuantity: r.btc_satoshis === null ? null : formatBtc(r.btc_satoshis),
  cashAccountId: r.cash_account_id,
  note: r.note,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const goalDto = (r: GoalRow): Goal => ({
  targetBtc: r.target_satoshis === null ? null : formatBtc(r.target_satoshis),
  version: r.version,
  updatedAt: r.updated_at,
});

export const metaSql =
  "SELECT revision,dataset_epoch AS datasetEpoch FROM app_meta WHERE id=1";

export async function readMeta(db: D1Database): Promise<Meta> {
  return (await db.prepare(metaSql).first<Meta>())!;
}

export function statement(
  db: D1Database,
  sql: string,
  ...values: (string | number | null)[]
): D1PreparedStatement {
  return db.prepare(sql).bind(...values);
}

export function assertSql(
  db: D1Database,
  condition: string,
  code: string,
  ...values: (string | number | null)[]
) {
  return statement(
    db,
    `INSERT INTO assertions(code) SELECT CASE WHEN (${condition}) THEN 'OK' ELSE '${code}' END`,
    ...values,
  );
}
