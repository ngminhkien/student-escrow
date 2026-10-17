import { useCallback, useEffect, useRef, useState } from "react";
import { listOrders } from "../../services/orders";
import { errorMessage } from "../../wallet";
import type { OrderView } from "../../domain/types";

export function usePagedProjection<T>(identity: string, fetchPage: (skip: number, signal: AbortSignal) => Promise<T[]>, size: number, revision: number) {
  const [pages, setPages] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<{ identity: string; rows: T[]; hasMore: boolean; error: string; loading: boolean }>({ identity, rows: [], hasMore: false, error: "", loading: true });
  const generation = useRef(0);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const loader = useRef(fetchPage); loader.current = fetchPage;
  const pageIdentity = useRef(identity);
  const effectivePages = pageIdentity.current === identity ? pages : 1;
  useEffect(() => { pageIdentity.current = identity; setPages(1); }, [identity]);
  useEffect(() => {
    const request = ++generation.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valid = () => !controller.signal.aborted && generation.current === request && currentIdentity.current === identity;
    const read = loader.current;
    setResult(previous => previous.identity === identity ? { ...previous, loading: true } : { identity, rows: [], error: "", hasMore: false, loading: true });
    async function refresh() {
      try {
        const values = await Promise.all(Array.from({ length: effectivePages }, (_, index) => read(index * size, controller.signal)));
        if (valid()) setResult({ identity, rows: values.flat(), hasMore: values.at(-1)?.length === size, error: "", loading: false });
      } catch (failure) {
        if (valid()) setResult(previous => ({ ...previous, identity, error: errorMessage(failure), loading: false }));
      } finally { if (valid()) timer = setTimeout(() => void refresh(), 5000); }
    }
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [identity, effectivePages, size, revision, refreshKey]);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const more = useCallback(() => setPages(value => value + 1), []);
  const visible = result.identity === identity ? result : { identity, rows: [] as T[], error: "", loading: true, hasMore: false };
  return { ...visible, refresh, more };
}

export function useOrders(token: string, deploymentId: string | undefined, revision: number) {
  return usePagedProjection<OrderView>(`${token}|${deploymentId ?? ""}`, (skip, signal) => listOrders(token, skip, signal), 50, revision);
}
