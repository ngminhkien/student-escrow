import { useCallback, useEffect, useState } from "react";
import { loadSession, saveSession } from "../services/auth";
import type { Session } from "../domain/types";
export function useSession() {
  const [session, setSession] = useState(loadSession);
  const [expired, setExpired] = useState(false);
  const changeSession = useCallback((value: Session | null) => { saveSession(value); setSession(value); setExpired(false); }, []);
  useEffect(() => {
    if (!session) return;
    const expire = () => { changeSession(null); setExpired(true); };
    const check = () => { if (Date.now() >= new Date(session.expiresAt).getTime()) expire(); };
    window.addEventListener("escrow:session-expired", expire);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setTimeout(expire, Math.min(2147483647, Math.max(0, new Date(session.expiresAt).getTime() - Date.now())));
    return () => { clearTimeout(timer); window.removeEventListener("escrow:session-expired", expire); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [session, changeSession]);
  return { session, changeSession, expired };
}
