import type { FormEvent } from "react";
import { createOrder, findParty, listArbiters } from "../../services/orders";
import { useEffect, useRef, useState } from "react";
import { health } from "../../services/health";
import { sameAddress, validateTerms } from "../../domain/rules";
import { formatEthAmount, formatVnd, vndToWei } from "../../domain/money";
import { assertWallet, errorMessage, pendingTimestamp } from "../../wallet";
import type { Arbiter, PartyLookup } from "../../domain/types";
import type { OrdersProps } from "./types";
import StandardTermsPanel, { useStandardTerms } from "./StandardTermsPanel";
import { Copyable } from "../../shared/ui/CopyButton";
import { ORDER_CATEGORIES } from "../../domain/analytics";
const CRITERIA_TEMPLATE = `- Sản phẩm đúng phạm vi đã mô tả ở trên.
- Mã nguồn chạy được theo hướng dẫn đi kèm trong tệp ZIP.
- Không có lỗi nghiêm trọng làm hỏng chức năng chính.
- Bàn giao đủ tài liệu và tài nguyên cần thiết.`;
export default function DraftForm({ session, account, network, canSign, busy, run, chainTime, onCreated, custodial }: OrdersProps & { onCreated: (id: string) => void }) {
  const [formError, setFormError] = useState("");
  const [amount, setAmount] = useState("1000000");
  const [sellerEmail, setSellerEmail] = useState("");
  const [seller, setSeller] = useState<PartyLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const [arbiters, setArbiters] = useState<Arbiter[] | null>(null);
  const [arbiterError, setArbiterError] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [agreed, setAgreed] = useState(false);
  const standard = useStandardTerms(session.accessToken);
  let exactAmount = "Chưa hợp lệ";
  try { const wei = vndToWei(amount); exactAmount = `${formatVnd(wei)} (${formatEthAmount(wei)})`; } catch { /* Submission reports validation. */ }
  const scope = `${session.accessToken}|${account}|${network.deploymentId}|${canSign}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const mounted = useRef(true);
  const lookupId = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    // The list follows the chain through the worker, so an Arbiter added or removed while this form is open shows up here.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const value = await listArbiters(session.accessToken, controller.signal); setArbiters(value); setArbiterError(""); }
      catch (failure) { if (!controller.signal.aborted) setArbiterError(errorMessage(failure)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session.accessToken, network.deploymentId]);
  const defaultTime = new Date(Math.max(Date.now(), chainTime * 1000) + 86400000);
  const localDate = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // Neither party may rule on its own order.
  const choices = (arbiters ?? []).filter(item => !sameAddress(item.address, account) && !sameAddress(item.address, seller?.address));
  // A single Arbiter on the list is the default; there is nothing to choose.
  const chosenArbiter = choices.find(item => sameAddress(item.address, arbiter)) ?? (choices.length === 1 ? choices[0] : undefined);
  async function lookup(): Promise<void> {
    const email = sellerEmail.trim();
    if (!email) return;
    const id = ++lookupId.current;
    setLooking(true); setLookupError(""); setSeller(null);
    try { const found = await findParty(session.accessToken, email); if (id === lookupId.current && mounted.current) setSeller(found); }
    catch (failure) { if (id === lookupId.current && mounted.current) setLookupError(errorMessage(failure)); }
    finally { if (id === lookupId.current && mounted.current) setLooking(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFormError("");
    void run("Tạo bản nháp", async () => {
      try {
      if (!canSign || network.status !== "Ready") throw new Error("Ví hoặc blockchain chưa sẵn sàng. Tải lại trước khi lưu bản nháp.");
      if (!seller) throw new Error("Tìm Seller theo email trước khi lưu bản nháp.");
      if (!chosenArbiter) throw new Error("Chọn Arbiter trong danh sách của nền tảng.");
      if (!agreed || !standard.terms) throw new Error("Bạn cần đọc và đồng ý với điều khoản giao dịch.");
      const description = String(data.get("description") ?? "").trim();
      const acceptanceCriteria = String(data.get("criteria") ?? "").trim();
      if (!description || !acceptanceCriteria || description.length > 4000 || acceptanceCriteria.length > 4000) throw new Error("Nội dung và tiêu chí cần từ 1 đến 4.000 ký tự.");
      const deadline = Math.floor(new Date(String(data.get("deadline"))).getTime() / 1000);
      if (!Number.isSafeInteger(deadline) || deadline <= Math.max(chainTime, Math.floor(Date.now() / 1000))) throw new Error("Hạn giao phải ở tương lai theo cả máy và blockchain.");
      const reviewWindow = Number(data.get("review"));
      if (!Number.isSafeInteger(reviewWindow) || reviewWindow < 1 || reviewWindow > 31536000) throw new Error("Khoảng phản hồi từ 1 đến 31.536.000 giây.");
      const [freshNetwork, timestamp] = await Promise.all([health(), pendingTimestamp(), custodial ? undefined : assertWallet(account)]);
      if (!mounted.current || liveScope.current !== scope) throw new Error("Tài khoản hoặc ví đã thay đổi. Hãy thao tác lại.");
      if (freshNetwork.status !== "Ready" || freshNetwork.deploymentId !== network.deploymentId) throw new Error("Deployment đã thay đổi hoặc chưa sẵn sàng.");
      if (deadline <= Math.max(timestamp, Math.floor(Date.now() / 1000))) throw new Error("Hạn giao đã qua theo thời gian blockchain hoặc máy bạn.");
      const created = await createOrder(session.accessToken, { sellerEmail: sellerEmail.trim(), arbiter: chosenArbiter.address,
        acceptedTermsVersion: standard.terms.version, description, acceptanceCriteria, amountWei: vndToWei(String(data.get("amount"))),
        deliveryDeadline: deadline, reviewWindow, category: String(data.get("category")) });
      if (!mounted.current || liveScope.current !== scope) return;
      validateTerms(created, freshNetwork); onCreated(created.draft.id);
      } catch (failure) { if (mounted.current && liveScope.current === scope) setFormError(errorMessage(failure)); throw failure; }
    });
  }
  return <form className="draft-form" onSubmit={submit}><h3>Bản nháp mới</h3><p>Sau khi lưu, nội dung đơn không sửa được. Seller xem và chấp nhận điều khoản trước khi bạn ký quỹ.</p>
    <div className="grid"><div className="party-lookup"><label>Email Seller<input name="sellerEmail" type="email" required autoComplete="off" value={sellerEmail} onChange={event => { setSellerEmail(event.target.value); setSeller(null); setLookupError(""); lookupId.current++; setLooking(false); }} onBlur={() => { if (!seller) void lookup(); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void lookup(); } }} placeholder="Email tài khoản của Seller" /></label>
        <button type="button" className="secondary" disabled={looking || !sellerEmail.trim()} onClick={() => void lookup()}>{looking ? "Đang tìm…" : "Tìm Seller"}</button>
        {seller && <p className="party-found" role="status"><strong>{seller.fullName}</strong> · {seller.maskedEmail}<br /><Copyable className="small" value={seller.address} label="ví Seller" /></p>}
        {lookupError && <p className="banner" role="alert">{lookupError}</p>}</div>
      <div><label>Arbiter<select name="arbiter" required value={chosenArbiter?.address ?? ""} onChange={event => setArbiter(event.target.value)}><option value="">Chọn Arbiter</option>{choices.map(item => <option key={item.address} value={item.address}>{item.fullName}</option>)}</select></label>
        {chosenArbiter && <p className="small"><Copyable value={chosenArbiter.address} label="ví Arbiter" /></p>}
        {arbiterError ? <p className="banner" role="alert">{arbiterError}</p> : arbiters && !choices.length ? <p className="banner" role="alert">Chưa có Arbiter phù hợp. Admin cần thêm Arbiter ở mục Quản trị.</p> : <p className="small muted">Danh sách do nền tảng quản lý. Arbiter mặc định là Admin của nền tảng, cũng là ví nhận phí 1% trên phần Seller được nhận. Seller cũng xem Arbiter này trước khi chấp nhận.</p>}</div></div>
    <label>Loại dịch vụ<select name="category" required defaultValue="design">{ORDER_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label>Nội dung công việc<textarea name="description" required maxLength={4000} placeholder="Thiết kế và lập trình landing page…" /></label>
    <label>Tiêu chí nghiệm thu<textarea name="criteria" required maxLength={4000} defaultValue={CRITERIA_TEMPLATE} rows={5} /></label>
    <div className="grid three"><label>Số tiền (VND)<input name="amount" inputMode="numeric" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label>Hạn giao (giờ máy bạn)<input name="deadline" type="datetime-local" required defaultValue={localDate} /></label>
      <label>Thời gian phản hồi (giây)<input name="review" type="number" required min={1} max={31536000} step={1} defaultValue={300} /></label></div>
    <p className="muted">Phí nền tảng: 1% phần Seller được nhận. Buyer không mất phí nền tảng trên phần được hoàn.{custodial ? " Phí gas do nền tảng chi trả." : " Gas tính riêng."}</p>
    <p><strong>Số tiền ký quỹ: {exactAmount}</strong> · Lưu bản nháp → Tạo đơn → Seller chấp nhận → Ký quỹ.</p>
    <StandardTermsPanel {...standard} agreed={agreed} onAgree={setAgreed} label="Tôi đã đọc và đồng ý với các điều khoản giao dịch trên." />
    {formError && <p role="alert" className="banner">{formError}</p>}
    <button disabled={busy || !canSign || network.status !== "Ready" || !seller || !chosenArbiter || !agreed || !standard.terms}>Lưu bản nháp</button>
  </form>;
}
