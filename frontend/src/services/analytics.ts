import { api } from "../infrastructure/http/client";
import type { AnalyticsSource, AnalyticsSummary, OrderRisk } from "../domain/analytics";

export const getOrderRisk = (token: string, id: string, signal?: AbortSignal): Promise<OrderRisk> => api(`/orders/${encodeURIComponent(id)}/risk`, token, "GET", undefined, signal);
export function getAnalyticsSummary(token: string, source: AnalyticsSource, deploymentId: string, signal?: AbortSignal): Promise<AnalyticsSummary> {
  const query = new URLSearchParams({ source });
  if (source === "chain" && deploymentId) query.set("deploymentId", deploymentId);
  return api(`/analytics/summary?${query}`, token, "GET", undefined, signal);
}
