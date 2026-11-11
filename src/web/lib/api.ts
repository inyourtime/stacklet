import { hc, type InferRequestType } from "hono/client";
import type { AppType } from "../../server";
import { z } from "zod";
import {
  backupSchema,
  cashAccountSchema,
  summarySchema,
  transactionsPageSchema,
  previewSchema,
  mutationResultSchema,
  type MutationResult,
  metaSchema,
  type Meta,
  type Envelope,
} from "../../shared/contracts";

export const client = hc<AppType>("/", {
  init: { credentials: "same-origin", cache: "no-store" },
}).api.v1;

export type MutationHeaders = InferRequestType<
  (typeof client)["cash-accounts"]["$post"]
>["header"];

type ApiResponse = Pick<Response, "headers" | "ok" | "status" | "json">;

export type MutationRequest = {
  identity: unknown;
  send: (header: MutationHeaders) => Promise<Envelope<MutationResult>>;
};

function mutation(
  identity: unknown,
  send: (header: MutationHeaders) => Promise<ApiResponse>,
): MutationRequest {
  return {
    identity,
    send: async (header) => decode(await send(header), mutationResultSchema),
  };
}

export const api = {
  summary: async (month: string) =>
    decode(await client.summary.$get({ query: { month } }), summarySchema),

  accounts: async () =>
    decode(await client["cash-accounts"].$get(), z.array(cashAccountSchema)),

  purchases: async (
    query: InferRequestType<(typeof client.transactions)["$get"]>["query"],
  ) =>
    decode(await client.transactions.$get({ query }), transactionsPageSchema),

  validateImport: async (
    backup: InferRequestType<
      (typeof client.imports.validate)["$post"]
    >["json"]["backup"],
  ) =>
    decode(
      await client.imports.validate.$post({ json: { backup } }),
      previewSchema,
    ),

  createCash: (
    json: InferRequestType<(typeof client)["cash-accounts"]["$post"]>["json"],
  ) =>
    mutation({ action: "createCash", json }, (header) =>
      client["cash-accounts"].$post({ json, header }),
    ),

  renameCash: (
    id: string,
    json: InferRequestType<
      (typeof client)["cash-accounts"][":id"]["$patch"]
    >["json"],
  ) =>
    mutation({ action: "renameCash", id, json }, (header) =>
      client["cash-accounts"][":id"].$patch({ param: { id }, json, header }),
    ),

  adjustCash: (
    id: string,
    json: InferRequestType<
      (typeof client)["cash-accounts"][":id"]["adjustments"]["$post"]
    >["json"],
  ) =>
    mutation({ action: "adjustCash", id, json }, (header) =>
      client["cash-accounts"][":id"].adjustments.$post({
        param: { id },
        json,
        header,
      }),
    ),

  createPurchase: (
    json: InferRequestType<(typeof client.transactions)["$post"]>["json"],
  ) =>
    mutation({ action: "createPurchase", json }, (header) =>
      client.transactions.$post({ json, header }),
    ),

  editPurchase: (
    id: string,
    json: InferRequestType<
      (typeof client.transactions)[":id"]["$patch"]
    >["json"],
  ) =>
    mutation({ action: "editPurchase", id, json }, (header) =>
      client.transactions[":id"].$patch({ param: { id }, json, header }),
    ),

  deletePurchase: (id: string, version: number) =>
    mutation({ action: "deletePurchase", id, version }, (header) =>
      client.transactions[":id"].$delete({
        param: { id },
        header: { ...header, "If-Match": `"${version}"` },
      }),
    ),

  setGoal: (
    json: InferRequestType<(typeof client)["btc-goal"]["$put"]>["json"],
  ) =>
    mutation({ action: "setGoal", json }, (header) =>
      client["btc-goal"].$put({ json, header }),
    ),

  replaceImport: (
    json: InferRequestType<(typeof client.imports.replace)["$post"]>["json"],
  ) =>
    mutation({ action: "replaceImport", json }, (header) =>
      client.imports.replace.$post({ json, header }),
    ),
};

let latestMeta: Meta | undefined;

export function getMeta() {
  return latestMeta;
}

export class RequestError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(
    message: string,
    code: string,
    status: number,
    requestId?: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export async function decode<T>(
  response: ApiResponse,
  schema: z.ZodType<T>,
): Promise<Envelope<T>> {
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new RequestError(
      "เซสชันหมดอายุ กรุณาโหลดหน้าใหม่เพื่อเข้าสู่ระบบ",
      "UNAUTHORIZED",
      401,
    );

  const raw = await response.json();

  if (!response.ok) {
    const failure = z
      .object({
        error: z.object({
          message: z.string(),
          code: z.string(),
          requestId: z.string().optional(),
        }),
      })
      .safeParse(raw);

    throw new RequestError(
      failure.success ? failure.data.error.message : "ไม่สามารถบันทึกได้",
      failure.success ? failure.data.error.code : "INTERNAL_ERROR",
      response.status,
      failure.success ? failure.data.error.requestId : undefined,
    );
  }

  const parsed = z.object({ data: schema, meta: metaSchema }).parse(raw);

  if (!latestMeta || parsed.meta.revision >= latestMeta.revision)
    latestMeta = parsed.meta;

  return parsed;
}

export async function downloadBackup() {
  const response = await client.backup.$get();

  const receipt = response.headers.get("X-Backup-Receipt");
  const result = await decode(response, backupSchema);

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    }),
  );

  const link = document.createElement("a");

  link.href = url;
  link.download = `stacklet-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return {
    ...result,
    receipt,
    restorable: response.headers.get("X-Backup-Restorable") === "true",
  };
}
