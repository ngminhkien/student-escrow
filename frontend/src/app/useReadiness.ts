import { useEffect, useRef, useState } from "react";
import { health } from "../services/health";
import { pendingTimestamp } from "../infrastructure/wallet/useWallet";
import type { NetworkStatus } from "../domain/types";

const POLL_MS = 1000;
const CLOCK_EVERY_POLLS = 5;

// The worker's checkpoint moving means SQL now knows about a new block, which is the moment every open screen should reload.
export function useReadiness(revision: number) {
  const [network, setNetwork] = useState<NetworkStatus>({ status: "Đang kiểm tra" });
  const [chainTime, setChainTime] = useState(0);
  const [tick, setTick] = useState(0);
  const lastBlock = useRef<number | undefined>(undefined);
  const shown = useRef("");
  useEffect(() => {
    let stopped = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const value = await health(controller.signal);
        if (stopped) return;
        // checkedAt moves on every worker pass; rendering the whole app for it would achieve nothing.
        const key = JSON.stringify({ ...value, checkedAt: undefined });
        const changed = key !== shown.current;
        if (changed) { shown.current = key; setNetwork(value); }
        const block = value.lastIndexedBlock;
        if (block !== undefined) {
          if (lastBlock.current !== undefined && block !== lastBlock.current) setTick(count => count + 1);
          lastBlock.current = block;
        }
        if (value.status !== "Ready") setChainTime(0);
        else if (changed || polls % CLOCK_EVERY_POLLS === 0) {
          try { const timestamp = await pendingTimestamp(); if (!stopped) setChainTime(timestamp); }
          catch { if (!stopped) setChainTime(0); }
        }
        polls++;
      } catch { if (stopped) return; }
      if (!stopped) timer = setTimeout(() => void refresh(), POLL_MS);
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  return { network, chainTime, tick };
}
