import { useCallback, useEffect, useRef, useState } from "react";
import { injected } from "../infrastructure/wallet/useWallet";
import type { useWallet } from "../infrastructure/wallet/useWallet";
import { prepareWallet } from "../infrastructure/wallet/prepareWallet";
import { errorMessage } from "../infrastructure/wallet/transactions";
import type { LinkedWallet } from "../domain/types";
import { sameAddress } from "../domain/rules";

export function useWalletSession(identity: string, linked: LinkedWallet | null, wallet: ReturnType<typeof useWallet>, actionBusy: boolean) {
  const [state, setState] = useState({ identity: "", checking: false, error: "" });
  const latest = useRef({ identity, address: linked?.address, linked, wallet });
  latest.current = { identity, address: linked?.address, linked, wallet };
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const preparingIdentity = useRef("");
  const attempted = useRef(new Set<string>());
  const key = `${identity}:${linked?.address ?? ""}:${wallet.account}:${wallet.chainId}:${wallet.available}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { attempted.current.clear(); }, [identity]);
  const synchronize = useCallback(async () => {
    const scope = latest.current;
    if (!scope.identity || !scope.linked || inFlight.current) return;
    const provider = injected();
    if (!provider) {
      setState({ identity: scope.identity, checking: false, error: "Chưa tìm thấy MetaMask. Cài hoặc mở khóa tiện ích rồi bấm Đồng bộ ví." });
      return;
    }
    const check = () => {
      if (!mounted.current || latest.current.identity !== scope.identity || latest.current.address !== scope.address || injected() !== provider)
        throw new Error("Tài khoản đã thay đổi. Vui lòng xác nhận ví cho tài khoản hiện tại.");
    };
    inFlight.current = true;
    preparingIdentity.current = scope.identity;
    setState({ identity: scope.identity, checking: true, error: "" });
    try {
      await prepareWallet(provider, scope.address ?? null, check);
      check();
    } catch (failure) {
      if (mounted.current && latest.current.identity === scope.identity)
        setState({ identity: scope.identity, checking: false, error: errorMessage(failure) });
    } finally {
      const current = await latest.current.wallet.refresh();
      if (current && latest.current.identity === scope.identity)
        attempted.current.add(`${scope.identity}:${scope.address ?? ""}:${current.account}:${current.chainId}:true`);
      inFlight.current = false;
      if (mounted.current) setState(value => ({ ...value, checking: false }));
    }
  }, []);
  useEffect(() => {
    if (!identity || !linked || actionBusy || attempted.current.has(key)) return;
    if (inFlight.current) { if (preparingIdentity.current === identity) attempted.current.add(key); return; }
    attempted.current.add(key);
    void synchronize();
  }, [identity, linked, key, actionBusy, synchronize, state.checking]);
  const correct = !!wallet.account && wallet.chainId === "31337" && (!linked?.address || sameAddress(linked.address, wallet.account));
  return { checking: state.checking, error: state.identity === identity && !correct ? state.error : "", synchronize };
}
