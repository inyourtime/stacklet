import { z } from "zod";
import { parseThb, safeSum } from "../money";
import { parseBtc } from "../btc";

export const uuid = z.uuid();
export const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const assetTypes = ["stock", "fund", "btc", "gold"] as const;
export const assetTypeSchema = z.enum(assetTypes);

export const thb = z
  .string()
  .max(32)
  .refine((v) => {
    try {
      parseThb(v);

      return true;
    } catch {
      return false;
    }
  }, "จำนวนเงินบาทไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)");

export const btc = z
  .string()
  .max(32)
  .refine((v) => {
    try {
      return parseBtc(v) > 0;
    } catch {
      return false;
    }
  }, "จำนวน BTC ต้องมากกว่า 0 และไม่เกิน 8 ตำแหน่ง");

export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
    "วันที่ไม่มีอยู่จริง",
  );

export const timestamp = z.iso.datetime();
export const name = z.string().trim().min(1, "กรุณากรอกชื่อ").max(80);
export const cashCreateSchema = z.object({ name, balanceThb: thb }).strict();

export const cashRenameSchema = z
  .object({ name, expectedVersion: version })
  .strict();

export const adjustmentSchema = z
  .object({
    mode: z.enum(["add", "subtract", "set"]),
    amountThb: thb,
    expectedVersion: version,
  })
  .strict()
  .refine((v) => {
    try {
      return v.mode === "set" || parseThb(v.amountThb) > 0;
    } catch {
      return false;
    }
  }, "ยอดเพิ่มหรือลดต้องมากกว่า 0");

const purchaseFields = {
  assetType: assetTypeSchema,
  assetName: name,
  tradeDate: date,
  amountThb: thb.refine((v) => {
    try {
      return parseThb(v) > 0;
    } catch {
      return false;
    }
  }, "ยอดซื้อต้องมากกว่า 0"),
  btcQuantity: btc.nullable(),
  cashAccountId: uuid.nullable(),
  note: z.string().trim().max(500).nullable().default(null),
};

const validBtc = (v: { assetType: string; btcQuantity: string | null }) =>
  (v.assetType === "btc") === (v.btcQuantity !== null);

export const purchaseSchema = z
  .object(purchaseFields)
  .strict()
  .refine(validBtc, "กรอกจำนวน BTC เฉพาะรายการ Bitcoin");

export const purchaseEditSchema = z
  .object({ ...purchaseFields, expectedVersion: version })
  .strict()
  .refine(validBtc, "กรอกจำนวน BTC เฉพาะรายการ Bitcoin");

export const goalSchema = z
  .object({ targetBtc: btc.nullable(), expectedVersion: version })
  .strict();

export const cashAccountSchema = z.object({
  id: uuid,
  name,
  currency: z.literal("THB"),
  balanceThb: thb,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const transactionSchema = z
  .object({
    ...purchaseFields,
    id: uuid,
    version,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine(validBtc);

export const goalResponseSchema = z.object({
  targetBtc: btc.nullable(),
  version,
  updatedAt: timestamp,
});

export const metaSchema = z.object({
  revision: z.number().int().nonnegative(),
  datasetEpoch: z.string().min(1),
});

const backupCash = cashAccountSchema.omit({ version: true });

const backupTransaction = z
  .object({
    ...purchaseFields,
    id: uuid,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .refine(validBtc);

export const backupSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: timestamp,
    cashAccounts: z.array(backupCash),
    transactions: z.array(backupTransaction),
    btcGoal: z.object({ targetBtc: btc.nullable() }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const cashIds = new Set(v.cashAccounts.map((a) => a.id));
    const txIds = new Set(v.transactions.map((t) => t.id));

    if (
      cashIds.size !== v.cashAccounts.length ||
      txIds.size !== v.transactions.length
    )
      ctx.addIssue({ code: "custom", message: "มี ID ซ้ำในไฟล์" });

    if (
      v.transactions.some(
        (t) => t.cashAccountId && !cashIds.has(t.cashAccountId),
      )
    )
      ctx.addIssue({ code: "custom", message: "บัญชีต้นทางไม่มีอยู่ในไฟล์" });

    try {
      safeSum([
        ...v.cashAccounts.map((a) => parseThb(a.balanceThb)),
        ...v.transactions.map((t) => parseThb(t.amountThb)),
      ]);

      safeSum(
        v.transactions.map((t) =>
          t.btcQuantity ? parseBtc(t.btcQuantity) : 0,
        ),
      );
    } catch {
      ctx.addIssue({ code: "custom", message: "ผลรวมเกินขอบเขตที่รองรับ" });
    }
  });

export const summarySchema = z.object({
  month: z.string(),
  totalPrincipalThb: z.string(),
  investedThb: z.string(),
  cashThb: z.string(),
  monthPurchasesThb: z.string(),
  monthPurchaseCount: z.number(),
  allocations: z.array(
    z.object({
      type: z.enum([...assetTypes, "cash"]),
      amountThb: z.string(),
    }),
  ),
  cashAccounts: z.array(cashAccountSchema),
  btc: z.object({
    quantity: z.string(),
    targetBtc: btc.nullable(),
    remainingBtc: z.string().nullable(),
    progressPercent: z.number().nullable(),
    version,
    updatedAt: timestamp,
  }),
});

export const transactionsPageSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});

export const mutationResultSchema = z.object({
  cashAccount: cashAccountSchema.optional(),
  transaction: transactionSchema.optional(),
  affectedCashAccounts: z.array(cashAccountSchema).optional(),
  goal: goalResponseSchema.optional(),
  deleted: z.boolean().optional(),
  restored: z.boolean().optional(),
});

export const previewSchema = z.object({
  cashAccountCount: z.number(),
  transactionCount: z.number(),
  totalPrincipalThb: z.string(),
  btcQuantity: z.string(),
  targetBtc: btc.nullable(),
  fileHash: z.string(),
  snapshotRevision: z.number(),
});

export type CashAccount = z.infer<typeof cashAccountSchema>;

export type Purchase = z.infer<typeof purchaseSchema>;

export type Transaction = z.infer<typeof transactionSchema>;

export type Goal = z.infer<typeof goalResponseSchema>;

export type Meta = z.infer<typeof metaSchema>;

export type Backup = z.infer<typeof backupSchema>;

export type Summary = z.infer<typeof summarySchema>;

export type ImportPreview = z.infer<typeof previewSchema>;

export type MutationResult = z.infer<typeof mutationResultSchema>;

export type Envelope<T> = { data: T; meta: Meta };
