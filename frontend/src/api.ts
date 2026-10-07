import type { NetworkStatus, Session } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function expireCurrentSession(token: string) {
  // An old request must not sign out a different account that has just logged in.
  try {
    if (JSON.parse(sessionStorage.getItem("escrow.session") ?? "null")?.accessToken === token)
      window.dispatchEvent(new Event("escrow:session-expired"));
  } catch { /* Ignore invalid storage; the next login replaces it. */ }
}
export async function api<T>(path: string, token?: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(60000), cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && token) expireCurrentSession(token);
    throw new ApiError(response.status, data.code ?? "REQUEST_FAILED", data.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export async function health(signal?: AbortSignal): Promise<NetworkStatus> {
  try {
    const response = await fetch("/api/health/blockchain", { signal: signal ?? AbortSignal.timeout(8000), cache: "no-store" });
    const data = await response.json();
    return typeof data.status === "string" ? data : { status: "Unavailable" };
  } catch { return { status: "Unavailable" }; }
}
export function loadSession(): Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem("escrow.session") ?? "null") as Session | null;
    return value?.accessToken && new Date(value.expiresAt).getTime() > Date.now() ? value : null;
  } catch { return null; }
}
export function saveSession(session: Session | null) {
  if (session) sessionStorage.setItem("escrow.session", JSON.stringify(session));
  else sessionStorage.removeItem("escrow.session");
}
export async function downloadFile(path: string, token: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000), cache: "no-store" });
  if (response.status === 401) expireCurrentSession(token);
  if (!response.ok) throw new Error(`Không tải được file (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
