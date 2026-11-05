import { useEffect, useState } from "react";
import { getWalletAccount } from "../services/account";
import type { WalletAccount } from "../domain/types";

export function useWalletAccount(token: string, enabled: boolean, revision: number) {
  const [state, setState] = useState<{ token: string; value: WalletAccount | null; error: string } | null>(null);
  useEffect(() => {
    if (!token || !enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const value = await getWalletAccount(token, controller.signal);
        if (active) setState({ token, value, error: "" });
      } catch {
        if (active) setState(previous => ({ token, value: previous?.token === token ? previous.value : null, error: "Chưa đọc được số dư. Kiểm tra kết nối API." }));
      }
      if (active) timer = setTimeout(() => void refresh(), 15000);
    }
    void refresh();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [token, enabled, revision]);
  return enabled && state?.token === token ? state : null;
}
