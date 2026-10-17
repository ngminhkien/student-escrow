import { getOrderEvents } from "../../services/orders";
import type { ChainEvent } from "../../domain/types";
import { usePagedProjection } from "./useOrders";
export default function OrderEvents({ token, id, deploymentId, revision }: { token: string; id: string; deploymentId?: string; revision: number }) {
  const query = usePagedProjection<ChainEvent>(`${token}|${id}|${deploymentId ?? ""}`, (skip, signal) => getOrderEvents(token, id, skip, signal), 100, revision);
  return <section aria-label="Lịch sử on-chain"><div className="section-heading"><h3>Lịch sử on-chain</h3><button className="secondary" disabled={query.loading} onClick={query.refresh}>Tải lại lịch sử</button></div>
    {query.error && <p role="alert" className="banner">{query.error} <button className="secondary" onClick={query.refresh}>Thử lại</button></p>}
    {query.loading && <p role="status">Đang tải lịch sử…</p>}
    {!query.loading && !query.error && !query.rows.length && <p>Chưa có sự kiện được đồng bộ.</p>}
    {!!query.rows.length && <div className="table-scroll"><table><thead><tr><th scope="col">Sự kiện</th><th scope="col">Block</th><th scope="col">Transaction hash</th></tr></thead><tbody>{query.rows.map(event => <tr key={`${event.transactionHash}-${event.logIndex}`}><td>{event.name}</td><td>{event.blockNumber}</td><td className="mono small">{event.transactionHash}</td></tr>)}</tbody></table></div>}
    {query.hasMore && <button className="secondary" disabled={query.loading} onClick={query.more}>Xem thêm 100 sự kiện</button>}
  </section>;
}
