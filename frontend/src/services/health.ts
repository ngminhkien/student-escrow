import { request } from "../infrastructure/http/client";
import type { NetworkStatus } from "../domain/types";

export async function health(signal?: AbortSignal): Promise<NetworkStatus> {
  try {
    // A 503 carries the actual deployment readiness state and must remain readable.
    const data = await request<unknown>("/health/blockchain", { signal, timeoutMs: 8000, acceptedStatuses: [503] });
    if (!data || typeof data !== "object" || typeof (data as NetworkStatus).status !== "string") return { status: "Unavailable" };
    return data as NetworkStatus;
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "Unavailable" };
  }
}
