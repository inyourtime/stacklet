import { parseUnits, formatUnits } from "./money";

export const MAX_SATOSHIS = 2_100_000_000_000_000;
export const parseBtc = (value: string) => parseUnits(value, 8, MAX_SATOSHIS);
export const formatBtc = (value: number | bigint) => formatUnits(value, 8);
