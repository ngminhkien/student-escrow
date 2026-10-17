import { test, expect } from "@playwright/test";
import { request } from "../src/infrastructure/http/client";

test.describe("HTTP transport", () => {
  const originalFetch = globalThis.fetch;
  test.afterEach(() => { globalThis.fetch = originalFetch; });
  test("retains backend status, code, message and trace", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "QUOTA", message: "Limit", traceId: "trace-7" }), { status: 409 });
    await expect(request("/orders")).rejects.toMatchObject({ status: 409, code: "QUOTA", message: "Limit", traceId: "trace-7" });
  });
  test("rejects malformed and empty success but accepts 204 and health 503", async () => {
    globalThis.fetch = async () => new Response("<html>Error</html>");
    await expect(request("/orders")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    globalThis.fetch = async () => new Response("");
    await expect(request("/orders")).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
    globalThis.fetch = async () => new Response(null, { status: 204 });
    expect(await request("/orders")).toBeUndefined();
    globalThis.fetch = async () => new Response('{"status":"Unavailable"}', { status: 503 });
    expect(await request("/health/blockchain", { acceptedStatuses: [503] })).toEqual({ status: "Unavailable" });
  });
  test("binary is exact and multipart leaves boundary to browser", async () => {
    const form = new FormData(); form.append("file", new Blob(["zip"]), "sample.zip");
    globalThis.fetch = async (url, options) => {
      expect(url).toBe("/api/files");
      expect(options?.headers).toEqual({ Authorization: "Bearer token" });
      expect(options?.body).toBe(form);
      return new Response(new Uint8Array([0, 255, 80, 75]));
    };
    expect(await request("/files", { method: "POST", body: form, token: "token", responseType: "binary" })).toEqual(new Uint8Array([0, 255, 80, 75]));
  });
  test("timeout still applies with caller signal and caller abort remains distinguishable", async () => {
    globalThis.fetch = async (_, options) => new Promise((_, reject) => {
      if (options?.signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
      else options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const controller = new AbortController();
    await expect(request("/slow", { signal: controller.signal, timeoutMs: 5 })).rejects.toMatchObject({ code: "TIMEOUT" });
    const pending = request("/slow", { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  test("a stale 401 cannot expire the replacement login", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const target = new EventTarget(); let expired = 0;
    target.addEventListener("escrow:session-expired", () => expired++);
    Object.defineProperty(globalThis, "window", { configurable: true, value: target });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => '{"accessToken":"new"}' } });
    try {
      globalThis.fetch = async () => new Response("{}", { status: 401 });
      await expect(request("/orders", { token: "old" })).rejects.toMatchObject({ status: 401 });
      expect(expired).toBe(0);
      await expect(request("/orders", { token: "new" })).rejects.toMatchObject({ status: 401 });
      expect(expired).toBe(1);
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage); else delete (globalThis as any).sessionStorage;
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as any).window;
    }
  });
});
