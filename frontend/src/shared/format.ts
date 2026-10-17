import { formatEther } from "ethers";
export const formatEth = (wei: string) => `${formatEther(wei)} ETH`;
export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export function formatDate(value: string | number) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(typeof value === "number" ? value * 1000 : value));
}
export const formatBytes = (bytes: number) => bytes < 1000 ? `${bytes} B` : bytes < 1000000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1000000).toFixed(1)} MB`;
