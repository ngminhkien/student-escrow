import { useEffect, useState } from "react";
import type { OrdersProps } from "./types";
import { useOrders } from "./useOrders";
import { useOrderDetail } from "./useOrderDetail";
import DraftForm from "./DraftForm";
import OrderList from "./OrderList";
import OrderDetail from "./OrderDetail";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function OrdersPage(props: OrdersProps) {
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get("order") ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [openError, setOpenError] = useState("");
  const orders = useOrders(props.session.accessToken, props.network.deploymentId, props.revision);
  const detail = useOrderDetail(props.session.accessToken, uuid.test(selected) ? selected : "", props.network.deploymentId, props.revision);
  function choose(id: string) { setSelected(id); setOpenError(""); const url = new URL(location.href); if (id) url.searchParams.set("order", id); else url.searchParams.delete("order"); history.replaceState(null, "", url.pathname + url.search + url.hash); }
  useEffect(() => { const navigate = () => setSelected(new URLSearchParams(location.search).get("order") ?? ""); window.addEventListener("popstate", navigate); return () => window.removeEventListener("popstate", navigate); }, []);
  function refresh() { orders.refresh(); detail.refresh(); }
  return <><section className="panel orders-workspace"><div className="section-heading"><div><h2>Đơn hàng của bạn</h2><p className="muted">Theo dõi công việc, ký quỹ và bàn giao trong một không gian.</p></div><div className="row"><button className="secondary" disabled={orders.loading} onClick={refresh}>Tải lại đơn</button><button disabled={props.busy || !props.canSign || props.network.status !== "Ready"} onClick={() => setShowCreate(value => !value)}>{showCreate ? "Đóng bản nháp" : "Tạo bản nháp"}</button></div></div>
    {!props.canSign && <p className="banner">Để thao tác, liên kết ví trong Tài khoản & ví, chọn đúng tài khoản MetaMask và mạng local 31337. Bạn vẫn có thể đọc các đơn được phép truy cập.</p>}
    {showCreate && <DraftForm {...props} onCreated={id => { choose(id); setShowCreate(false); refresh(); }} />}
    {orders.error && <p className="banner" role="alert">{orders.error} <button className="secondary" onClick={orders.refresh}>Thử lại</button></p>}
    {orders.loading && <p role="status">Đang tải đơn…</p>}
    {!orders.loading && !orders.error && !orders.rows.length && <div className="empty-state"><h2>Chưa có đơn hàng</h2><p>Các đơn của ví đã liên kết sẽ xuất hiện tại đây. Người mua có thể tạo bản nháp đầu tiên khi ví sẵn sàng.</p></div>}
    {!!orders.rows.length && <OrderList orders={orders.rows} account={props.account} selected={selected} choose={choose} />}
    {orders.hasMore && <button className="secondary" disabled={orders.loading} onClick={orders.more}>Xem thêm 50 đơn</button>}
    <details><summary>Mở bằng mã đơn</summary><form className="inline-form" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("id") ?? "").trim(); if (uuid.test(id)) choose(id); else setOpenError("Mã đơn phải là UUID hợp lệ của bản nháp."); }}><label>Mã bản nháp<input name="id" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" aria-invalid={!!openError} aria-describedby="open-order-error" /></label><button className="secondary">Mở mã đơn</button></form><p id="open-order-error" role={openError ? "alert" : undefined}>{openError}</p></details>
  </section>
  {selected && !uuid.test(selected) && <p role="alert" className="banner">Mã đơn trong đường dẫn không hợp lệ.</p>}
  {detail.error && <p role="alert" className="banner">{detail.error} <button className="secondary" onClick={detail.refresh}>Tải lại chi tiết</button></p>}
  {detail.loading && !detail.view && <p role="status">Đang tải chi tiết đơn…</p>}
  {detail.view && <><button className="secondary" onClick={() => choose("")}>Đóng chi tiết đơn</button><OrderDetail key={`${props.session.user.id}|${detail.view.draft.id}`} {...props} view={detail.view} onRefresh={refresh} /></>}
  </>;
}

