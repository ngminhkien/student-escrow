import { useEffect, useRef, useState } from "react";
import { getOrder } from "../../services/orders";
import { health } from "../../services/health";
import { actions, eth, sameAddress, settlement, shareBps, validateTerms } from "../../domain/rules";
import { pendingTimestamp, sendTransaction, assertWallet } from "../../wallet";
import type { OrderView } from "../../domain/types";
import type { OrdersProps } from "./types";
export default function OrderActions({ session, account, canSign, network, chainTime, busy, run, record, view, blockedHash, onRefresh }: OrdersProps & { view: OrderView; blockedHash: boolean; onRefresh: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [percent, setPercent] = useState("70");
  const allowed = actions(view, account, network, chainTime);
  const draft = view.draft;
  const product = view.files.find(file => file.kind === "product");
  const scope = `${session.accessToken}|${account}|${network.deploymentId}|${draft.id}|${canSign}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function assertScope() {
    if (!mounted.current || liveScope.current !== scope) throw new Error("Tài khoản, ví hoặc đơn đã thay đổi. Hãy thao tác lại.");
  }
  useEffect(() => { setAcknowledged(false); }, [account, product?.sha256, view.chain?.deliveryHash]);
  let preview: ReturnType<typeof settlement> | null = null;
  try { preview = settlement(draft.amountWei, percent); } catch { /* Validated when submitted. */ }
  async function transact(action: keyof ReturnType<typeof actions>) {
    if (!canSign || (action === "deliver" && blockedHash)) throw new Error("Ví chưa sẵn sàng hoặc hash sản phẩm chưa được xác minh.");
    await assertWallet(account);
    const freshNetwork = await health();
    const fresh = await getOrder(session.accessToken, draft.id);
    validateTerms(fresh, freshNetwork);
    const timestamp = await pendingTimestamp();
    assertScope();
    if (!actions(fresh, account, freshNetwork, timestamp)[action]) throw new Error("Vai trò, trạng thái hoặc hạn thao tác đã thay đổi. Tải lại đơn.");
    let method: string, args: unknown[];
    const id = fresh.chain?.orderId;
    switch (action) {
      case "create": method = "createOrder"; args = [fresh.draft.seller, fresh.draft.arbiter, fresh.draft.amountWei, fresh.draft.clientReference, fresh.draft.termsHash, fresh.draft.deliveryDeadline, fresh.draft.reviewWindow]; break;
      case "deposit": method = "deposit"; args = [id, { value: BigInt(fresh.draft.amountWei) }]; break;
      case "deliver": {
        const file = fresh.files.find(item => item.kind === "product");
        if (blockedHash) throw new Error("Hash ZIP đã tải lên không khớp, không thể ký bàn giao.");
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
    await sendTransaction(account, draft.deploymentId, method, args, record, assertScope);
    if (mounted.current && liveScope.current === scope) { setAcknowledged(false); onRefresh(); }
  }
  const disabled = busy || !canSign || !chainTime;
  function button(action: keyof ReturnType<typeof actions>, label: string) {
    return allowed[action] && <button disabled={disabled || (action === "deliver" && (!product || blockedHash)) || (action === "confirm" && !acknowledged)}
      onClick={() => void run(label, () => transact(action))}>{label}</button>;
  }
  return <>
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
  </>;
}

