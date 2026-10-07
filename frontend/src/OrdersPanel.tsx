import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { sha256 } from "ethers";
import { api, downloadFile, health } from "./api";
import { actions, address, amountWei, date, eth, sameAddress, settlement, shareBps, short, states, validateTerms } from "./rules";
import { errorMessage, pendingTimestamp, sendTransaction } from "./wallet";
import type { ChainEvent, NetworkStatus, OrderFile, OrderView, RunAction, Session, TxRecord } from "./types";

type Props = { session: Session; account: string; canSign: boolean; network: NetworkStatus; chainTime: number;
  busy: boolean; run: RunAction; record: (tx: TxRecord) => void; revision: number };

export default function OrdersPanel(props: Props) {
  const { session, network, revision, run, busy, canSign } = props;
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get("order") ?? "");
  const [view, setView] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [limit, setLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [localRevision, setLocalRevision] = useState(0);
  function choose(id: string) {
    setSelected(id); setView(null); setEvents([]);
    history.replaceState(null, "", id ? `?order=${encodeURIComponent(id)}` : location.pathname);
  }
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const list: OrderView[] = [];
        for (let skip = 0; skip < limit; skip += 50) {
          const page = await api<OrderView[]>(`/orders?skip=${skip}`, session.accessToken, "GET", undefined, controller.signal);
          list.push(...page); if (page.length < 50) break;
        }
        if (stopped) return;
        setOrders(list); setHasMore(list.length === limit);
        if (selected) {
          const [current, log] = await Promise.all([api<OrderView>(`/orders/${selected}`, session.accessToken, "GET", undefined, controller.signal),
            api<ChainEvent[]>(`/orders/${selected}/events`, session.accessToken, "GET", undefined, controller.signal)]);
          if (stopped) return;
          setView(current); setEvents(log);
        }
        setError("");
      } catch (failure) { if (!stopped) { setError(errorMessage(failure)); setView(null); } }
      finally { if (!stopped) { setLoading(false); timer = setTimeout(() => void refresh(), 5000); } }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [session.accessToken, selected, revision, localRevision, limit, network.deploymentId]);
  return <>
    <section className="panel">
      <div className="section-heading"><div><h2>Đơn hàng của tôi</h2><p>Buyer, Seller và Arbiter xem chung một đơn sau khi liên kết đúng ví.</p></div>
        <div className="row"><button className="secondary" disabled={busy} onClick={() => setLocalRevision(v => v + 1)}>Tải lại đơn</button>
          <button disabled={busy || !canSign || network.status !== "Ready"} onClick={() => setShowCreate(v => !v)}>{showCreate ? "Đóng bản nháp" : "Tạo bản nháp"}</button></div></div>
      {!canSign && <p className="muted">Để thao tác, cần liên kết ví tại mục Tài khoản & ví, chọn đúng tài khoản MetaMask và mạng 31337.</p>}
      {error && <p className="banner" role="alert">{error}</p>}
      {showCreate && <CreateDraft {...props} onCreated={id => { choose(id); setShowCreate(false); }} />}
      {loading ? <p>Đang tải đơn…</p> : orders.length === 0 ? <p>Chưa có đơn nào. Buyer có thể tạo bản nháp mới.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Nội dung</th><th>Vai trò tài khoản</th><th>ETH</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{orders.map(order => <tr key={order.draft.id} className={selected === order.draft.id ? "selected" : ""}>
          <td>{order.draft.description}<div className="small mono">{short(order.draft.id)}</div></td>
          <td>{sameAddress(order.draft.buyer, props.account) ? "Buyer" : sameAddress(order.draft.seller, props.account) ? "Seller" : sameAddress(order.draft.arbiter, props.account) ? "Arbiter" : "Đổi ví để thao tác"}</td>
          <td>{eth(order.draft.amountWei)}</td><td>{states[order.chain?.state ?? "Draft"]}{order.syncStatus !== "Ready" && <div className="small">{order.syncStatus}</div>}</td>
          <td><button className="secondary" aria-label={`Mở đơn ${order.draft.description}`} onClick={() => choose(order.draft.id)}>Mở</button></td>
        </tr>)}</tbody>
      </table></div>}
      {hasMore && <button className="secondary" onClick={() => setLimit(v => v + 50)}>Xem thêm 50 đơn</button>}
      <form className="inline-form" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get("id")).trim(); if (/^[0-9a-f-]{36}$/i.test(id)) choose(id); else void run("Mở đơn", async () => { throw new Error("Mã đơn phải là UUID của bản nháp."); }); }}>
        <label>Mở bằng mã đơn<input name="id" placeholder="UUID bản nháp" required /></label><button className="secondary">Mở mã đơn</button>
      </form>
    </section>
    {selected && !view && !error && <p>Đang tải chi tiết…</p>}
    {view && <OrderDetail key={view.draft.id} {...props} view={view} events={events} />}
  </>;
}

function CreateDraft({ session, account, network, busy, run, chainTime, onCreated }: Props & { onCreated: (id: string) => void }) {
  const defaultTime = new Date(Math.max(Date.now(), chainTime * 1000) + 86400000);
  const localDate = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("Tạo bản nháp", async () => {
      const seller = address(String(data.get("seller"))), arbiter = address(String(data.get("arbiter")));
      if (sameAddress(account, seller) || sameAddress(account, arbiter) || sameAddress(seller, arbiter)) throw new Error("Buyer, Seller, Arbiter phải là ba ví khác nhau.");
      const deadline = Math.floor(new Date(String(data.get("deadline"))).getTime() / 1000);
      if (!Number.isSafeInteger(deadline) || deadline <= Math.max(chainTime, Math.floor(Date.now() / 1000))) throw new Error("Hạn giao phải ở tương lai theo cả máy và blockchain.");
      const reviewWindow = Number(data.get("review"));
      if (!Number.isSafeInteger(reviewWindow) || reviewWindow < 1 || reviewWindow > 31536000) throw new Error("Khoảng phản hồi từ 1 đến 31.536.000 giây.");
      const created = await api<OrderView>("/orders", session.accessToken, "POST", { seller, arbiter,
        description: data.get("description"), acceptanceCriteria: data.get("criteria"), amountWei: amountWei(String(data.get("amount"))),
        deliveryDeadline: deadline, reviewWindow });
      validateTerms(created, network); onCreated(created.draft.id);
    });
  }
  return <form className="draft-form" onSubmit={submit}><h3>Bản nháp mới</h3><p>Điều khoản cố định sau khi lưu. Tạo trên chain và nạp ETH là hai giao dịch riêng sau bước này.</p>
    <div className="grid"><label>Ví Seller<input name="seller" required placeholder="0x…" spellCheck={false} /></label><label>Ví Arbiter<input name="arbiter" required placeholder="0x…" spellCheck={false} /></label></div>
    <label>Nội dung công việc<textarea name="description" required maxLength={4000} placeholder="Thiết kế và lập trình landing page…" /></label>
    <label>Tiêu chí nghiệm thu<textarea name="criteria" required maxLength={4000} placeholder="Các mục bắt buộc, kích thước màn hình cần hỗ trợ…" /></label>
    <div className="grid three"><label>Số tiền (ETH)<input name="amount" inputMode="decimal" required defaultValue="0.01" /></label>
      <label>Hạn giao (giờ máy bạn)<input name="deadline" type="datetime-local" required defaultValue={localDate} /></label>
      <label>Thời gian phản hồi (giây)<input name="review" type="number" required min={1} max={31536000} step={1} defaultValue={300} /></label></div>
    <p className="muted">Phí nền tảng: 1% phần Seller được nhận. Buyer không mất phí nền tảng trên phần được hoàn. Gas tính riêng.</p>
    <button disabled={busy}>Lưu bản nháp</button>
  </form>;
}

function OrderDetail({ session, account, canSign, network, chainTime, busy, run, record, view, events }: Props & { view: OrderView; events: ChainEvent[] }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [percent, setPercent] = useState("70");
  const [fileCheck, setFileCheck] = useState("");
  const allowed = actions(view, account, network, chainTime);
  const draft = view.draft;
  const product = view.files.find(file => file.kind === "product");
  let preview: ReturnType<typeof settlement> | null = null;
  try { preview = settlement(draft.amountWei, percent); } catch { /* Validated when submitted. */ }
  async function transact(action: keyof ReturnType<typeof actions>) {
    const freshNetwork = await health();
    const fresh = await api<OrderView>(`/orders/${draft.id}`, session.accessToken);
    validateTerms(fresh, freshNetwork);
    const timestamp = await pendingTimestamp();
    if (!actions(fresh, account, freshNetwork, timestamp)[action]) throw new Error("Vai trò, trạng thái hoặc hạn thao tác đã thay đổi. Tải lại đơn.");
    let method: string, args: unknown[];
    const id = fresh.chain?.orderId;
    switch (action) {
      case "create": method = "createOrder"; args = [draft.seller, draft.arbiter, draft.amountWei, draft.clientReference, draft.termsHash, draft.deliveryDeadline, draft.reviewWindow]; break;
      case "deposit": method = "deposit"; args = [id, { value: BigInt(draft.amountWei) }]; break;
      case "deliver": {
        const file = fresh.files.find(item => item.kind === "product");
        if (!file) throw new Error("Upload ZIP sản phẩm trước khi bàn giao.");
        method = "markDelivered"; args = [id, file.sha256]; break;
      }
      case "confirm": if (!acknowledged) throw new Error("Xác nhận bạn đã kiểm tra sản phẩm trước khi nghiệm thu."); method = "confirmReceipt"; args = [id]; break;
      case "dispute": method = "raiseDispute"; args = [id]; break;
      case "refund": method = "refundIfExpired"; args = [id]; break;
      case "claim": method = "claimAfterReviewTimeout"; args = [id]; break;
      case "resolve": method = "resolveDispute"; args = [id, shareBps(percent)]; break;
      default: throw new Error("Thao tác không hợp lệ.");
    }
    await sendTransaction(account, draft.deploymentId, method, args, record);
    setAcknowledged(false);
  }
  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file") as File;
    const kind = data.get("kind") as "product" | "evidence";
    void run("Upload file", async () => {
      if (!allowed[kind]) throw new Error("Không có quyền upload loại file này ở trạng thái hiện tại.");
      const limit = kind === "product" ? 50_000_000 : 5_000_000;
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!file.size || file.size > limit) throw new Error(`File phải có nội dung, không quá ${limit / 1000000} MB.`);
      if (!(kind === "product" ? extension === "zip" : ["png", "jpg", "jpeg", "pdf"].includes(extension ?? ""))) throw new Error("Định dạng file không được hỗ trợ.");
      const localHash = sha256(new Uint8Array(await file.arrayBuffer()));
      const saved = await api<OrderFile>(`/orders/${draft.id}/files`, session.accessToken, "POST", data);
      if (saved.sha256 !== localHash) throw new Error("Hash file server trả về khác byte vừa upload. Chưa ký bàn giao.");
      form.reset();
    });
  }
  async function download(file: OrderFile) {
    const bytes = await downloadFile(`/orders/${draft.id}/files/${file.id}`, session.accessToken);
    if (sha256(bytes) !== file.sha256) throw new Error("Hash file tải xuống không khớp. Không dùng file này để nghiệm thu.");
    const link = document.createElement("a"); const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const disabled = busy || !canSign || !chainTime;
  function button(action: keyof ReturnType<typeof actions>, label: string) {
    return allowed[action] && <button disabled={disabled || (action === "deliver" && !product) || (action === "confirm" && !acknowledged)}
      onClick={() => void run(label, () => transact(action))}>{label}</button>;
  }
  return <section className="panel order-detail" aria-label="Chi tiết đơn">
    <div className="section-heading"><h2>{draft.description}</h2><strong data-testid="order-state">{states[view.chain?.state ?? "Draft"]}</strong></div>
    <p className="mono small">Mã đơn: {draft.id}</p>
    <div className="grid"><div><h3>Điều khoản</h3><p className="pre-wrap">{draft.acceptanceCriteria}</p>
      <dl><dt>Số tiền</dt><dd>{eth(draft.amountWei)} ETH</dd><dt>Hạn giao</dt><dd>{date(draft.deliveryDeadline)}</dd>
        <dt>Khoảng phản hồi</dt><dd>{draft.reviewWindow} giây từ khi bàn giao</dd><dt>Hạn phản hồi</dt><dd>{date(view.chain?.reviewDeadline)}</dd>
        <dt>Thời gian blockchain</dt><dd>{date(chainTime)}</dd></dl></div>
      <div><h3>Các bên</h3><dl><dt>Buyer</dt><dd className="mono">{draft.buyer}</dd><dt>Seller</dt><dd className="mono">{draft.seller}</dd><dt>Arbiter</dt><dd className="mono">{draft.arbiter}</dd></dl></div></div>
    <p>Đồng bộ: <strong>{view.syncStatus}</strong> · Block SQL {view.lastIndexedBlock} · Order ID on-chain {view.chain?.orderId ?? "chưa có"}</p>
    {view.chain && !view.termsMatch && <p role="alert" className="banner">Điều khoản trên chain không khớp bản nháp. Các thao tác với đơn này bị khóa.</p>}
    {view.syncStatus === "Archived" && <p className="banner">Đơn thuộc deployment cũ. Bạn vẫn xem và tải file được; hãy tạo đơn mới để demo tiếp.</p>}
    <div className="actions"><h3>Thao tác</h3>
      {!canSign && <p>Chọn đúng ví liên kết của tài khoản và mạng local để ký.</p>}
      <div className="row">{button("create", "Tạo đơn trên chain")}{button("deposit", `Nạp ${eth(draft.amountWei)} ETH`)}
        {button("deliver", "Ký bàn giao")}{button("dispute", "Mở tranh chấp")}{button("refund", "Hoàn tiền do quá hạn giao")}{button("claim", "Nhận tiền sau hạn phản hồi")}</div>
      {allowed.deliver && !product && <p>Seller cần upload ZIP trước khi ký bàn giao.</p>}
      {allowed.confirm && <div><label className="checkbox"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Tôi đã kiểm tra file và chấp nhận sản phẩm theo điều khoản.</label>{button("confirm", "Xác nhận nghiệm thu")}</div>}
      {view.chain?.state === "Delivered" && !view.deliveryFileMatchesChain && <p className="banner">Hash bàn giao trên chain chưa khớp ZIP lưu trên hệ thống. Kiểm tra file hoặc mở tranh chấp trong hạn.</p>}
      {allowed.resolve && <div className="resolution"><label>Phần Seller được hưởng (%)<input type="number" min={0} max={100} step="0.01" value={percent} onChange={e => setPercent(e.target.value)} /></label>
        {preview && <p>Buyer hoàn {eth(preview.buyer.toString())} ETH · Seller thực nhận {eth(preview.seller.toString())} ETH · Phí {eth(preview.fee.toString())} ETH</p>}
        {button("resolve", "Phân xử và thanh toán")}</div>}
      {view.chain && ["Completed", "Resolved", "Refunded"].includes(view.chain.state) && <p>Buyer đã nhận lại {eth(view.chain.buyerRefundWei)} ETH · Seller nhận {eth(view.chain.sellerNetWei)} ETH · Phí nền tảng {eth(view.chain.platformFeeWei)} ETH. Gas tính riêng.</p>}
      {view.chain?.state === "Disputed" && !sameAddress(account, draft.arbiter) && <p>Đang chờ Arbiter của đơn phân xử. Buyer/Seller có thể bổ sung bằng chứng.</p>}
    </div>
    <hr /><h3>File sản phẩm & bằng chứng</h3>
    <p>ZIP: tối đa 50 MB, một bản bất biến. Bằng chứng: PNG/JPG/JPEG/PDF, tối đa 5 MB/file và 5 file/đơn. MB = 1.000.000 byte.</p>
    {(allowed.product || allowed.evidence) && <form className="upload-form" onSubmit={upload}>
      <label>Loại file<select name="kind" aria-label="Loại file" key={`${allowed.product}-${allowed.evidence}`}>
        {allowed.product && <option value="product">Sản phẩm ZIP</option>}{allowed.evidence && <option value="evidence">Bằng chứng</option>}
      </select></label><label>Chọn file<input type="file" name="file" required accept=".zip,.png,.jpg,.jpeg,.pdf" /></label>
      <button disabled={busy || !canSign}>Upload file</button>
    </form>}
    {view.files.length === 0 ? <p>Chưa có file.</p> : <ul className="files">{view.files.map(file => <li key={file.id}>
      <div><strong>{file.fileName}</strong> · {file.kind === "product" ? "Sản phẩm" : "Bằng chứng"} · {file.length.toLocaleString("vi-VN")} byte
        <div className="mono small">SHA-256: {file.sha256}</div></div><button className="secondary" disabled={busy} onClick={() => void run("Tải và kiểm tra hash", () => download(file))}>Tải {file.fileName}</button>
    </li>)}</ul>}
    {view.chain?.deliveryHash && <p data-testid="delivery-match">Hash bàn giao: <span className="mono small">{view.chain.deliveryHash}</span><br />{view.deliveryFileMatchesChain ? "Khớp ZIP trên hệ thống." : "Không khớp ZIP trên hệ thống."}</p>}
    <details><summary>Kiểm tra hash file có trên máy</summary><label>File cần kiểm tra<input type="file" onChange={event => {
      const file = event.currentTarget.files?.[0]; if (!file) return;
      setFileCheck(""); void run("Kiểm tra SHA-256", async () => {
        if (file.size > 50_000_000) throw new Error("Chỉ kiểm tra file tối đa 50 MB.");
        const hash = sha256(new Uint8Array(await file.arrayBuffer()));
        const expected = view.chain?.deliveryHash ?? product?.sha256;
        setFileCheck(`${expected ? hash === expected ? "KHỚP" : "KHÔNG KHỚP" : "Chưa có hash đối chiếu"}: ${hash}`);
      });
    }} /></label><p className="mono small">{fileCheck}</p></details>
    <details><summary>Hash và nội dung điều khoản</summary><p className="mono small">Reference: {draft.clientReference}</p><p className="mono small">SHA-256: {draft.termsHash}</p><pre>{draft.termsJson}</pre></details>
    <hr /><h3>Lịch sử on-chain</h3>
    {events.length === 0 ? <p>Chưa có event được đồng bộ.</p> : <div className="table-scroll"><table><thead><tr><th>Event</th><th>Block</th><th>Transaction hash</th></tr></thead>
      <tbody>{events.map(event => <tr key={`${event.transactionHash}-${event.logIndex}`}><td>{event.name}</td><td>{event.blockNumber}</td><td className="mono small">{event.transactionHash}</td></tr>)}</tbody></table></div>}
  </section>;
}
