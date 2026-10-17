import { BrowserProvider, Contract, Interface, toQuantity } from "ethers";
import type { TransactionReceipt, TransactionResponse } from "ethers";
import abi from "../../../../blockchain/deployment/Escrow.abi.json";
import { health } from "../../services/health";
import { sameAddress } from "../../domain/rules";
import type { TxRecord } from "../../domain/types";
import { injected } from "./useWallet";
import type { WalletProvider } from "./useWallet";
export async function assertWallet(expected: string, provider: WalletProvider | undefined = injected()) {
  if (!provider) throw new Error("MetaMask chưa sẵn sàng.");
  if (provider !== injected()) throw new Error("Ví đang hoạt động đã thay đổi. Hãy thử lại.");
  const chain = await provider.request({ method: "eth_chainId" }) as string;
  if (provider !== injected()) throw new Error("Ví đang hoạt động đã thay đổi. Hãy thử lại.");
  if (BigInt(chain) !== 31337n) throw new Error("Sai mạng. Chuyển MetaMask sang StudentEscrow Local (31337).");
  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  if (provider !== injected()) throw new Error("Ví đang hoạt động đã thay đổi. Hãy thử lại.");
  if (!sameAddress(accounts[0], expected)) throw new Error("Ví MetaMask đã đổi. Chọn đúng ví của thao tác này.");
  return new BrowserProvider(provider);
}

export async function sendTransaction(expected: string, deploymentId: string, method: string, args: unknown[],
  record: (transaction: TxRecord) => void, assertScope: () => void = () => {}) {
  const selectedProvider = injected();
  const check = () => {
    assertScope();
    if (selectedProvider !== injected()) throw new Error("Ví đang hoạt động đã thay đổi. Hãy thử lại.");
  };
  check();
  const network = await health();
  check();
  if (network.status !== "Ready" || network.deploymentId !== deploymentId || !network.deploymentBlock || !network.deploymentBlockHash)
    throw new Error("Deployment đã đổi hoặc worker chưa sẵn sàng. Tải lại dữ liệu trước khi ký.");
  await assertWallet(expected, selectedProvider);
  check();
  if (!selectedProvider) throw new Error("MetaMask chưa sẵn sàng.");
  // ethers may estimate gas asynchronously after the last preflight check.
  // Guard the actual wallet dispatch, while allowing submitted receipts to finish.
  const provider = new BrowserProvider({
    request: async input => {
      if (["eth_sendTransaction", "eth_sendRawTransaction", "eth_signTransaction", "eth_sign", "personal_sign", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4"].includes(input.method)) check();
      return selectedProvider.request(input);
    }
  });
  const block = await provider.send("eth_getBlockByNumber", [toQuantity(network.deploymentBlock), false]);
  check();
  if (block?.hash !== network.deploymentBlockHash) throw new Error("RPC trong MetaMask khác blockchain của API. Kiểm tra URL mạng local.");
  const code = await provider.getCode(network.contractAddress!);
  check();
  if (code === "0x") throw new Error("Contract không còn tồn tại. Hãy deploy và tải lại.");
  const signer = await provider.getSigner(expected);
  check();
  const contract = new Contract(network.contractAddress!, abi, signer);
  const operation = contract.getFunction(method);
  const last = args.at(-1);
  const preflight = last && typeof last === "object" && "value" in last
    ? [...args.slice(0, -1), { ...last, blockTag: "pending" }] : [...args, { blockTag: "pending" }];
  await operation.staticCall(...preflight);
  check();
  // Recheck after potentially slow RPC/preflight, before opening the signing prompt.
  await assertWallet(expected, selectedProvider);
  check();
  const response = await operation(...args) as TransactionResponse;
  const transaction = { hash: response.hash, label: method, deploymentId, address: expected, status: "Đang chờ xác nhận" };
  record(transaction);
  let receipt: TransactionReceipt | null;
  try { receipt = await response.wait(1, 90000); }
  catch (error) {
    const replacement = error as { code?: string; cancelled?: boolean; receipt?: TransactionReceipt; replacement?: TransactionResponse };
    if (replacement.code === "TRANSACTION_REPLACED") {
      if (replacement.cancelled) {
        record({ ...transaction, status: "Đã hủy/thay bằng giao dịch khác" });
        throw new Error("Giao dịch đã bị hủy hoặc thay thế trong ví. Trạng thái đơn sẽ lấy lại từ blockchain.");
      }
      receipt = replacement.receipt ?? null;
      transaction.hash = replacement.replacement?.hash ?? transaction.hash;
    } else {
      record({ ...transaction, status: replacement.receipt?.status === 0 ? "Thất bại" : "Chưa xác định — kiểm tra lại" });
      throw error;
    }
  }
  if (!receipt || receipt.status !== 1) { record({ ...transaction, status: "Thất bại" }); throw new Error("Giao dịch không thành công."); }
  record({ ...transaction, status: "Đã xác nhận trên chain" });
}

const messages: Record<string, string> = {
  WalletNotVerified: "Buyer hoặc Seller chưa được Admin xác minh on-chain.",
  DuplicateReference: "Bản nháp đã được tạo trên chain. Chờ worker đồng bộ, không tạo lại.",
  InvalidState: "Trạng thái trên chain đã thay đổi. Tải lại đơn.",
  Unauthorized: "Ví hiện tại không có quyền thực hiện thao tác này.",
  DeadlinePassed: "Đã quá hạn thao tác trên blockchain.", DeadlineNotPassed: "Chưa qua hạn trên blockchain.",
  IncorrectDeposit: "Số tiền ký quỹ không đúng điều khoản.",
  AccessControlUnauthorizedAccount: "Ví hiện tại không có quyền Admin tương ứng."
};
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const e = error as Error & { code?: string | number; shortMessage?: string; data?: string; info?: { error?: { code?: number; data?: string } } };
    if (e.code === 4001 || e.code === "ACTION_REJECTED" || e.info?.error?.code === 4001) return "Bạn đã từ chối yêu cầu trong MetaMask. Có thể thử lại khi sẵn sàng.";
    if (e.code === -32002) return "Đang có yêu cầu trong MetaMask. Mở ví và xử lý yêu cầu đó trước.";
    if (e.code === "INSUFFICIENT_FUNDS") return "Ví không đủ ETH local để trả số tiền và gas.";
    if (e.code === "TIMEOUT") return "Chưa nhận được xác nhận giao dịch. Kiểm tra lịch sử giao dịch trước khi thử lại.";
    try {
      const data = e.data ?? e.info?.error?.data;
      if (typeof data === "string") {
        const decoded = new Interface(abi).parseError(data);
        if (decoded && messages[decoded.name]) return messages[decoded.name];
      }
    } catch { /* Fall through to the provider's error. */ }
    return e.shortMessage ?? e.message;
  }
  return "Không thực hiện được thao tác. Kiểm tra API, node local và MetaMask.";
}
