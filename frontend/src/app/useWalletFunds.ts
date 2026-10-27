import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { rpc } from "../infrastructure/wallet/useWallet";

export function useWalletFunds(account: string, enabled: boolean) {
  const [value, setValue] = useState<{ account: string; balance: string; gasPrice: string; error: string } | null>(null);
  useEffect(() => {
    if (!account || !enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [balance, gasPrice] = await Promise.all([rpc.getBalance(account, "pending"), rpc.send("eth_gasPrice", [])]);
        if (active) setValue({ account, balance: formatEther(balance), gasPrice: formatUnits(BigInt(gasPrice), "gwei"), error: "" });
      } catch {
        if (active) setValue({ account, balance: "—", gasPrice: "—", error: "Chưa đọc được số dư và giá gas. Kiểm tra kết nối mạng local." });
      }
      if (active) timer = setTimeout(() => void refresh(), 15000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [account, enabled]);
  return enabled && value?.account === account ? value : null;
}
