import { parseUnits, formatUnits, formatThb } from "./money";

export const MAX_SATOSHIS = 2_100_000_000_000_000;
export const parseBtc = (value: string) => parseUnits(value, 8, MAX_SATOSHIS);
export const formatBtc = (value: number | bigint) => formatUnits(value, 8);

function roundDivide(value: bigint, divisor: bigint): bigint {
  if (value < 0n) return -roundDivide(-value, divisor);

  return (value + divisor / 2n) / divisor;
}

export function calculateBtcPerformance(
  quantity: string,
  costThb: string,
  priceThb: string,
) {
  const satoshis = BigInt(parseUnits(quantity, 8));
  const cost = BigInt(parseUnits(costThb, 2));
  const price = BigInt(parseUnits(priceThb, 8));

  if (price <= 0n) throw new Error("ราคา BTC ต้องมากกว่า 0");

  // Retain all eight price and quantity decimals; round only the final satang.
  const marketValue = roundDivide(satoshis * price, 100_000_000_000_000n);
  const profitLoss = marketValue - cost;

  return {
    priceThb: formatThb(roundDivide(price, 1_000_000n)),
    marketValueThb: formatThb(marketValue),
    profitLossThb: formatThb(profitLoss),
    profitLossPercent:
      cost === 0n
        ? null
        : formatUnits(roundDivide(profitLoss * 10_000n, cost), 2),
  };
}
