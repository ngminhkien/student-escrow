import type { FormEvent } from "react";
import { createOrder } from "../../services/orders";
import { useEffect, useRef, useState } from "react";
import { health } from "../../services/health";
import { address, amountWei, eth, sameAddress, validateTerms } from "../../domain/rules";
import { assertWallet, errorMessage, pendingTimestamp } from "../../wallet";
import type { OrdersProps } from "./types";
export default function DraftForm({ session, account, network, canSign, busy, run, chainTime, onCreated }: OrdersProps & { onCreated: (id: string) => void }) {
  const [formError, setFormError] = useState("");
  const [amount, setAmount] = useState("0.01");
  let exactAmount = "Chưa hợp lệ";
  try { exactAmount = `${eth(amountWei(amount))} ETH`; } catch { /* Submission reports validation. */ }
  const scope = `${session.accessToken}|${account}|${network.deploymentId}|${canSign}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const defaultTime = new Date(Math.max(Date.now(), chainTime * 1000) + 86400000);
  const localDate = new Date(defaultTime.getTime() - defaultTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFormError("");
    void run("Tạo bản nháp", async () => {
      try {
      if (!canSign || network.status !== "Ready") throw new Error("Ví hoặc blockchain chưa sẵn sàng. Tải lại trước khi lưu bản nháp.");
      const buyer = address(account);
      const description = String(data.get("description") ?? "").trim();
      const acceptanceCriteria = String(data.get("criteria") ?? "").trim();
      if (!description || !acceptanceCriteria || description.length > 4000 || acceptanceCriteria.length > 4000) throw new Error("Nội dung và tiêu chí cần từ 1 đến 4.000 ký tự.");
      const seller = address(String(data.get("seller"))), arbiter = address(String(data.get("arbiter")));
      if (sameAddress(account, seller) || sameAddress(account, arbiter) || sameAddress(seller, arbiter)) throw new Error("Buyer, Seller, Arbiter phải là ba ví khác nhau.");
      if ([buyer, seller, arbiter].some(value => sameAddress(value, network.contractAddress))) throw new Error("Không sử dụng địa chỉ contract làm bên tham gia.");
      const deadline = Math.floor(new Date(String(data.get("deadline"))).getTime() / 1000);
      if (!Number.isSafeInteger(deadline) || deadline <= Math.max(chainTime, Math.floor(Date.now() / 1000))) throw new Error("Hạn giao phải ở tương lai theo cả máy và blockchain.");
      const reviewWindow = Number(data.get("review"));
      if (!Number.isSafeInteger(reviewWindow) || reviewWindow < 1 || reviewWindow > 31536000) throw new Error("Khoảng phản hồi từ 1 đến 31.536.000 giây.");
      const [freshNetwork, timestamp] = await Promise.all([health(), pendingTimestamp(), assertWallet(account)]);
      if (!mounted.current || liveScope.current !== scope) throw new Error("Tài khoản hoặc ví đã thay đổi. Hãy thao tác lại.");
      if (freshNetwork.status !== "Ready" || freshNetwork.deploymentId !== network.deploymentId) throw new Error("Deployment đã thay đổi hoặc chưa sẵn sàng.");
      if (deadline <= Math.max(timestamp, Math.floor(Date.now() / 1000))) throw new Error("Hạn giao đã qua theo thời gian blockchain hoặc máy bạn.");
      const created = await createOrder(session.accessToken, { seller, arbiter,
        description, acceptanceCriteria, amountWei: amountWei(String(data.get("amount"))),
        deliveryDeadline: deadline, reviewWindow });
      if (!mounted.current || liveScope.current !== scope) return;
      validateTerms(created, freshNetwork); onCreated(created.draft.id);
      } catch (failure) { if (mounted.current && liveScope.current === scope) setFormError(errorMessage(failure)); throw failure; }
    });
  }
  return <form className="draft-form" onSubmit={submit}><h3>Bản nháp mới</h3><p>Điều khoản cố định sau khi lưu. Tạo trên chain và nạp ETH là hai giao dịch riêng sau bước này.</p>
    <p className="mono small">Ví Buyer: {account}</p><div className="grid"><label>Ví Seller<input name="seller" required placeholder="0x…" spellCheck={false} /></label><label>Ví Arbiter<input name="arbiter" required placeholder="0x…" spellCheck={false} /></label></div>
    <label>Nội dung công việc<textarea name="description" required maxLength={4000} placeholder="Thiết kế và lập trình landing page…" /></label>
    <label>Tiêu chí nghiệm thu<textarea name="criteria" required maxLength={4000} placeholder="Các mục bắt buộc, kích thước màn hình cần hỗ trợ…" /></label>
    <div className="grid three"><label>Số tiền (ETH)<input name="amount" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label>Hạn giao (giờ máy bạn)<input name="deadline" type="datetime-local" required defaultValue={localDate} /></label>
      <label>Thời gian phản hồi (giây)<input name="review" type="number" required min={1} max={31536000} step={1} defaultValue={300} /></label></div>
    <p className="muted">Phí nền tảng: 1% phần Seller được nhận. Buyer không mất phí nền tảng trên phần được hoàn. Gas tính riêng.</p>
    <p><strong>Số tiền ký quỹ: {exactAmount}</strong> · Lưu bản nháp → Tạo đơn trên chain → Nạp ETH.</p>
    {formError && <p role="alert" className="banner">{formError}</p>}
    <button disabled={busy || !canSign || network.status !== "Ready"}>Lưu bản nháp</button>
  </form>;
}


