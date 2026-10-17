const labels: Record<string, string> = { Created: "Đã tạo", Funded: "Đã ký quỹ", Delivered: "Đã bàn giao", Completed: "Hoàn thành", Disputed: "Tranh chấp", Resolved: "Đã phân xử", Refunded: "Đã hoàn tiền", Draft: "Bản nháp", VERIFIED: "Đã xác minh", REJECTED: "Bị từ chối", NOT_SUBMITTED: "Chưa nộp", Pending: "Đang chờ" };
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span className="status-dot" aria-hidden="true" />{label ?? labels[status] ?? status}</span>;
}
export default StatusBadge;
