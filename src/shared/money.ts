export const MAX_MONEY = 100_000_000_000;
export const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function parseUnits(
  value: string,
  decimals: number,
  max = MAX_SAFE,
): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);

  if (!match || (match[2]?.length ?? 0) > decimals)
    throw new Error("กรอกจำนวนและทศนิยมให้ถูกต้อง");

  const result =
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");

  if (result > BigInt(max)) throw new Error("จำนวนเกินขอบเขตที่รองรับ");

  return Number(result);
}

export function formatUnits(value: number | bigint, decimals: number): string {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const a = n < 0n ? -n : n;
  const divisor = 10n ** BigInt(decimals);

  return `${sign}${a / divisor}.${(a % divisor).toString().padStart(decimals, "0")}`;
}

export const parseThb = (value: string) => parseUnits(value, 2, MAX_MONEY);
export const formatThb = (value: number | bigint) => formatUnits(value, 2);

export function displayThb(value: string): string {
  const [whole, fraction = "00"] = value.split(".");

  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

export function safeSum(values: number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);

  if (total > BigInt(MAX_SAFE) || total < 0n)
    throw new Error("ผลรวมเกินขอบเขตที่รองรับ");

  return Number(total);
}

export function bangkokMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

export function bangkokDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
