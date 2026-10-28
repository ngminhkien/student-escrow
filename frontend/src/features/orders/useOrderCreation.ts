import { useCallback, useEffect, useState } from "react";
import { contractAt, rpc } from "../../infrastructure/wallet/useWallet";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import type { Draft, NetworkStatus, TxRecord } from "../../domain/types";

type Submission = { hash: string; phase: "pending" | "confirmed" | "unknown" };
function readSubmission(key: string): Submission | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && /^0x[0-9a-f]{64}$/i.test(value.hash) && ["pending", "confirmed", "unknown"].includes(value.phase) ? value : null;
  } catch { return null; }
}

export function useOrderCreation(draft: Draft, network: NetworkStatus, indexed: boolean) {
  const key = `escrow.order-create.${draft.deploymentId}.${draft.id}`;
  const [submission, setSubmission] = useState<{ key: string; value: Submission | null }>(() => ({ key, value: readSubmission(key) }));
  const [observed, setObserved] = useState<{ key: string; exists: boolean; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const current = submission.key === key ? submission.value : null;
  const save = useCallback((value: Submission | null) => {
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Keep the lock in memory if browser storage is unavailable. */ }
    setSubmission({ key, value });
  }, [key]);
  useEffect(() => { setSubmission({ key, value: readSubmission(key) }); setObserved(null); }, [key]);
  useEffect(() => {
    if (indexed || network.status !== "Ready" || network.deploymentId !== draft.deploymentId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const exists = await contractAt(network).usedClientReferences(draft.buyer, draft.clientReference) as boolean;
        const receipt = !exists && current ? await rpc.getTransactionReceipt(current.hash) : null;
        if (!active) return;
        if (receipt?.status === 0) save(null);
        setObserved({ key, exists, error: "" });
      } catch (failure) {
        if (active) setObserved(previous => ({ key, exists: previous?.key === key && previous.exists || false, error: errorMessage(failure) }));
      }
      if (active) timer = setTimeout(() => void refresh(), 4000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [key, draft.buyer, draft.clientReference, draft.deploymentId, network.status, network.deploymentId, network.contractAddress, indexed, current?.hash, revision, save]);
  const track = useCallback((transaction: TxRecord) => {
    if (transaction.phase === "failed" || transaction.phase === "cancelled") save(null);
    else save({ hash: transaction.hash, phase: transaction.phase === "confirmed" ? "confirmed" : transaction.phase === "unknown" ? "unknown" : "pending" });
    setRevision(value => value + 1);
  }, [save]);
  const created = indexed || observed?.key === key && observed.exists;
  const checked = observed?.key === key && !observed.error;
  return { created, submission: current, error: observed?.key === key ? observed.error : "", blocked: created || !checked || !!current,
    track, refresh: () => setRevision(value => value + 1) };
}
