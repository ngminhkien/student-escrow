import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, Interface, JsonRpcProvider, toQuantity } from "ethers";
import type { Eip1193Provider, TransactionReceipt, TransactionResponse } from "ethers";
import abi from "../../blockchain/deployment/Escrow.abi.json";
import { health } from "./api";
import { sameAddress } from "./rules";
import type { NetworkStatus, TxRecord } from "./types";

export interface WalletProvider extends Eip1193Provider {
  isMetaMask?: boolean;
  providers?: WalletProvider[];
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
}
declare global { interface Window { ethereum?: WalletProvider } }
let discovered: WalletProvider | undefined;
export function injected() { return discovered ?? window.ethereum?.providers?.find(p => p.isMetaMask) ?? window.ethereum; }
export const rpc = new JsonRpcProvider(new URL("/rpc", window.location.origin).href);
export async function pendingTimestamp(): Promise<number> {
  // Hardhat returns number=null for pending blocks; ethers.getBlock cannot format it.
  const block = await rpc.send("eth_getBlockByNumber", ["pending", false]);
  const timestamp = Number(BigInt(block?.timestamp ?? "0x0"));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Không đọc được thời gian blockchain.");
  return timestamp;
}
export const contractAt = (network: NetworkStatus) => {
  if (!network.contractAddress) throw new Error("Contract chưa sẵn sàng.");
  return new Contract(network.contractAddress, abi, rpc);
};

export function useWallet() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [available, setAvailable] = useState(!!injected());
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(async () => {
    const provider = injected();
    if (!provider) { setAvailable(false); setAccount(""); setChainId(""); return; }
    setAvailable(true);
    try {
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const chain = await provider.request({ method: "eth_chainId" }) as string;
      setAccount(accounts[0] ?? ""); setChainId(String(BigInt(chain)));
    } catch { setAccount(""); setChainId(""); }
  }, []);
  useEffect(() => {
    const discover = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { rdns: string }; provider: WalletProvider }>).detail;
      if (detail.info.rdns === "io.metamask" && discovered !== detail.provider) { discovered = detail.provider; setRevision(v => v + 1); }
    };
    window.addEventListener("eip6963:announceProvider", discover);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", discover);
  }, []);
  useEffect(() => {
    void refresh();
    const provider = injected();
    const changed = () => { setAccount(""); setChainId(""); void refresh(); };
    provider?.on?.("accountsChanged", changed); provider?.on?.("chainChanged", changed); provider?.on?.("disconnect", changed);
    window.addEventListener("focus", changed);
    return () => {
      provider?.removeListener?.("accountsChanged", changed); provider?.removeListener?.("chainChanged", changed);
      provider?.removeListener?.("disconnect", changed); window.removeEventListener("focus", changed);
    };
  }, [revision, refresh]);
  async function connect() {
    const provider = injected();
    if (!provider) throw new Error("Chưa tìm thấy MetaMask. Cài extension, mở khóa ví rồi tải lại trang.");
    await provider.request({ method: "eth_requestAccounts" });
    await refresh();
  }
  async function switchNetwork() {
    const provider = injected();
    if (!provider) throw new Error("Cần cài MetaMask trước.");
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x7a69", chainName: "StudentEscrow Local",
        rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 } }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
    }
    await refresh();
  }
  return { account, chainId, available, connect, switchNetwork, refresh };
}

export async function assertWallet(expected: string) {
  const provider = injected();
  if (!provider) throw new Error("MetaMask chưa sẵn sàng.");
  const chain = await provider.request({ method: "eth_chainId" }) as string;
  if (BigInt(chain) !== 31337n) throw new Error("Sai mạng. Chuyển MetaMask sang StudentEscrow Local (31337).");
  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  if (!sameAddress(accounts[0], expected)) throw new Error("Ví MetaMask đã đổi. Chọn đúng ví của thao tác này.");
  return new BrowserProvider(provider);
}

export async function sendTransaction(expected: string, deploymentId: string, method: string, args: unknown[],
  record: (transaction: TxRecord) => void) {
  const network = await health();
  if (network.status !== "Ready" || network.deploymentId !== deploymentId || !network.deploymentBlock || !network.deploymentBlockHash)
    throw new Error("Deployment đã đổi hoặc worker chưa sẵn sàng. Tải lại dữ liệu trước khi ký.");
  const provider = await assertWallet(expected);
  const block = await provider.send("eth_getBlockByNumber", [toQuantity(network.deploymentBlock), false]);
  if (block?.hash !== network.deploymentBlockHash) throw new Error("RPC trong MetaMask khác blockchain của API. Kiểm tra URL mạng local.");
  if (await provider.getCode(network.contractAddress!) === "0x") throw new Error("Contract không còn tồn tại. Hãy deploy và tải lại.");
  const signer = await provider.getSigner(expected);
  const contract = new Contract(network.contractAddress!, abi, signer);
  const operation = contract.getFunction(method);
  const last = args.at(-1);
  const preflight = last && typeof last === "object" && "value" in last
    ? [...args.slice(0, -1), { ...last, blockTag: "pending" }] : [...args, { blockTag: "pending" }];
  await operation.staticCall(...preflight);
  // Recheck after potentially slow RPC/preflight, before opening the signing prompt.
  await assertWallet(expected);
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
