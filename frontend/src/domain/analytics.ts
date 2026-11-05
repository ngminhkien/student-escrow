export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNAVAILABLE";
export type ScoringSource = "ml" | "rule-based" | "unavailable";
export interface OrderRisk {
  score: number | null; level: RiskLevel; reasons: string[]; reasonSource: string; scoringSource: ScoringSource;
  modelVersion: string | null; featureVersion: string; evaluatedAt: string; dataSource: string | null;
}
export type AnalyticsSource = "chain" | "synthetic";
export interface AnalyticsDeployment { id: string; chainId: number; contractAddress: string; active: boolean }
export interface RiskDistribution { low: number; medium: number; high: number; unavailable: number; scoringSource: ScoringSource; modelVersion: string | null }
export interface AnalyticsSummary {
  source: AnalyticsSource; chainId: number | null; deploymentId: string | null; snapshotAt: string | null; lastBlock: number | null;
  deployments: AnalyticsDeployment[]; fundedOrderCount: number; blockchainTransactionCount: number;
  totalEscrowVolumeWei: string; averageFundedWei: string;
  completedCount: number; completionRate: number; disputedCount: number; disputeRate: number; fullRefundCount: number; fullRefundRate: number;
  sellerNetWei: string; buyerRefundWei: string; platformFeeWei: string;
  topCategories: { category: string; count: number }[]; riskDistribution: RiskDistribution;
}

export const ORDER_CATEGORIES = [
  { value: "design", label: "Thiết kế" }, { value: "programming", label: "Lập trình" },
  { value: "documents", label: "Tài liệu" }, { value: "other", label: "Khác" }
] as const;
export function categoryLabel(category: string): string {
  if (category === "uncategorized") return "Chưa phân loại";
  return ORDER_CATEGORIES.find(item => item.value === category)?.label ?? category;
}
// A rate with an empty denominator is "no data", which must not read as a real 0%.
export function rateText(rate: number, denominator: number): string {
  if (denominator === 0) return "Chưa có dữ liệu";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(rate * 100)}%`;
}
export const riskLevelText: Record<RiskLevel, string> = { LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", UNAVAILABLE: "Chưa đánh giá được" };
export function scoringText(risk: Pick<OrderRisk, "scoringSource" | "modelVersion" | "dataSource">): string {
  if (risk.scoringSource === "ml") return `Mô hình ${risk.modelVersion}, huấn luyện trên dữ liệu giả lập`;
  if (risk.scoringSource === "rule-based") return "Luật dự phòng, không phải mô hình";
  return "Không có nguồn chấm điểm";
}
export function distributionRows(value: RiskDistribution) {
  const rows = [
    { key: "LOW", label: "Thấp (0–39)", count: value.low },
    { key: "MEDIUM", label: "Trung bình (40–69)", count: value.medium },
    { key: "HIGH", label: "Cao (70–100)", count: value.high }
  ];
  return value.unavailable > 0 ? [...rows, { key: "UNAVAILABLE", label: "Chưa đánh giá được", count: value.unavailable }] : rows;
}
// Bars share one scale. A non-zero count always stays visible, however small.
export function barWidth(count: number, maximum: number): number {
  if (count <= 0 || maximum <= 0) return 0;
  return Math.max(2, Math.round((count / maximum) * 100));
}
