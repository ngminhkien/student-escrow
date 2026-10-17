import { api } from "../infrastructure/http/client";
import type { LoginRequest, RegisterRequest, Session } from "../domain/types";

export const login = (input: LoginRequest, signal?: AbortSignal): Promise<Session> => api("/auth/login", undefined, "POST", input, signal);
export const register = (input: RegisterRequest, signal?: AbortSignal): Promise<Session> => api("/auth/register", undefined, "POST", input, signal);

export function loadSession(): Session | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem("escrow.session") ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<Session>;
    if (typeof candidate.accessToken !== "string" || !candidate.accessToken || typeof candidate.expiresAt !== "string"
      || !(new Date(candidate.expiresAt).getTime() > Date.now()) || !candidate.user
      || typeof candidate.user.id !== "string" || typeof candidate.user.fullName !== "string" || typeof candidate.user.email !== "string") {
      sessionStorage.removeItem("escrow.session");
      return null;
    }
    return candidate as Session;
  } catch { return null; }
}
export function saveSession(session: Session | null): void {
  if (session) sessionStorage.setItem("escrow.session", JSON.stringify(session));
  else sessionStorage.removeItem("escrow.session");
}
