import { formatEther } from "ethers";

// Fixed demo rate, not a market price. backend ExchangeRate.cs repeats these values; rules.unit.ts fails if they differ.
export const VND_PER_ETH = 100_000_000n;
export const WEI_PER_VND = 10_000_000_000n;
const MAX_VND = 10n ** 28n;

// backend DepositLimits repeats these; the server's check is the one that counts.
export const DEPOSIT_MIN_VND = 10_000;
export const DEPOSIT_MAX_VND = 50_000_000;

const grouped = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function vndToWei(input: string): string {
  const digits = input.trim().replace(/[.,\s]/g, "");
  if (!/^[1-9]\d*$/.test(digits)) throw new Error("Nhập số tiền VND là số nguyên dương.");
  const vnd = BigInt(digits);
  if (vnd >= MAX_VND) throw new Error("Số tiền nằm ngoài giới hạn.");
  return (vnd * WEI_PER_VND).toString();
}
export function parseDepositVnd(input: string): number {
  const digits = input.trim().replace(/[.,\s]/g, "");
  if (!/^[1-9]\d*$/.test(digits)) throw new Error("Nhập số tiền VND là số nguyên dương.");
  const vnd = BigInt(digits);
  if (vnd < BigInt(DEPOSIT_MIN_VND) || vnd > BigInt(DEPOSIT_MAX_VND)) throw new Error(`Số tiền nạp phải từ ${grouped(BigInt(DEPOSIT_MIN_VND))} ₫ đến ${grouped(BigInt(DEPOSIT_MAX_VND))} ₫.`);
  return Number(vnd);
}
// Truncates: showing a balance higher than what can be spent would be worse than hiding a fraction of a dong.
export function formatVnd(wei: string | bigint): string {
  const amount = BigInt(wei);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const vnd = absolute / WEI_PER_VND;
  if (vnd === 0n && absolute > 0n) return `${negative ? "> -" : "< "}1 ₫`;
  return `${negative ? "-" : ""}${grouped(vnd)} ₫`;
}
export const formatEthAmount = (wei: string | bigint) => `${formatEther(wei)} ETH`;
