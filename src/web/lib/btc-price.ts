import { z } from "zod";
import { parseUnits } from "../../shared/money";

export const BTC_PRICE_URL =
  "https://api.binance.th/api/v1/ticker/price?symbol=BTCTHB";

const priceSchema = z.object({
  symbol: z.literal("BTCTHB"),
  price: z
    .string()
    .max(32)
    .refine((value) => {
      try {
        return parseUnits(value, 8) > 0;
      } catch {
        return false;
      }
    }),
});

export async function fetchBtcPrice(signal?: AbortSignal) {
  const response = await fetch(BTC_PRICE_URL, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000),
    credentials: "omit",
    cache: "no-store",
  });

  if (!response.ok) throw new Error("ไม่สามารถดึงราคา BTC ได้");

  const parsed = priceSchema.safeParse(await response.json());

  if (!parsed.success) throw new Error("ข้อมูลราคา BTC ไม่ถูกต้อง");

  return parsed.data.price;
}
