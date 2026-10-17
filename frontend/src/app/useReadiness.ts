import { useEffect, useState } from "react";
import { health } from "../services/health";
import { pendingTimestamp } from "../infrastructure/wallet/useWallet";
import type { NetworkStatus } from "../domain/types";
export function useReadiness(revision: number) {
  const [network, setNetwork] = useState<NetworkStatus>({ status: "Đang kiểm tra" });
  const [chainTime, setChainTime] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const value = await health(controller.signal);
      if (stopped) return;
      setNetwork(value); setChainTime(0);
      try { const timestamp = value.status === "Ready" ? await pendingTimestamp() : 0; if (!stopped) setChainTime(timestamp); }
      catch { if (!stopped) setChainTime(0); }
      if (!stopped) timer = setTimeout(() => void refresh(), 5000);
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  return { network, chainTime };
}
