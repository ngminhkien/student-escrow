import { useState } from "react";
import { date, eth, states } from "../../domain/rules";
import type { OrderView } from "../../domain/types";
import type { OrdersProps } from "./types";
import OrderActions from "./OrderActions";
import OrderFiles from "./OrderFiles";
import OrderEvents from "./OrderEvents";
import { useEffect, useRef } from "react";
import OrderWorkflow from "./OrderWorkflow";
import { Icon } from "../../shared/ui/Icon";
import OrderRules from "./OrderRules";
export default function OrderDetail(props: OrdersProps & { view: OrderView; onRefresh: () => void }) {
  const { view, chainTime } = props;
  const draft = view.draft;
  const region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: "start" }); }, []);
  const [blockedHash, setBlockedHash] = useState(() => sessionStorage.getItem("escrow.hash-mismatch." + props.session.user.id + "." + draft.id) === "1");
  const [copyNotice, setCopyNotice] = useState("");
  async function copyId() {
    try { await navigator.clipboard.writeText(draft.id); setCopyNotice("Đã sao chép mã đơn."); }
    catch { setCopyNotice("Chưa thể sao chép tự động. Bạn có thể chọn và sao chép mã đơn ở trên."); }
  }
  function blockHash() { setBlockedHash(true); sessionStorage.setItem("escrow.hash-mismatch." + props.session.user.id + "." + draft.id, "1"); }
  return <section ref={region} tabIndex={-1} className="panel order-detail" aria-label="Chi tiết đơn">
    <div className="section-heading detail-heading"><div><p className="page-eyebrow">GIAO DỊCH {view.chain ? `#${view.chain.orderId}` : "MỚI"}</p><h2>{draft.description}</h2></div><strong data-testid="order-state">{states[view.chain?.state ?? "Draft"]}</strong></div>
    <div className="order-id-row"><p className="mono small">Mã đơn: {draft.id}</p><button className="secondary compact-button" disabled={props.busy} onClick={() => void copyId()}><Icon name="copy" size={15} />Sao chép mã đơn</button></div>
    {copyNotice && <p className="muted" role="status">{copyNotice}</p>}
    <OrderWorkflow view={view} account={props.account} chainTime={chainTime} />
    {view.chain && !view.termsMatch && <p role="alert" className="banner">Điều khoản trên chain không khớp bản nháp. Các thao tác với đơn này bị khóa.</p>}
    {view.syncStatus === "Archived" && <p className="banner">Đơn thuộc deployment cũ. Bạn vẫn xem và tải file được; hãy tạo đơn mới để demo tiếp.</p>}
    {blockedHash && <p role="alert" className="banner">Hash ZIP trả về sau khi tải lên không khớp byte gốc. Ký bàn giao đã bị khóa.</p>}
    <div className="order-detail-layout"><div className="order-delivery-main">
      {view.chain && ["Completed", "Resolved", "Refunded"].includes(view.chain.state) ? <>
        <OrderActions {...props} blockedHash={blockedHash} /><OrderFiles {...props} onHashMismatch={blockHash} />
      </> : <><OrderFiles {...props} onHashMismatch={blockHash} /><OrderActions {...props} blockedHash={blockedHash} /></>}
    </div><aside className="order-summary" aria-label="Tóm tắt thỏa thuận"><p className="page-eyebrow">THỎA THUẬN CỦA HAI BÊN</p><h3>Số tiền ký quỹ</h3><p className="summary-amount">{eth(draft.amountWei)} <span>ETH</span></p>
      <dl><dt>Hạn giao</dt><dd>{date(draft.deliveryDeadline)}</dd><dt>Khoảng phản hồi</dt><dd>{draft.reviewWindow} giây từ khi bàn giao</dd><dt>Hạn phản hồi</dt><dd>{date(view.chain?.reviewDeadline)}</dd></dl>
      <div className="summary-terms"><h3>Tiêu chí nghiệm thu</h3><p className="pre-wrap">{draft.acceptanceCriteria}</p></div>
      <details><summary>Các bên tham gia</summary><dl><dt>Buyer</dt><dd className="mono">{draft.buyer}</dd><dt>Seller</dt><dd className="mono">{draft.seller}</dd><dt>Arbiter</dt><dd className="mono">{draft.arbiter}</dd></dl></details>
      <OrderRules />
    </aside></div>
    <div className="order-diagnostics"><details><summary>Chi tiết đồng bộ</summary><p>Đồng bộ worker: <strong>{view.syncStatus}</strong></p><p>Block đã lập chỉ mục: {view.lastIndexedBlock} · Mã đơn trên chain: {view.chain?.orderId ?? "chưa có"}</p><p>Thời gian blockchain: {date(chainTime)}</p></details>
      <details><summary>Hash và nội dung điều khoản</summary><p className="mono small">Reference: {draft.clientReference}</p><p className="mono small">SHA-256: {draft.termsHash}</p><pre>{draft.termsJson}</pre></details>
    </div>
    <details className="order-history"><summary>Lịch sử giao dịch</summary><OrderEvents token={props.session.accessToken} id={draft.id} deploymentId={props.network.deploymentId} revision={props.revision} /></details>
  </section>;
}

