import { useCallback, useEffect, useState } from "react";
import { rpc } from "../../infrastructure/wallet/useWallet";
import type { Draft, TxRecord } from "../../domain/types";

type Submission = { hash: string; phase: "pending" | "confirmed" | "unknown" };
function read(key: string): Submission | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && /^0x[0-9a-f]{64}$/i.test(value.hash) && ["pending", "confirmed", "unknown"].includes(value.phase) ? value : null;
  } catch { return null; }
}
export function useOrderSubmission(draft: Draft, method: string, active: boolean) {
  const key = `escrow.order-submit.${draft.deploymentId}.${draft.id}.${method}`;
  const [stored, setStored] = useState(() => ({ key, value: read(key) }));
  const value = stored.key === key ? stored.value : null;
  const save = useCallback((next: Submission | null) => {
    try { if (next) sessionStorage.setItem(key, JSON.stringify(next)); else sessionStorage.removeItem(key); } catch { /* Keep the guard in memory. */ }
    setStored({ key, value: next });
  }, [key]);
  useEffect(() => { setStored({ key, value: read(key) }); }, [key]);
  useEffect(() => {
    if (!active || !value) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const hash = value.hash;
    async function refresh() {
      try {
        const receipt = await rpc.getTransactionReceipt(hash);
        if (stopped) return;
        if (receipt?.status === 0) { save(null); return; }
      } catch { /* Unknown receipt keeps the action locked instead of sending twice. */ }
      if (!stopped) timer = setTimeout(() => void refresh(), 5000);
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, value?.hash, save]);
  const track = useCallback((transaction: TxRecord) => {
    if (transaction.phase === "failed" || transaction.phase === "cancelled") save(null);
    else save({ hash: transaction.hash, phase: transaction.phase === "confirmed" ? "confirmed" : transaction.phase === "unknown" ? "unknown" : "pending" });
  }, [save]);
  return { value, track };
}
