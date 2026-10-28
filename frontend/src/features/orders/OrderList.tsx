import { useMemo, useState } from "react";
import type { OrderView } from "../../domain/types";
import { date, eth, short, states } from "../../domain/rules";
import { Icon } from "../../shared/ui/Icon";
import StatusBadge from "../../shared/ui/StatusBadge";
export default function OrderList({ orders, selected, choose }: { orders: OrderView[]; account: string; selected: string; choose: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const filtered = useMemo(() => orders.filter(order => { const draft = order.draft; return (!state || (order.chain?.state ?? "Draft") === state) && (!search.trim() || [draft.id, draft.description, draft.buyer, draft.seller, draft.arbiter].some(value => value.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")))); }), [orders, search, state]);
  return <><div className="orders-toolbar"><div className="grid three">
    <label>Tìm trong các đơn đã tải<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nội dung, mã đơn, địa chỉ ví" /></label>
    <label>Trạng thái<select value={state} onChange={event => setState(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(states).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
  </div></div>
  {!filtered.length ? <div className="empty-state"><span className="empty-state-mark"><Icon name="search" size={25} /></span><h3>Không có đơn phù hợp bộ lọc</h3><p>Thử thay đổi nội dung tìm kiếm hoặc trạng thái.</p><button className="secondary" onClick={() => { setSearch(""); setState(""); }}>Xóa bộ lọc</button></div> : <div className="order-list"><table className="orders-table"><thead><tr><th>Nội dung</th><th>ETH</th><th>Trạng thái</th><th>Hạn giao</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{filtered.map(order => <tr key={order.draft.id} className={selected === order.draft.id ? "selected" : ""}>
    <td data-label="Nội dung"><a className="order-description" href={`?order=${order.draft.id}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); choose(order.draft.id); } }}>{order.draft.description}</a><div className="mono small" title={order.draft.id}>{short(order.draft.id)}</div></td><td data-label="ETH" className="amount">{eth(order.draft.amountWei)}</td><td data-label="Trạng thái"><StatusBadge status={order.chain?.state ?? "Draft"} label={states[order.chain?.state ?? "Draft"]} />{order.syncStatus !== "Ready" && <div className="small">{order.syncStatus}</div>}</td><td data-label="Hạn giao">{date(order.draft.deliveryDeadline)}</td><td><button className="secondary" aria-label={`Mở đơn ${order.draft.description}`} onClick={() => choose(order.draft.id)}>Mở<Icon name="arrow" size={15} /></button></td>
  </tr>)}</tbody></table></div>}</>;
}
