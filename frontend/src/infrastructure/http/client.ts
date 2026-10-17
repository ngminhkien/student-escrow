import { ApiError } from "./errors";

export interface RequestOptions {
  token?: string;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  responseType?: "json" | "binary";
  acceptedStatuses?: readonly number[];
}
function expireCurrentSession(token: string): void {
  // Responses from a prior login cannot expire the current login.
  try {
    if (JSON.parse(sessionStorage.getItem("escrow.session") ?? "null")?.accessToken === token)
      window.dispatchEvent(new Event("escrow:session-expired"));
  } catch { /* Storage may be unavailable or contain an obsolete value. */ }
}
function errorText(status: number): string {
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu được yêu cầu.";
  if (status === 429) return "Có quá nhiều yêu cầu. Vui lòng thử lại sau.";
  return `Không thể hoàn tất yêu cầu (HTTP ${status}).`;
}
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 60000);
  const multipart = options.body instanceof FormData;
  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined && !multipart ? { "Content-Type": "application/json" } : {})
      },
      body: multipart ? options.body as FormData : options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal, cache: "no-store"
    });
    if (response.status === 401 && options.token) expireCurrentSession(options.token);
    const accepted = response.ok || options.acceptedStatuses?.includes(response.status);
    if (accepted && options.responseType === "binary") return new Uint8Array(await response.arrayBuffer()) as T;
    const text = await response.text();
    let data: unknown;
    try { data = text.trim() ? JSON.parse(text) : undefined; }
    catch {
      throw new ApiError(response.status, accepted ? "INVALID_RESPONSE" : "REQUEST_FAILED",
        accepted ? "API trả về dữ liệu không hợp lệ. Vui lòng thử lại." : errorText(response.status));
    }
    if (!accepted) {
      const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
      throw new ApiError(response.status, typeof payload.code === "string" ? payload.code : "REQUEST_FAILED",
        typeof payload.message === "string" ? payload.message : errorText(response.status),
        typeof payload.traceId === "string" ? payload.traceId : undefined);
    }
    if (data === undefined && response.status !== 204)
      throw new ApiError(response.status, "EMPTY_RESPONSE", "API không trả về dữ liệu. Vui lòng thử lại.");
    return data as T;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Yêu cầu đã được hủy.", "AbortError");
    if (timedOut) throw new ApiError(0, "TIMEOUT", "Yêu cầu quá thời gian chờ. Vui lòng thử lại.");
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Không kết nối được API. Kiểm tra kết nối và dịch vụ backend.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export function api<T>(path: string, token?: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { token, method, body, signal });
}
export function downloadFile(path: string, token: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return request(path, { token, signal, responseType: "binary" });
}
