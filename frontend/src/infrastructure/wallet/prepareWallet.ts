import { sameAddress } from "../../domain/rules";
import type { WalletProvider } from "./useWallet";

// MetaMask requires the user to select the account in its permissions dialog.
// A website cannot silently select a specific account or import its private key.
export async function prepareWallet(provider: WalletProvider, expected: string | null, check: () => void) {
  const request = async (method: string, params?: unknown[]) => {
    check();
    const result = await provider.request({ method, ...(params ? { params } : {}) });
    check();
    return result;
  };
  let accounts = await request("eth_accounts") as string[];
  if (!accounts.length) accounts = await request("eth_requestAccounts") as string[];
  if (expected && !sameAddress(accounts[0], expected)) {
    await request("wallet_requestPermissions", [{ eth_accounts: {} }]);
    accounts = await request("eth_accounts") as string[];
  }
  if (!accounts[0]) throw new Error("Chưa kết nối được ví. Mở khóa MetaMask rồi thử lại.");
  if (expected && !sameAddress(accounts[0], expected))
    throw new Error(`Hãy chọn ví ${expected} trong MetaMask rồi bấm “Đồng bộ ví”. Nếu chưa có ví này, bạn cần thêm ví đó vào MetaMask trước.`);
  const chain = await request("eth_chainId") as string;
  if (BigInt(chain) !== 31337n) {
    try { await request("wallet_switchEthereumChain", [{ chainId: "0x7a69" }]); }
    catch (error) {
      check();
      if ((error as { code?: number }).code !== 4902) throw error;
      await request("wallet_addEthereumChain", [{ chainId: "0x7a69", chainName: "StudentEscrow Local",
        rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 } }]);
      await request("wallet_switchEthereumChain", [{ chainId: "0x7a69" }]);
    }
  }
  const finalAccounts = await request("eth_accounts") as string[];
  const finalChain = await request("eth_chainId") as string;
  if (!sameAddress(finalAccounts[0], expected ?? accounts[0]) || BigInt(finalChain) !== 31337n)
    throw new Error("Ví hoặc mạng đã thay đổi. Bấm “Đồng bộ ví” để kiểm tra lại.");
}
