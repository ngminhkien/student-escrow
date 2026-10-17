import { formatEther, getAddress, parseEther, parseUnits, sha256, toUtf8Bytes } from "ethers";
import type { NetworkStatus, OrderView } from "./types";

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const eth = (wei: string) => formatEther(wei);
export const short = (value: string) => value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
export const date = (seconds?: number | null) => seconds ? new Date(seconds * 1000).toLocaleString("vi-VN") : "—";
export const states: Record<string, string> = { Draft: "Bản nháp", Created: "Đã tạo trên chain", Funded: "Đã ký quỹ",
  Delivered: "Đã bàn giao", Completed: "Hoàn thành", Disputed: "Đang tranh chấp", Resolved: "Đã phân xử", Refunded: "Đã hoàn tiền" };
export function amountWei(input: string) {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(input)) throw new Error("Nhập số ETH dương, tối đa 18 chữ số thập phân.");
  const wei = parseEther(input);
  if (wei <= 0n || wei >= 10n ** 38n) throw new Error("Số tiền nằm ngoài giới hạn contract.");
  return wei.toString();
}
export function shareBps(input: string) {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(input)) throw new Error("Tỷ lệ Seller từ 0 đến 100%, tối đa 2 số thập phân.");
  const value = parseUnits(input, 2);
  if (value > 10000n) throw new Error("Tỷ lệ Seller không vượt quá 100%.");
  return value;
}
export function settlement(amount: string, percent: string) {
  const gross = BigInt(amount) * shareBps(percent) / 10000n;
  const fee = gross / 100n;
  return { buyer: BigInt(amount) - gross, seller: gross - fee, fee };
}
export function address(input: string) {
  const value = getAddress(input.trim());
  if (/^0x0{40}$/i.test(value)) throw new Error("Không dùng địa chỉ zero.");
  return value;
}
export function validateTerms(view: OrderView, network: NetworkStatus) {
  const d = view.draft;
  if (!network.deploymentId || !network.contractAddress || d.deploymentId !== network.deploymentId) throw new Error("Đơn thuộc deployment cũ. Hãy tạo bản nháp mới.");
  if (sha256(toUtf8Bytes(d.termsJson)) !== d.termsHash) throw new Error("Hash điều khoản không khớp.");
  const terms = JSON.parse(d.termsJson);
  if (terms.version !== 1 || String(terms.chainId) !== network.chainId || !sameAddress(terms.contract, network.contractAddress)
    || terms.deploymentId !== d.deploymentId || terms.clientReference !== d.clientReference
    || !sameAddress(terms.buyer, d.buyer) || !sameAddress(terms.seller, d.seller) || !sameAddress(terms.arbiter, d.arbiter)
    || terms.amountWei !== d.amountWei || terms.description !== d.description || terms.acceptanceCriteria !== d.acceptanceCriteria
    || terms.deliveryDeadline !== d.deliveryDeadline || terms.reviewWindow !== d.reviewWindow || terms.feeBps !== 100)
    throw new Error("Nội dung điều khoản khác với bản nháp.");
}
export function actions(view: OrderView, account: string, network: NetworkStatus, time: number) {
  const d = view.draft, state = view.chain?.state;
  const active = network.status === "Ready" && view.syncStatus === "Ready" && d.deploymentId === network.deploymentId;
  const buyer = sameAddress(account, d.buyer), seller = sameAddress(account, d.seller), arbiter = sameAddress(account, d.arbiter);
  const valid = active && view.termsMatch;
  const beforeDelivery = time <= d.deliveryDeadline;
  const beforeReview = !!view.chain?.reviewDeadline && time <= view.chain.reviewDeadline;
  return {
    create: active && !view.chain && buyer && time < d.deliveryDeadline,
    deposit: valid && state === "Created" && buyer && beforeDelivery,
    deliver: valid && state === "Funded" && seller && beforeDelivery,
    confirm: valid && state === "Delivered" && buyer && beforeReview && view.deliveryFileMatchesChain,
    dispute: valid && (buyer || seller) && ((state === "Funded" && beforeDelivery) || (state === "Delivered" && beforeReview)),
    refund: valid && state === "Funded" && buyer && !beforeDelivery,
    claim: valid && state === "Delivered" && seller && !beforeReview,
    resolve: valid && state === "Disputed" && arbiter,
    product: valid && state === "Funded" && seller && !view.files.some(f => f.kind === "product"),
    evidence: valid && (buyer || seller) && ["Funded", "Delivered", "Disputed"].includes(state ?? "")
      && view.files.filter(f => f.kind === "evidence").length < 5
  };
}
