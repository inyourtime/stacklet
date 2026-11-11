import type { ZodType } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationResult } from "../../shared/contracts";
import { bangkokMonth } from "../../shared/money";
import { api, getMeta, RequestError, type MutationRequest } from "./api";
import { queryKeys } from "./query-keys";

export function useNotice(initialMessage = "") {
  const [notice, setNotice] = useState<{ message: string } | null>(() =>
    initialMessage ? { message: initialMessage } : null,
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message ? { message } : null);
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => setNotice(null), 5000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  return [notice?.message ?? "", showNotice] as const;
}

export function useSummary(month = bangkokMonth()) {
  return useQuery({
    queryKey: queryKeys.summary(month),
    queryFn: () => api.summary(month),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.cash,
    queryFn: () => api.accounts(),
  });
}

export function useOperation(onSuccess?: (data: MutationResult) => void) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const epoch = useRef(getMeta()?.datasetEpoch);

  const run = async (operation: MutationRequest) => {
    if (pending) return;

    const fingerprint = JSON.stringify(operation.identity);

    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, key: crypto.randomUUID() };

    setPending(true);
    setError("");

    try {
      if (!epoch.current) throw new Error("กรุณาโหลดข้อมูลก่อนบันทึก");

      const result = await operation.send({
        "Idempotency-Key": intent.current.key,
        "X-Dataset-Epoch": epoch.current,
      });

      intent.current = null;
      await client.invalidateQueries({ queryKey: queryKeys.all });
      onSuccess?.(result.data);

      return result;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "การเชื่อมต่อขัดข้อง กรุณาลองบันทึกอีกครั้ง",
      );

      if (e instanceof RequestError && e.status === 409)
        await client.invalidateQueries({ queryKey: queryKeys.all });
    } finally {
      setPending(false);
    }
  };

  const submit = <T>(
    schema: ZodType<T>,
    input: unknown,
    operation: (data: T) => MutationRequest,
  ) => {
    const parsed = schema.safeParse(input);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      return;
    }

    return run(operation(parsed.data));
  };

  return { pending, error, setError, run, submit };
}
