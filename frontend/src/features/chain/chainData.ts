import { useEffect, useState } from "react";
import { Interface } from "ethers";
import abi from "../../../../blockchain/deployment/Escrow.abi.json";
import { sameAddress } from "../../domain/rules";
import { rpc } from "../../infrastructure/wallet/useWallet";
import { errorMessage } from "../../infrastructure/wallet/transactions";

export type RawLog = { address: string; topics: string[]; data: string };
export type RawTransaction = { hash: string; from: string; to: string | null; value: string; input: string; blockNumber: string | null };
export type RawReceipt = { status: string; gasUsed: string; effectiveGasPrice?: string; contractAddress: string | null; logs: RawLog[] };
export type RawBlock<T = RawTransaction | string> = { number: string; hash: string; parentHash: string; timestamp: string; transactions: T[] };
export type ChainReceipt = { tx: RawTransaction; receipt: RawReceipt | null; block: RawBlock | null };
export type ReceiptEvent = { name: string; detail: string };
export type Summary = { title: string; amountLabel?: string; amountWei?: bigint; lines: { label: string; wei: bigint }[] };

const HEAD_POLL_MS = 1000;
const BLOCK_BATCH = 20;
const escrow = new Interface(abi);
const ACTIONS: Record<string, string> = {
  createOrder: "Tạo đơn", acceptOrder: "Seller chấp nhận đơn", cancelOrder: "Hủy đơn", deposit: "Ký quỹ", markDelivered: "Seller bàn giao",
  confirmReceipt: "Buyer nghiệm thu", raiseDispute: "Mở tranh chấp", resolveDispute: "Phân xử tranh chấp", refundIfExpired: "Hoàn tiền do quá hạn giao",
  claimAfterReviewTimeout: "Seller nhận tiền sau hạn phản hồi", claimDisputeTimeout: "Chia đôi do quá hạn phân xử", withdraw: "Rút khoản tiền chờ",
  grantRole: "Cấp quyền", revokeRole: "Thu hồi quyền", renounceRole: "Từ bỏ quyền"
};

export const isTransactionHash = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);
export const hexNumber = (hex: string) => Number(BigInt(hex));
export const blockTime = (block: { timestamp: string }) => new Date(hexNumber(block.timestamp) * 1000).toISOString();

function contractEvents(receipt: RawReceipt | null, contract?: string) {
  return (receipt?.logs ?? []).flatMap(log => {
    if (contract && !sameAddress(log.address, contract)) return [];
    try { const parsed = escrow.parseLog(log); return parsed ? [parsed] : []; } catch { return []; }
  });
}

export function receiptEvents(receipt: RawReceipt | null, contract?: string): ReceiptEvent[] {
  return contractEvents(receipt, contract).map(event => ({ name: event.name, detail: event.fragment.inputs.map((input, index) => `${input.name}: ${String(event.args[index])}`).join(", ") }));
}

function actionTitle(tx: RawTransaction, contract?: string) {
  if (!tx.to) return "Deploy contract";
  if (!sameAddress(tx.to, contract ?? "")) return tx.input === "0x" ? "Chuyển ETH" : "Gọi contract";
  try {
    const call = escrow.parseTransaction({ data: tx.input, value: BigInt(tx.value) });
    if (call?.name === "setWalletVerified") return call.args[1] ? "Xác minh ví" : "Thu hồi xác minh ví";
    if (call?.name === "setArbiterApproved") return call.args[1] ? "Thêm Arbiter" : "Gỡ Arbiter";
    return (call && ACTIONS[call.name]) ?? call?.name ?? "Gọi contract";
  } catch { return "Gọi contract"; }
}

// What a person would want on the bill: the action in words, how much moved, and where it went.
export function summarize({ tx, receipt }: ChainReceipt, contract?: string): Summary {
  const events = contractEvents(receipt, contract);
  const event = (name: string) => events.find(item => item.name === name)?.args;
  const orderId = events.find(item => item.fragment.inputs.some(input => input.name === "orderId"))?.args.orderId;
  const action = actionTitle(tx, contract);
  const title = orderId === undefined ? action : `${action} · Đơn #${orderId}`;
  const released = event("Released"), resolved = event("Resolved"), refunded = event("Refunded");
  if (released) return { title, amountLabel: "Tổng thanh toán", amountWei: released.sellerGrossWei, lines: [{ label: "Seller nhận", wei: released.sellerNetWei }, { label: "Phí nền tảng", wei: released.platformFeeWei }] };
  if (resolved) return { title, amountLabel: "Tổng số tiền phân xử", amountWei: resolved.buyerRefundWei + resolved.sellerGrossWei, lines: [{ label: "Buyer được hoàn", wei: resolved.buyerRefundWei }, { label: "Seller nhận", wei: resolved.sellerNetWei }, { label: "Phí nền tảng", wei: resolved.platformFeeWei }] };
  if (refunded) return { title, amountLabel: "Số tiền hoàn", amountWei: refunded.buyerRefundWei, lines: [{ label: "Buyer được hoàn", wei: refunded.buyerRefundWei }] };
  const deposited = event("Deposited"), created = event("OrderCreated"), withdrawn = event("Withdrawn");
  if (deposited) return { title, amountLabel: "Số tiền ký quỹ", amountWei: deposited.amountWei, lines: [] };
  if (created) return { title, amountLabel: "Giá trị đơn", amountWei: created.amountWei, lines: [] };
  if (withdrawn) return { title, amountLabel: "Số tiền rút", amountWei: withdrawn.amountWei, lines: [] };
  const value = BigInt(tx.value);
  return value > 0n ? { title, amountLabel: "Số tiền chuyển", amountWei: value, lines: [] } : { title, lines: [] };
}

export function gasFee(receipt: RawReceipt | null) {
  return receipt?.effectiveGasPrice ? BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) : null;
}

export async function loadReceipt(hash: string): Promise<ChainReceipt | null> {
  const tx: RawTransaction | null = await rpc.send("eth_getTransactionByHash", [hash]);
  if (!tx) return null;
  const [receipt, block] = await Promise.all<[Promise<RawReceipt | null>, Promise<RawBlock | null>]>([
    rpc.send("eth_getTransactionReceipt", [hash]),
    tx.blockNumber ? rpc.send("eth_getBlockByNumber", [tx.blockNumber, false]) : Promise.resolve(null)
  ]);
  return { tx, receipt, block };
}

const getBlock = (number: number): Promise<RawBlock<RawTransaction>> => rpc.send("eth_getBlockByNumber", ["0x" + number.toString(16), true]);

// Pages walk the chain downward from a block, because how many transactions lie below it is unknown without reading them all.
export async function loadReceiptPage(start: number, size: number): Promise<{ rows: ChainReceipt[]; next: number | null }> {
  const found: { tx: RawTransaction; block: RawBlock }[] = [];
  let cursor = start;
  while (cursor >= 0 && found.length < size) {
    const numbers = Array.from({ length: Math.min(BLOCK_BATCH, cursor + 1) }, (_, index) => cursor - index);
    const blocks = await Promise.all(numbers.map(getBlock));
    for (const block of blocks) {
      if (found.length >= size) break;
      for (const tx of [...block.transactions].reverse()) found.push({ tx, block });
      cursor = hexNumber(block.number) - 1;
    }
  }
  const receipts: RawReceipt[] = await Promise.all(found.map(item => rpc.send("eth_getTransactionReceipt", [item.tx.hash])));
  return { rows: found.map((item, index) => ({ ...item, receipt: receipts[index] })), next: cursor >= 0 ? cursor : null };
}

export async function loadBlockPage(head: number, page: number, size: number) {
  const top = head - page * size;
  const numbers = Array.from({ length: Math.max(0, Math.min(size, top + 1)) }, (_, index) => top - index);
  return Promise.all(numbers.map(getBlock));
}

// Asks the node itself, so this tab keeps working when the API is down.
export function useChainHead() {
  const [state, setState] = useState<{ head: number | null; error: string }>({ head: null, error: "" });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const head = hexNumber(await rpc.send("eth_blockNumber", []));
        if (active) setState(previous => previous.head === head && !previous.error ? previous : { head, error: "" });
      } catch (failure) {
        if (active) setState(previous => ({ head: previous.head, error: errorMessage(failure) }));
      }
      if (active) timer = setTimeout(() => void tick(), HEAD_POLL_MS);
    }
    void tick();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return state;
}
