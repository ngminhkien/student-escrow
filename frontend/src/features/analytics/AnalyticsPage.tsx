import { useEffect, useState } from "react";
import { barWidth, categoryLabel, distributionRows, rateText, scoringText, type AnalyticsSource, type AnalyticsSummary } from "../../domain/analytics";
import { formatVnd } from "../../domain/money";
import { date } from "../../domain/rules";
import { errorMessage } from "../../infrastructure/wallet/transactions";
import { getAnalyticsSummary } from "../../services/analytics";

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat-tile"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}
function Bars({ title, caption, rows }: { title: string; caption: string; rows: { key: string; label: string; count: number }[] }) {
  const maximum = Math.max(0, ...rows.map(row => row.count));
  return <section className="panel chart-panel"><h2>{title}</h2><p className="small muted">{caption}</p>
    {maximum === 0 ? <p className="muted">Chưa có dữ liệu.</p> : <>
      <div className="bar-chart" aria-hidden="true">{rows.map(row => <div className="bar-row" key={row.key} title={`${row.label}: ${row.count} đơn`}>
        <span className="bar-label">{row.label}</span>
        <span className="bar-track"><span className="bar-fill" style={{ width: `${barWidth(row.count, maximum)}%` }} /></span>
        <span className="bar-value">{row.count}</span>
      </div>)}</div>
      <details><summary>Xem dạng bảng</summary><table className="chart-table"><thead><tr><th scope="col">Nhóm</th><th scope="col">Số đơn</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.count}</td></tr>)}</tbody></table></details>
    </>}
  </section>;
}
export default function AnalyticsPage({ token, revision }: { token: string; revision: number }) {
  const [source, setSource] = useState<AnalyticsSource>("chain");
  const [deployment, setDeployment] = useState("");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    getAnalyticsSummary(token, source, deployment, controller.signal).then(setSummary).catch(failure => {
      if (!controller.signal.aborted) { setSummary(null); setError(errorMessage(failure)); }
    });
    return () => controller.abort();
  }, [token, source, deployment, revision, reload]);
  // A response from the source just left must not be drawn under the new source's filter.
  const shown = summary?.source === source ? summary : null;
  const funded = shown?.fundedOrderCount ?? 0;
  return <div className="analytics-page">
    <div className="analytics-filters">
      <label>Nguồn dữ liệu<select value={source} onChange={event => setSource(event.target.value as AnalyticsSource)}>
        <option value="chain">Trên chain</option><option value="synthetic">Giả lập</option></select></label>
      {source === "chain" && <label>Deployment<select value={deployment} onChange={event => setDeployment(event.target.value)}>
        <option value="">Đang hoạt động</option>
        {shown?.deployments.map(item => <option key={item.id} value={item.id}>{item.contractAddress.slice(0, 10)}…{item.active ? " (đang hoạt động)" : ""}</option>)}
      </select></label>}
      <button type="button" className="secondary" onClick={() => setReload(value => value + 1)}>Tải lại</button>
    </div>
    {error && <p className="banner" role="alert">{error}</p>}
    {source === "synthetic" && <p className="banner" role="note"><strong>Dữ liệu giả lập.</strong> Đây là các đơn do chương trình sinh ra để minh họa bảng thống kê, không phải giao dịch đã xảy ra và không được cộng vào số liệu trên chain.</p>}
    {!shown && !error && <p className="muted">Đang tải…</p>}
    {shown && <>
      <p className="small muted" data-testid="analytics-scope">
        {source === "synthetic" ? "Nguồn: synthetic" : shown.deploymentId ? `Nguồn: chain ${shown.chainId} · Block ${shown.lastBlock}` : "Nguồn: chain · Chưa có deployment"}
        {shown.snapshotAt && ` · Chốt dữ liệu: ${date(Math.floor(new Date(shown.snapshotAt).getTime() / 1000))}`}
      </p>
      <section className="stat-grid" aria-label="Chỉ số chính">
        <Tile label="Đơn từng ký quỹ" value={String(funded)} />
        <Tile label={source === "synthetic" ? "Giao dịch giả lập" : "Giao dịch on-chain"} value={String(shown.blockchainTransactionCount)} note="Một đơn gồm nhiều giao dịch" />
        <Tile label="Tổng giá trị ký quỹ" value={formatVnd(shown.totalEscrowVolumeWei)} />
        <Tile label="Giá trị trung bình" value={funded ? formatVnd(shown.averageFundedWei) : "Chưa có dữ liệu"} />
        <Tile label="Tỷ lệ hoàn thành" value={rateText(shown.completionRate, funded)} note={`${shown.completedCount} đơn Completed`} />
        <Tile label="Tỷ lệ tranh chấp" value={rateText(shown.disputeRate, funded)} note={`${shown.disputedCount} đơn từng tranh chấp`} />
        <Tile label="Tỷ lệ hoàn toàn bộ" value={rateText(shown.fullRefundRate, funded)} note={`${shown.fullRefundCount} đơn hoàn 100%`} />
      </section>
      <p className="small muted">Mẫu số là mọi đơn từng ký quỹ, gồm cả đơn đang xử lý. Các tỷ lệ có thể chồng lấn nên không cộng lại thành 100%.</p>
      <section className="stat-grid" aria-label="Quyết toán">
        <Tile label="Seller thực nhận" value={formatVnd(shown.sellerNetWei)} />
        <Tile label="Buyer được hoàn" value={formatVnd(shown.buyerRefundWei)} />
        <Tile label="Phí nền tảng" value={formatVnd(shown.platformFeeWei)} />
      </section>
      <div className="chart-grid">
        <Bars title="Loại dịch vụ" caption="Số đơn từng ký quỹ theo loại." rows={shown.topCategories.map(item => ({ key: item.category, label: categoryLabel(item.category), count: item.count }))} />
        <Bars title="Phân bố rủi ro" caption={`Mỗi đơn được chấm tại thời điểm ký quỹ. ${scoringText({ ...shown.riskDistribution, dataSource: null })}. Mức chỉ để minh họa, chưa hiệu chuẩn trên dữ liệu thật.`} rows={distributionRows(shown.riskDistribution)} />
      </div>
    </>}
  </div>;
}
