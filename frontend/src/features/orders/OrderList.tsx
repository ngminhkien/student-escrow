import { useMemo, useState } from "react";
import type { OrderView } from "../../domain/types";
import { date, eth, sameAddress, short, states } from "../../domain/rules";
export default function OrderList({ orders, account, selected, choose }: { orders: OrderView[]; account: string; selected: string; choose: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [role, setRole] = useState("");
  const roleOf = (order: OrderView) => sameAddress(order.draft.buyer, account) ? "buyer" : sameAddress(order.draft.seller, account) ? "seller" : sameAddress(order.draft.arbiter, account) ? "arbiter" : "";
  const names: Record<string, string> = { buyer: "Người mua", seller: "Người bán", arbiter: "Trọng tài", "": "Ví khác" };
  const filtered = useMemo(() => orders.filter(order => { const draft = order.draft; return (!state || (order.chain?.state ?? "Draft") === state) && (!role || roleOf(order) === role) && (!search.trim() || [draft.id, draft.description, draft.buyer, draft.seller, draft.arbiter].some(value => value.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))); }), [orders, search, state, role, account]);
  return <><div className="orders-toolbar"><p className="small muted">Lọc trong {orders.length} đơn đã tải · vai trò theo ví đang chọn</p><div className="grid three">
    <label>Tìm trong các đơn đã tải<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nội dung, mã đơn, địa chỉ ví" /></label>
    <label>Trạng thái<select value={state} onChange={event => setState(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(states).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
    <label>Vai trò<select value={role} onChange={event => setRole(event.target.value)}><option value="">Tất cả vai trò</option>{Object.entries(names).filter(([key]) => key).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
  </div></div>
  {!filtered.length ? <div className="empty-state"><h3>Không có đơn phù hợp bộ lọc</h3><p>Thử thay đổi nội dung tìm kiếm hoặc vai trò.</p><button className="secondary" onClick={() => { setSearch(""); setState(""); setRole(""); }}>Xóa bộ lọc</button></div> : <div className="order-list"><table className="orders-table"><thead><tr><th>Nội dung</th><th>Vai trò</th><th>ETH</th><th>Trạng thái</th><th>Hạn giao</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{filtered.map(order => <tr key={order.draft.id} className={selected === order.draft.id ? "selected" : ""}>
    <td data-label="Nội dung"><strong className="order-description">{order.draft.description}</strong><div className="mono small">{short(order.draft.id)}</div></td><td data-label="Vai trò">{names[roleOf(order)]}</td><td data-label="ETH" className="amount">{eth(order.draft.amountWei)}</td><td data-label="Trạng thái"><span className="status-badge">{states[order.chain?.state ?? "Draft"]}</span>{order.syncStatus !== "Ready" && <div className="small">{order.syncStatus}</div>}</td><td data-label="Hạn giao">{date(order.draft.deliveryDeadline)}</td><td><button className="secondary" aria-label={`Mở đơn ${order.draft.description}`} onClick={() => choose(order.draft.id)}>Mở</button></td>
  </tr>)}</tbody></table></div>}</>;
}
