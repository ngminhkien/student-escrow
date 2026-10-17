import { useCallback, useEffect, useRef, useState } from "react";
import { getOrder } from "../../services/orders";
import { errorMessage } from "../../wallet";
import type { OrderView } from "../../domain/types";

export function useOrderDetail(token: string, id: string, deploymentId: string | undefined, revision: number) {
  const identity = `${token}|${id}|${deploymentId ?? ""}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const generation = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<{ identity: string; view: OrderView | null; loading: boolean; error: string }>({ identity, view: null, loading: !!id, error: "" });
  useEffect(() => {
    const request = ++generation.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valid = () => !controller.signal.aborted && generation.current === request && currentIdentity.current === identity;
    setResult(previous => previous.identity === identity ? { ...previous, loading: !!id } : { identity, view: null, loading: !!id, error: "" });
    if (!id) return () => controller.abort();
    async function refresh() {
      try { const view = await getOrder(token, id, controller.signal); if (valid()) setResult({ identity, view, loading: false, error: "" }); }
      catch (failure) { if (valid()) setResult(previous => ({ ...previous, loading: false, error: errorMessage(failure) })); }
      finally { if (valid()) timer = setTimeout(() => void refresh(), 5000); }
    }
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [identity, token, id, revision, refreshKey]);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  return { ...(result.identity === identity ? result : { identity, view: null, loading: !!id, error: "" }), refresh };
}
