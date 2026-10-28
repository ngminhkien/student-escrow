import { useEffect, useRef, useState } from "react";
import { getOrder } from "../../services/orders";
import { health } from "../../services/health";
import { actions, eth, sameAddress, settlement, shareBps, validateTerms } from "../../domain/rules";
import { pendingTimestamp, sendTransaction, assertWallet, contractAt, errorMessage } from "../../wallet";
import type { OrderView } from "../../domain/types";
import type { OrdersProps } from "./types";
import { useOrderCreation } from "./useOrderCreation";
import { useOrderSubmission } from "./useOrderSubmission";
import { useOrderEligibility } from "./useOrderEligibility";
export default function OrderActions({ session, account, canSign, network, chainTime, busy, run, record, view, blockedHash, onRefresh }: OrdersProps & { view: OrderView; blockedHash: boolean; onRefresh: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [deliveryAcknowledged, setDeliveryAcknowledged] = useState(false);
  const [percent, setPercent] = useState("70");
  const [actionError, setActionError] = useState("");
  const errorRegion = useRef<HTMLDivElement>(null);
  const allowed = actions(view, account, network, chainTime);
  const draft = view.draft;
  const creation = useOrderCreation(draft, network, !!view.chain);
  const needsVerification = !view.chain || view.chain.state === "Created";
  const eligibility = useOrderEligibility(draft, network, needsVerification);
  const product = view.files.find(file => file.kind === "product");
  const seller = sameAddress(account, draft.seller);
  const buyer = sameAddress(account, draft.buyer);
  const delivery = useOrderSubmission(draft, "markDelivered", network.status === "Ready" && draft.deploymentId === network.deploymentId && view.chain?.state === "Funded");
  const scope = `${session.accessToken}|${account}|${network.deploymentId}|${draft.id}|${canSign}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function assertScope() {
    if (!mounted.current || liveScope.current !== scope) throw new Error("Tài khoản, ví hoặc đơn đã thay đổi. Hãy thao tác lại.");
  }
  useEffect(() => { setAcknowledged(false); }, [account, product?.sha256, view.chain?.deliveryHash]);
  useEffect(() => { setDeliveryAcknowledged(false); }, [account, product?.sha256, view.chain?.state]);
  useEffect(() => { if (actionError) { errorRegion.current?.focus({ preventScroll: true }); errorRegion.current?.scrollIntoView({ block: "nearest" }); } }, [actionError]);
  let preview: ReturnType<typeof settlement> | null = null;
  try { preview = settlement(draft.amountWei, percent); } catch { /* Validated when submitted. */ }
  async function transact(action: keyof ReturnType<typeof actions>) {
    setActionError("");
    try { await transactChecked(action); }
    catch (failure) { if (mounted.current) setActionError(errorMessage(failure)); throw failure; }
  }
  async function transactChecked(action: keyof ReturnType<typeof actions>) {
    if (action === "create" && creation.blocked) throw new Error("Đơn đang được kiểm tra, đang chờ xác nhận hoặc đã được tạo trên chain. Không gửi lại.");
    if ((action === "create" || action === "deposit") && !eligibility.ready) throw new Error("Buyer và Seller phải được Admin xác minh trên contract hiện tại trước khi tạo đơn hoặc nạp ETH.");
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
        if (!deliveryAcknowledged || delivery.value) throw new Error("Xác nhận ZIP đã tải lên trước khi bàn giao. Nếu giao dịch đã gửi, chờ xác nhận và đồng bộ.");
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
    if (action === "create") {
      const exists = await contractAt(freshNetwork).usedClientReferences(fresh.draft.buyer, fresh.draft.clientReference) as boolean;
      assertScope();
      if (exists) { creation.refresh(); onRefresh(); throw new Error("Đơn đã được tạo trên chain. Đang chờ backend đồng bộ; không cần tạo lại."); }
    }
    await sendTransaction(account, draft.deploymentId, method, args, transaction => {
      if (action === "create") creation.track(transaction);
      if (action === "deliver") delivery.track(transaction);
      record(transaction);
    }, assertScope);
    if (mounted.current && liveScope.current === scope) { setAcknowledged(false); onRefresh(); }
  }
  const disabled = busy || !canSign || !chainTime;
  const deliveryComplete = !!view.chain && ["Delivered", "Completed", "Disputed", "Resolved"].includes(view.chain.state) && !!view.chain.deliveryHash;
  const deliveryReason = deliveryComplete ? "Đã xác nhận bàn giao trên blockchain. Không cần gửi lại."
    : delivery.value ? "Đã gửi giao dịch bàn giao. Chờ xác nhận và backend đồng bộ; không gửi lại."
    : !canSign ? "Kết nối đúng ví Seller và mạng local để bàn giao."
    : draft.deploymentId !== network.deploymentId || view.syncStatus === "Archived" ? "Đơn thuộc deployment cũ; không thể bàn giao trên mạng hiện tại."
    : network.status !== "Ready" || view.syncStatus !== "Ready" ? "Kết nối hoặc đồng bộ blockchain chưa sẵn sàng."
    : !view.chain ? "Buyer chưa tạo đơn trên blockchain. Chờ Buyer tạo đơn và nạp ETH ký quỹ."
    : !view.termsMatch ? "Điều khoản trên chain chưa khớp bản nháp; hãy kiểm tra đồng bộ."
    : view.chain.state === "Created" ? "Buyer chưa nạp ETH ký quỹ. Chỉ bàn giao sau khi đơn ở trạng thái Đã ký quỹ."
    : view.chain.state !== "Funded" ? "Trạng thái đơn hiện tại không cho phép bàn giao."
    : !chainTime ? "Đang kiểm tra thời gian blockchain."
    : chainTime > draft.deliveryDeadline ? "Đã quá hạn giao. Không thể xác nhận bàn giao; Buyer có thể yêu cầu hoàn tiền."
    : blockedHash ? "Hash ZIP không khớp. Bàn giao đang bị khóa."
    : !product ? "Bước tiếp theo: tải file ZIP mã nguồn lên ở mục Sản phẩm bàn giao phía trên."
    : "Kiểm tra ZIP đã tải lên, tích ô xác nhận rồi bấm nút bên dưới. MetaMask sẽ yêu cầu bạn xác nhận giao dịch bàn giao và phí gas.";
  function button(action: keyof ReturnType<typeof actions>, label: string) {
    const createLabel = creation.created ? "Đã tạo trên chain" : creation.submission ? "Đang chờ xác nhận / đồng bộ" : label;
    return allowed[action] && <button className={action === "dispute" || action === "refund" ? "secondary" : undefined} disabled={disabled || ((action === "create" || action === "deposit") && !eligibility.ready) || (action === "create" && creation.blocked) || (action === "deliver" && (!product || blockedHash)) || (action === "confirm" && !acknowledged)}
      onClick={() => void run(label, () => transact(action), { inlineError: true })}>{action === "create" ? createLabel : label}</button>;
  }
  if (view.chain && ["Completed", "Resolved", "Refunded"].includes(view.chain.state)) return <section className="settlement-card" aria-label="Kết quả thanh toán">
    <h3>{view.chain.state === "Completed" ? "Thanh toán thành công" : view.chain.state === "Refunded" ? "Đã hoàn tiền" : "Đã phân xử"}</h3>
    <dl><div><dt>Seller nhận</dt><dd>{eth(view.chain.sellerNetWei)} ETH</dd></div><div><dt>Phí nền tảng</dt><dd>{eth(view.chain.platformFeeWei)} ETH</dd></div><div><dt>Buyer được hoàn</dt><dd>{eth(view.chain.buyerRefundWei)} ETH</dd></div></dl>
  </section>;
  return <>
    <div className="actions"><h3>Thao tác</h3>
      {actionError && <div ref={errorRegion} tabIndex={-1} className="banner" role="alert"><strong>Chưa thể thực hiện giao dịch</strong><p>{actionError}</p></div>}
      {!canSign && <p>Chọn đúng ví liên kết của tài khoản và mạng local để ký.</p>}
      {needsVerification && !eligibility.ready && <section className="banner verification-requirements" aria-label="Điều kiện xác minh ví" aria-live="polite" aria-atomic="true">
        <strong>{eligibility.error ? "Chưa kiểm tra được quyền giao dịch" : eligibility.buyer === null ? "Đang kiểm tra xác minh ví" : "Cần Admin xác minh ví trước khi giao dịch"}</strong>
        {eligibility.error ? <p>{eligibility.error}</p> : eligibility.buyer !== null && <><p>Buyer: <strong>{eligibility.buyer ? "Đã xác minh" : "Chưa xác minh"}</strong><br /><span className="mono">{draft.buyer}</span></p><p>Seller: <strong>{eligibility.seller ? "Đã xác minh" : "Chưa xác minh"}</strong><br /><span className="mono">{draft.seller}</span></p></>}
        <p>Đăng nhập tài khoản Admin, tra cứu từng ví chưa xác minh, bấm “Xác minh ví” và xác nhận MetaMask. Sau mỗi lần deploy mới cần xác minh lại; KYC mock trong SQL không tự cấp quyền trên chain.</p>
        <button className="secondary" disabled={busy} onClick={eligibility.refresh}>Kiểm tra lại xác minh ví</button>
      </section>}
      <div className="row">{button("create", "Tạo đơn trên chain")}{button("deposit", `Nạp ${eth(draft.amountWei)} ETH`)}</div>
      {seller && <section className="seller-delivery" aria-label="Xác nhận bàn giao mã nguồn"><h3>Xác nhận bàn giao mã nguồn</h3><p>{deliveryReason}</p>
        {!deliveryComplete && <label className="checkbox"><input type="checkbox" checked={deliveryAcknowledged} disabled={disabled || !allowed.deliver || !product || blockedHash || !!delivery.value} onChange={event => setDeliveryAcknowledged(event.target.checked)} />Tôi xác nhận ZIP đã tải lên là mã nguồn hoàn chỉnh theo điều khoản của đơn.</label>}
        <button disabled={disabled || !allowed.deliver || !product || blockedHash || !deliveryAcknowledged || !!delivery.value} onClick={() => void run("Xác nhận đã gửi code", () => transact("deliver"), { inlineError: true })}>{deliveryComplete ? "Đã xác nhận bàn giao" : delivery.value ? "Đang chờ xác nhận bàn giao" : "Xác nhận đã gửi code"}</button>
        {delivery.value && <p className="mono small">Giao dịch: {delivery.value.hash}</p>}
      </section>}
      {!view.chain && creation.created && <p role="status">Đơn đã được tạo trên blockchain. Đang chờ backend đồng bộ để mở bước nạp ETH; không cần bấm tạo lại.</p>}
      {!view.chain && creation.submission && !creation.created && <p role="status">Đã gửi giao dịch tạo đơn. Đang kiểm tra kết quả; nút tạo lại đã bị khóa.<span className="mono small"> {creation.submission.hash}</span></p>}
      {allowed.create && creation.error && <p className="banner" role="alert">Chưa kiểm tra được đơn trên blockchain. Nút tạo đơn đang khóa để tránh gửi trùng. {creation.error} <button className="secondary" disabled={busy} onClick={creation.refresh}>Kiểm tra lại giao dịch tạo đơn</button></p>}
      {allowed.deliver && !product && <p>Seller cần upload ZIP trước khi ký bàn giao.</p>}
      {allowed.confirm && <div><label className="checkbox"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Tôi đã kiểm tra file và chấp nhận sản phẩm theo điều khoản.</label>{button("confirm", "Xác nhận nghiệm thu")}</div>}
      {view.chain?.state === "Delivered" && !view.deliveryFileMatchesChain && <p className="banner">Hash bàn giao trên chain chưa khớp ZIP lưu trên hệ thống. Kiểm tra file hoặc mở tranh chấp trong hạn.</p>}
      {allowed.resolve && <div className="resolution"><label>Phần Seller được hưởng (%)<input type="number" min={0} max={100} step="0.01" value={percent} onChange={e => setPercent(e.target.value)} /></label>
        {preview && <p>Buyer hoàn {eth(preview.buyer.toString())} ETH · Seller thực nhận {eth(preview.seller.toString())} ETH · Phí {eth(preview.fee.toString())} ETH</p>}
        {button("resolve", "Phân xử và thanh toán")}</div>}
      {view.chain && ["Completed", "Resolved", "Refunded"].includes(view.chain.state) && <p>Buyer đã nhận lại {eth(view.chain.buyerRefundWei)} ETH · Seller nhận {eth(view.chain.sellerNetWei)} ETH · Phí nền tảng {eth(view.chain.platformFeeWei)} ETH. Gas tính riêng.</p>}
      {view.chain?.state === "Disputed" && !sameAddress(account, draft.arbiter) && <p>Đang chờ Arbiter của đơn phân xử. Buyer/Seller có thể bổ sung bằng chứng.</p>}
      <div className="row secondary-order-actions">
        {(buyer || seller) && <button className="secondary" disabled={disabled || !allowed.dispute}
          title={allowed.dispute ? "" : view.chain?.state === "Disputed" ? "Đơn đang tranh chấp." : view.chain?.state === "Delivered" ? "Đã hết hạn phản hồi hoặc đơn chưa sẵn sàng." : "Chỉ mở tranh chấp sau khi Seller xác nhận bàn giao trên chain."}
          onClick={() => void run("Mở tranh chấp", () => transact("dispute"), { inlineError: true })}>Mở tranh chấp</button>}
        {buyer && <button className="secondary" disabled={disabled || !allowed.refund}
          title={allowed.refund ? "" : "Chỉ hoàn tiền khi đã quá hạn giao và Seller chưa bàn giao."}
          onClick={() => void run("Hoàn tiền do quá hạn giao", () => transact("refund"), { inlineError: true })}>Hoàn tiền do quá hạn giao</button>}
        {button("claim", "Nhận tiền sau hạn phản hồi")}
      </div>
    </div>
  </>;
}

