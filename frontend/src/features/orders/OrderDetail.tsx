import { useState } from "react";
import { date, eth, states } from "../../domain/rules";
import type { OrderView } from "../../domain/types";
import type { OrdersProps } from "./types";
import OrderActions from "./OrderActions";
import OrderFiles from "./OrderFiles";
import OrderEvents from "./OrderEvents";
import { useEffect, useRef } from "react";
export default function OrderDetail(props: OrdersProps & { view: OrderView; onRefresh: () => void }) {
  const { view, chainTime } = props;
  const draft = view.draft;
  const region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: "start" }); }, []);
  const [blockedHash, setBlockedHash] = useState(() => sessionStorage.getItem("escrow.hash-mismatch." + props.session.user.id + "." + draft.id) === "1");
  function blockHash() { setBlockedHash(true); sessionStorage.setItem("escrow.hash-mismatch." + props.session.user.id + "." + draft.id, "1"); }
  return <section ref={region} tabIndex={-1} className="panel order-detail" aria-label="Chi tiết đơn">
    <div className="section-heading"><h2>{draft.description}</h2><strong data-testid="order-state">{states[view.chain?.state ?? "Draft"]}</strong></div>
    <p className="mono small">Mã đơn: {draft.id}</p>
    <div className="grid"><div><h3>Điều khoản</h3><p className="pre-wrap">{draft.acceptanceCriteria}</p>
      <dl><dt>Số tiền</dt><dd>{eth(draft.amountWei)} ETH</dd><dt>Hạn giao</dt><dd>{date(draft.deliveryDeadline)}</dd>
        <dt>Khoảng phản hồi</dt><dd>{draft.reviewWindow} giây từ khi bàn giao</dd><dt>Hạn phản hồi</dt><dd>{date(view.chain?.reviewDeadline)}</dd>
        <dt>Thời gian blockchain</dt><dd>{date(chainTime)}</dd></dl></div>
      <div><h3>Các bên</h3><dl><dt>Buyer</dt><dd className="mono">{draft.buyer}</dd><dt>Seller</dt><dd className="mono">{draft.seller}</dd><dt>Arbiter</dt><dd className="mono">{draft.arbiter}</dd></dl></div></div>
    <p>Đồng bộ: <strong>{view.syncStatus}</strong></p>
    <details><summary>Chi tiết đồng bộ</summary><p>Block đã lập chỉ mục: {view.lastIndexedBlock} · Mã đơn trên chain: {view.chain?.orderId ?? "chưa có"}</p></details>
    {view.chain && !view.termsMatch && <p role="alert" className="banner">Điều khoản trên chain không khớp bản nháp. Các thao tác với đơn này bị khóa.</p>}
    {view.syncStatus === "Archived" && <p className="banner">Đơn thuộc deployment cũ. Bạn vẫn xem và tải file được; hãy tạo đơn mới để demo tiếp.</p>}
    <OrderActions {...props} blockedHash={blockedHash} />
    {blockedHash && <p role="alert" className="banner">Hash ZIP trả về sau khi tải lên không khớp byte gốc. Ký bàn giao đã bị khóa.</p>}
    <OrderFiles {...props} onHashMismatch={blockHash} />
    <details><summary>Hash và nội dung điều khoản</summary><p className="mono small">Reference: {draft.clientReference}</p><p className="mono small">SHA-256: {draft.termsHash}</p><pre>{draft.termsJson}</pre></details>
    <OrderEvents token={props.session.accessToken} id={draft.id} deploymentId={props.network.deploymentId} revision={props.revision} />
  </section>;
}

