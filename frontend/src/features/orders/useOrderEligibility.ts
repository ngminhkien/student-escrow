import { useEffect, useState } from "react";
import { contractAt } from "../../infrastructure/wallet/useWallet";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import type { Draft, NetworkStatus } from "../../domain/types";

export function useOrderEligibility(draft: Draft, network: NetworkStatus, applicable: boolean) {
  const key = `${draft.deploymentId}|${network.contractAddress}|${draft.buyer}|${draft.seller}`;
  const [result, setResult] = useState<{ key: string; buyer: boolean; seller: boolean; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!applicable || network.status !== "Ready" || draft.deploymentId !== network.deploymentId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const contract = contractAt(network);
        const [buyer, seller] = await Promise.all([
          contract.verifiedWallets(draft.buyer) as Promise<boolean>,
          contract.verifiedWallets(draft.seller) as Promise<boolean>
        ]);
        if (active) setResult({ key, buyer, seller, error: "" });
      } catch (failure) {
        if (active) setResult({ key, buyer: false, seller: false, error: errorMessage(failure) });
      }
      if (active) timer = setTimeout(() => void refresh(), 5000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [key, network.status, network.deploymentId, applicable, revision]);
  const current = result?.key === key ? result : null;
  return { buyer: current?.buyer ?? null, seller: current?.seller ?? null, error: current?.error ?? "",
    ready: !!current && !current.error && current.buyer && current.seller,
    refresh: () => setRevision(value => value + 1) };
}
