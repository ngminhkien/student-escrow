import { useEffect, useState } from "react";
import { riskLevelText, scoringText, type OrderRisk as Risk } from "../../domain/analytics";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import { getOrderRisk } from "../../services/analytics";

// Advisory only: this panel has no control over any action on the order.
export default function OrderRisk({ token, orderId, state, isArbiter }: { token: string; orderId: string; state: string; isArbiter: boolean }) {
  const [risk, setRisk] = useState<Risk | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    getOrderRisk(token, orderId, controller.signal).then(value => {
      // An advisory panel must never take the order page down with it.
      if (!Object.hasOwn(riskLevelText, value?.level)) throw new Error("Phản hồi không hợp lệ.");
      setRisk(value);
    }).catch(failure => {
      if (!controller.signal.aborted) { setRisk(null); setError(errorMessage(failure)); }
    });
    return () => controller.abort();
  }, [token, orderId, state]);
  return <section className="order-risk" aria-label="Đánh giá rủi ro tham khảo">
    <h3>Rủi ro tham khảo</h3>
    {error && <p className="small muted" role="status">Chưa tải được đánh giá rủi ro: {error}</p>}
    {!error && !risk && <p className="small muted">Đang đánh giá…</p>}
    {risk && <>
      <p className="risk-result" data-testid="risk-result">
        <strong className={`risk-level risk-${risk.level.toLowerCase()}`}>{riskLevelText[risk.level]}</strong>
        {risk.score !== null && <span>{risk.score}/100</span>}
      </p>
      {risk.reasons.length > 0 ? <ul className="risk-reasons">{risk.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        : risk.score !== null && <p className="small muted">Không có điều kiện cảnh báo nào được kích hoạt.</p>}
      {isArbiter && risk.level === "HIGH" && state === "Disputed" && <p className="small"><strong>Arbiter:</strong> nên xem kỹ bằng chứng của cả hai bên. Điểm này không phải căn cứ phân xử.</p>}
      <p className="small muted">{scoringText(risk)}. Lý do lấy từ các điều kiện kiểm tra được, không phải yếu tố mô hình đã cân nhắc. Điểm chỉ để cảnh báo, không chứng minh gian lận và không ảnh hưởng tới tiền hay trạng thái đơn.</p>
    </>}
  </section>;
}
