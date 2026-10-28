import { toQuantity } from "ethers";
import type { NetworkStatus } from "../../domain/types";
import type { WalletProvider } from "./useWallet";

export type WalletNetworkIdentity = {
  status: "matched" | "cached-block" | "mismatch" | "unavailable";
  message: string;
  blockNumber: number | null;
  expectedHash: string;
  walletHash: string | null;
  chainId: string | null;
};
type Block = { hash?: string; number?: string } | null;
const sameHex = (left?: string | null, right?: string | null) => !!left && !!right && left.toLowerCase() === right.toLowerCase();

/** Read-only comparison. Never retries, signs or submits a transaction. */
export async function inspectWalletNetwork(
  wallet: WalletProvider, network: NetworkStatus, check: () => void,
  apiCodeAtHash: (hash: string) => Promise<string>
): Promise<WalletNetworkIdentity> {
  const result: WalletNetworkIdentity = { status: "unavailable", message: "Chưa đủ dữ liệu để kiểm tra blockchain.",
    blockNumber: network.deploymentBlock ?? null, expectedHash: network.deploymentBlockHash ?? "", walletHash: null, chainId: null };
  if (network.status !== "Ready" || !network.contractAddress || !network.deploymentBlock || !/^0x[0-9a-f]{64}$/i.test(result.expectedHash)) return result;
  const request = async (method: string, params: unknown[] = []) => {
    check();
    const value = await wallet.request({ method, params });
    check();
    return value;
  };
  try {
    result.chainId = String(BigInt(await request("eth_chainId") as string));
    if (result.chainId !== (network.chainId ?? "31337")) return { ...result, status: "mismatch", message: `MetaMask đang ở chain ${result.chainId}; API yêu cầu chain ${network.chainId ?? "31337"}.` };
    const block = await request("eth_getBlockByNumber", [toQuantity(network.deploymentBlock), false]) as Block;
    result.walletHash = block?.hash ?? null;
    if (sameHex(result.walletHash, result.expectedHash)) return { ...result, status: "matched", message: "MetaMask và API đang dùng cùng blockchain." };

    // MetaMask may retain block-number responses after a local node is reset.
    // A block-hash lookup alone is insufficient: the block must be canonical.
    const exactBlock = await request("eth_getBlockByHash", [result.expectedHash, false]) as Block;
    if (!sameHex(exactBlock?.hash, result.expectedHash) || !exactBlock?.number || BigInt(exactBlock.number) !== BigInt(network.deploymentBlock))
      return { ...result, status: "mismatch", message: "Không tìm thấy block deployment của API trong blockchain MetaMask đang dùng." };
    const code = await request("eth_getCode", [network.contractAddress, { blockHash: result.expectedHash, requireCanonical: true }]) as string;
    const apiCode = await apiCodeAtHash(result.expectedHash);
    check();
    if (code === "0x" || apiCode === "0x" || !sameHex(code, apiCode))
      return { ...result, status: "mismatch", message: "Mã contract trong MetaMask không khớp contract của API tại block deployment." };
    return { ...result, status: "cached-block", message: "Đã xác minh MetaMask cùng blockchain với API. Dữ liệu block theo số của MetaMask chưa được cập nhật; block theo hash chuẩn và mã contract đã khớp." };
  } catch (failure) {
    check();
    const error = failure as { shortMessage?: string; message?: string };
    return { ...result, status: "unavailable", message: `Chưa xác minh được blockchain từ MetaMask: ${error.shortMessage ?? error.message ?? "RPC không phản hồi"}.` };
  }
}

export function requireMatchingWalletNetwork(result: WalletNetworkIdentity): void {
  if (result.status === "matched" || result.status === "cached-block") return;
  throw new Error(`${result.message} Block ${result.blockNumber ?? "—"}: API ${result.expectedHash || "chưa có"}; MetaMask ${result.walletHash ?? "không đọc được"}. Kiểm tra RPC mạng local http://127.0.0.1:8545. Cổng 5173 là website, không phải RPC.`);
}
