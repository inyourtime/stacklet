import { createRoute, z } from "@hono/zod-openapi";
import {
  adjustmentSchema,
  assetTypeSchema,
  backupSchema as backupSchemaContract,
  cashAccountSchema as cashAccountSchemaContract,
  cashCreateSchema,
  cashRenameSchema,
  goalResponseSchema as goalResponseSchemaContract,
  goalSchema,
  metaSchema as metaSchemaContract,
  previewSchema as previewSchemaContract,
  purchaseEditSchema,
  purchaseSchema,
  summarySchema as summarySchemaContract,
  transactionSchema as transactionSchemaContract,
  transactionsPageSchema as transactionsPageSchemaContract,
  uuid,
} from "../../shared/contracts";

const backupSchema = backupSchemaContract.openapi("Backup");

const cashAccountSchema = cashAccountSchemaContract.openapi("CashAccount");

const goalResponseSchema = goalResponseSchemaContract.openapi("BtcGoal");

const metaSchema = metaSchemaContract.openapi("DatasetMeta");

const previewSchema = previewSchemaContract.openapi("ImportPreview");

const summarySchema = summarySchemaContract.openapi("Summary");

const transactionSchema = transactionSchemaContract.openapi("Purchase");

const transactionsPageSchema =
  transactionsPageSchemaContract.openapi("PurchasesPage");

export const errorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), requestId: uuid }),
  })
  .openapi("ApiError");

export const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: metaSchema });

export const cashMutationSchema = z.object({ cashAccount: cashAccountSchema });

export const purchaseMutationSchema = z.object({
  transaction: transactionSchema,
  affectedCashAccounts: z.array(cashAccountSchema),
});

export const deleteMutationSchema = z.object({
  deleted: z.literal(true),
  affectedCashAccounts: z.array(cashAccountSchema),
});

export const goalMutationSchema = z.object({ goal: goalResponseSchema });

export const restoreMutationSchema = z.object({ restored: z.literal(true) });

const params = z.object({
  id: uuid.openapi({ param: { name: "id", in: "path" } }),
});

const mutationHeaders = z.object({
  "Idempotency-Key": z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .openapi({
      description:
        "Generate once per submit; reuse for retries of the same payload.",
    }),
  "X-Dataset-Epoch": z.string().min(1).max(128).openapi({
    description:
      "Dataset epoch from the original form snapshot. Reload after restore.",
  }),
});

const deleteHeaders = mutationHeaders.extend({
  "If-Match": z
    .string()
    .regex(/^"[1-9]\d*"$/)
    .refine((value) => Number.isSafeInteger(Number(value.slice(1, -1))))
    .openapi({ example: '"3"', description: "Quoted transaction version." }),
});

export const importValidateSchema = z.object({ backup: backupSchema }).strict();

export const importReplaceSchema = z
  .object({
    backup: backupSchema,
    fileHash: z.string().length(64),
    snapshotRevision: z.number().int().nonnegative(),
    backupReceipt: z.string().max(2048),
  })
  .strict();

export const summaryQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .openapi({
      example: "2026-11",
      description:
        "Purchase reporting month; defaults to the current month in Asia/Bangkok.",
    }),
});

export const transactionsQuerySchema = z.object({
  type: assetTypeSchema.optional(),
  q: z
    .string()
    .trim()
    .refine(
      (value) =>
        new TextEncoder().encode(`%${value.replace(/[\\%_]/g, "\\$&")}%`)
          .length <= 50,
      "ข้อความค้นหายาวเกินไป กรุณาใช้คำที่สั้นลง",
    )
    .optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .refine(
      (value) => Number(value) >= 1 && Number(value) <= 100,
      "limit ต้องอยู่ระหว่าง 1 ถึง 100",
    )
    .optional()
    .openapi({
      example: "30",
      description: "Page size, 1–100; defaults to 30.",
    }),
});

const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: json(schema),
});

const errors = {
  400: { description: "Invalid request or backup", content: json(errorSchema) },
  401: {
    description: "Missing, invalid, or expired Access JWT",
    content: json(errorSchema),
  },
  403: {
    description: "Owner, origin, or environment access denied",
    content: json(errorSchema),
  },
  404: {
    description: "Referenced account or purchase not found",
    content: json(errorSchema),
  },
  409: {
    description:
      "Insufficient cash, stale version/dataset/snapshot, or idempotency conflict",
    content: json(errorSchema),
  },
  413: {
    description: "Request or import exceeds size limits",
    content: json(errorSchema),
  },
  500: {
    description: "Internal error; use requestId for diagnosis",
    content: json(errorSchema),
  },
  503: {
    description: "Backup signing secret is not configured",
    content: json(errorSchema),
  },
};

const success = <T extends z.ZodType>(schema: T) => ({
  description: "Success",
  content: json(envelope(schema)),
});

export const routes = {
  summary: createRoute({
    method: "get",
    path: "/summary",
    operationId: "getSummary",
    tags: ["Overview"],
    request: { query: summaryQuerySchema },
    responses: { 200: success(summarySchema), ...errors },
  }),

  cashList: createRoute({
    method: "get",
    path: "/cash-accounts",
    operationId: "listCashAccounts",
    tags: ["Cash accounts"],
    responses: { 200: success(z.array(cashAccountSchema)), ...errors },
  }),

  cashCreate: createRoute({
    method: "post",
    path: "/cash-accounts",
    operationId: "createCashAccount",
    tags: ["Cash accounts"],
    request: { headers: mutationHeaders, body: body(cashCreateSchema) },
    responses: { 201: success(cashMutationSchema), ...errors },
  }),

  cashRename: createRoute({
    method: "patch",
    path: "/cash-accounts/{id}",
    operationId: "renameCashAccount",
    tags: ["Cash accounts"],
    request: { params, headers: mutationHeaders, body: body(cashRenameSchema) },
    responses: { 200: success(cashMutationSchema), ...errors },
  }),

  cashAdjust: createRoute({
    method: "post",
    path: "/cash-accounts/{id}/adjustments",
    operationId: "adjustCashBalance",
    tags: ["Cash accounts"],
    request: { params, headers: mutationHeaders, body: body(adjustmentSchema) },
    responses: { 200: success(cashMutationSchema), ...errors },
  }),

  purchaseList: createRoute({
    method: "get",
    path: "/transactions",
    operationId: "listPurchases",
    tags: ["Purchases"],
    request: { query: transactionsQuerySchema },
    responses: { 200: success(transactionsPageSchema), ...errors },
  }),

  purchaseCreate: createRoute({
    method: "post",
    path: "/transactions",
    operationId: "createPurchase",
    tags: ["Purchases"],
    request: { headers: mutationHeaders, body: body(purchaseSchema) },
    responses: { 201: success(purchaseMutationSchema), ...errors },
  }),

  purchaseEdit: createRoute({
    method: "patch",
    path: "/transactions/{id}",
    operationId: "editPurchase",
    tags: ["Purchases"],
    request: {
      params,
      headers: mutationHeaders,
      body: body(purchaseEditSchema),
    },
    responses: { 200: success(purchaseMutationSchema), ...errors },
  }),

  purchaseDelete: createRoute({
    method: "delete",
    path: "/transactions/{id}",
    operationId: "deletePurchase",
    tags: ["Purchases"],
    request: { params, headers: deleteHeaders },
    responses: { 200: success(deleteMutationSchema), ...errors },
  }),

  goalRead: createRoute({
    method: "get",
    path: "/btc-goal",
    operationId: "getBtcGoal",
    tags: ["Bitcoin goal"],
    responses: { 200: success(goalResponseSchema), ...errors },
  }),

  goalWrite: createRoute({
    method: "put",
    path: "/btc-goal",
    operationId: "setBtcGoal",
    tags: ["Bitcoin goal"],
    request: { headers: mutationHeaders, body: body(goalSchema) },
    responses: { 200: success(goalMutationSchema), ...errors },
  }),

  backup: createRoute({
    method: "get",
    path: "/backup",
    operationId: "exportBackup",
    tags: ["Backup"],
    responses: {
      200: {
        ...success(backupSchema),
        headers: {
          "X-Backup-Restorable": {
            schema: { type: "string", enum: ["true", "false"] },
            description: "Whether this export fits current restore limits.",
          },
          "X-Backup-Receipt": {
            schema: { type: "string" },
            description:
              "15-minute receipt for a recoverable pre-restore backup; absent when not restorable.",
          },
        },
      },
      ...errors,
    },
  }),

  importValidate: createRoute({
    method: "post",
    path: "/imports/validate",
    operationId: "validateImport",
    tags: ["Backup"],
    request: { body: body(importValidateSchema) },
    responses: { 200: success(previewSchema), ...errors },
  }),

  importReplace: createRoute({
    method: "post",
    path: "/imports/replace",
    operationId: "replaceFromBackup",
    tags: ["Backup"],
    request: { headers: mutationHeaders, body: body(importReplaceSchema) },
    responses: { 200: success(restoreMutationSchema), ...errors },
  }),
};
