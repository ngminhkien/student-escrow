import { useCallback, useEffect, useState, useRef } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import type { Eip1193Provider } from "ethers";
import abi from "../../../../blockchain/deployment/Escrow.abi.json";
import type { NetworkStatus } from "../../domain/types";

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
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++generation.current;
    const provider = injected();
    if (!provider) { setAvailable(false); setAccount(""); setChainId(""); return; }
    setAvailable(true);
    try {
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const chain = await provider.request({ method: "eth_chainId" }) as string;
      if (requestId !== generation.current || provider !== injected()) return;
      setAccount(accounts[0] ?? ""); setChainId(String(BigInt(chain)));
      return { account: accounts[0] ?? "", chainId: String(BigInt(chain)) };
    } catch { if (requestId === generation.current && provider === injected()) { setAccount(""); setChainId(""); } }
  }, []);
  useEffect(() => {
    const discover = (event: Event) => {
      const detail = (event as CustomEvent<{ info: { rdns: string }; provider: WalletProvider }>).detail;
      if (detail?.info?.rdns === "io.metamask" && typeof detail.provider?.request === "function" && discovered !== detail.provider) { generation.current++; discovered = detail.provider; setAccount(""); setChainId(""); setRevision(v => v + 1); }
    };
    window.addEventListener("eip6963:announceProvider", discover);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", discover);
  }, []);
  useEffect(() => {
    void refresh();
    const provider = injected();
    const changed = () => { void refresh(); };
    const accountsChanged = (...args: unknown[]) => {
      generation.current++;
      const accounts = args[0];
      setAccount(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "");
      void refresh();
    };
    const chainChanged = (...args: unknown[]) => {
      generation.current++;
      try { setChainId(String(BigInt(String(args[0])))); } catch { setChainId(""); }
      void refresh();
    };
    const disconnected = () => { generation.current++; setAccount(""); setChainId(""); };
    provider?.on?.("accountsChanged", accountsChanged); provider?.on?.("chainChanged", chainChanged); provider?.on?.("disconnect", disconnected);
    window.addEventListener("focus", changed);
    return () => {
      generation.current++;
      provider?.removeListener?.("accountsChanged", accountsChanged); provider?.removeListener?.("chainChanged", chainChanged);
      provider?.removeListener?.("disconnect", disconnected); window.removeEventListener("focus", changed);
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
  async function changeAccount() {
    const provider = injected();
    if (!provider) throw new Error("Chưa tìm thấy MetaMask. Mở khóa ví rồi tải lại trang.");
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    await refresh();
  }
  return { account, chainId, available, connect, changeAccount, switchNetwork, refresh };
}

