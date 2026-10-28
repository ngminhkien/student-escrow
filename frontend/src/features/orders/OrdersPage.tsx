import { useEffect, useRef, useState } from "react";
import type { OrdersProps } from "./types";
import { useOrders } from "./useOrders";
import { useOrderDetail } from "./useOrderDetail";
import DraftForm from "./DraftForm";
import OrderList from "./OrderList";
import OrderDetail from "./OrderDetail";
import { sameAddress } from "../../domain/rules";
import { Icon } from "../../shared/ui/Icon";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function OrdersPage(props: OrdersProps) {
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get("order") ?? "");
  const [showCreate, setShowCreate] = useState(() => new URLSearchParams(location.search).get("create") === "1");
  const [openError, setOpenError] = useState("");
  const [workspaceChoice, setWorkspaceChoice] = useState<"buyer" | "seller" | "arbiter" | null>(null);
  const listScroll = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const orders = useOrders(props.session.accessToken, props.network.deploymentId, props.revision);
  const detail = useOrderDetail(props.session.accessToken, uuid.test(selected) ? selected : "", props.network.deploymentId, props.revision);
  const roleOf = (draft: { buyer: string; seller: string; arbiter: string }) => sameAddress(props.account, draft.seller) ? "seller" : sameAddress(props.account, draft.arbiter) ? "arbiter" : "buyer";
  const workspace = workspaceChoice ?? (detail.view ? roleOf(detail.view.draft) : orders.rows.some(row => sameAddress(props.account, row.draft.buyer)) ? "buyer" : orders.rows[0] ? roleOf(orders.rows[0].draft) : "buyer");
  const visibleOrders = orders.rows.filter(row => sameAddress(props.account, row.draft[workspace]));
  function choose(id: string, create = false) {
    if (!selected && !showCreate) listScroll.current = window.scrollY;
    if (id) setWorkspaceChoice(null);
    setSelected(id); setShowCreate(create); setOpenError("");
    const url = new URL(location.href);
    url.searchParams.delete("order"); url.searchParams.delete("create");
    if (id) url.searchParams.set("order", id);
    if (create) url.searchParams.set("create", "1");
    history.pushState(null, "", url.pathname + url.search + url.hash);
  }
  useEffect(() => {
    const navigate = () => { const params = new URLSearchParams(location.search); setSelected(params.get("order") ?? ""); setShowCreate(params.get("create") === "1"); setOpenError(""); };
    window.addEventListener("popstate", navigate); return () => window.removeEventListener("popstate", navigate);
  }, []);
  useEffect(() => { if (!selected) { heading.current?.focus({ preventScroll: true }); window.scrollTo(0, showCreate ? 0 : listScroll.current); } }, [selected, showCreate]);
  function refresh() { orders.refresh(); detail.refresh(); }
  return <>
    <div hidden={!!selected || showCreate}>
      <section className="panel orders-workspace">
        <div className="section-heading"><div><h2 ref={heading} tabIndex={-1}>{workspace === "seller" ? "Đơn bán của bạn" : workspace === "arbiter" ? "Đơn cần phân xử" : "Đơn hàng của bạn"}</h2><span className="small muted">{visibleOrders.length}{orders.hasMore ? "+" : ""} giao dịch đã tải</span></div>
          <div className="row"><button className="secondary" disabled={orders.loading} onClick={refresh}><Icon name="refresh" size={16} />Tải lại đơn</button>{workspace === "buyer" && <button disabled={props.busy || !props.canSign || props.network.status !== "Ready"} onClick={() => choose("", true)}><Icon name="plus" size={17} />Tạo bản nháp</button>}</div>
        </div>
        <div className="order-workspace-tabs" role="group" aria-label="Vai trò giao dịch">{(["buyer", "seller", ...(orders.rows.some(row => sameAddress(props.account, row.draft.arbiter)) ? ["arbiter" as const] : [])] as const).map(role => <button key={role} className={workspace === role ? "" : "secondary"} aria-pressed={workspace === role} disabled={props.busy} onClick={() => { setWorkspaceChoice(role); setOpenError(""); }}>{role === "buyer" ? "Đơn tôi mua" : role === "seller" ? "Đơn tôi bán" : "Đơn tôi phân xử"}</button>)}</div>
        {orders.error && <p className="banner" role="alert">{orders.error} <button className="secondary" onClick={orders.refresh}>Thử lại</button></p>}
        {orders.loading && <p role="status">Đang tải đơn…</p>}
        {!orders.loading && !orders.error && !visibleOrders.length && <div className="empty-state"><Icon name="orders" size={28} /><h3>{workspace === "seller" ? "Chưa có đơn bán" : "Chưa có đơn hàng"}</h3></div>}
        {!!visibleOrders.length && <OrderList orders={visibleOrders} account={props.account} selected={selected} choose={choose} />}
        {orders.hasMore && <button className="secondary" disabled={orders.loading} onClick={orders.more}>Xem thêm 50 đơn</button>}
        <details><summary>Mở bằng mã đơn</summary><form className="inline-form" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("id") ?? "").trim(); if (uuid.test(id)) choose(id); else setOpenError("Mã đơn phải là UUID hợp lệ của bản nháp."); }}><label>Mã bản nháp<input name="id" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" aria-invalid={!!openError} aria-describedby="open-order-error" /></label><button className="secondary">Mở mã đơn</button></form><p id="open-order-error" role={openError ? "alert" : undefined}>{openError}</p></details>
      </section>
    </div>
    {(selected || showCreate) && <nav className="trade-navigation" aria-label="Điều hướng giao dịch"><button className="text-button" onClick={() => choose("")}><span aria-hidden="true">←</span> Quay lại đơn hàng</button><span className="small muted">{showCreate ? "Tạo giao dịch" : "Chi tiết giao dịch"}</span><button className="secondary compact-button" disabled={props.busy || detail.loading} onClick={refresh}><Icon name="refresh" size={15} />Tải lại</button></nav>}
    {showCreate && !selected && <section className="panel"><h2 ref={heading} tabIndex={-1}>Tạo giao dịch mới</h2><DraftForm {...props} onCreated={id => { choose(id); refresh(); }} /></section>}
    {selected && !uuid.test(selected) && <p role="alert" className="banner">Mã đơn trong đường dẫn không hợp lệ.</p>}
    {detail.error && <p role="alert" className="banner">{detail.error} <button className="secondary" onClick={detail.refresh}>Tải lại chi tiết</button></p>}
    {detail.loading && !detail.view && <p role="status">Đang tải chi tiết đơn…</p>}
    {detail.view && <OrderDetail key={`${props.session.user.id}|${detail.view.draft.id}`} {...props} view={detail.view} onRefresh={refresh} />}
  </>;
}
