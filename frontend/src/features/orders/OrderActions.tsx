import { useEffect, useRef, useState } from "react";
import { getOrder, runOrderAction } from "../../services/orders";
import Money from "../../shared/ui/Money";
import { formatVnd } from "../../domain/money";
import { health } from "../../services/health";
import { actions, date, eth, sameAddress, settlement, shareBps, validateTerms } from "../../domain/rules";
import { pendingTimestamp, sendTransaction, assertWallet, contractAt, errorMessage } from "../../wallet";
import type { OrderAction, OrderView, TxRecord } from "../../domain/types";
import type { OrdersProps } from "./types";
import { useOrderCreation } from "./useOrderCreation";
import { useOrderSubmission } from "./useOrderSubmission";
import { useOrderEligibility } from "./useOrderEligibility";
import StandardTermsPanel, { useStandardTerms } from "./StandardTermsPanel";
import { Copyable } from "../../shared/ui/CopyButton";
import { TxHash } from "../chain/ReceiptLink";
export default function OrderActions({ session, account, canSign, network, chainTime, busy, run, record, view, blockedHash, onRefresh, custodial }: OrdersProps & { view: OrderView; blockedHash: boolean; onRefresh: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [deliveryAcknowledged, setDeliveryAcknowledged] = useState(false);
  const [percent, setPercent] = useState("70");
  const [actionError, setActionError] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const errorRegion = useRef<HTMLDivElement>(null);
  const allowed = actions(view, account, network, chainTime);
  const draft = view.draft;
  const creation = useOrderCreation(draft, network, !!view.chain);
  const needsVerification = !view.chain || view.chain.state === "Created" || view.chain.state === "Accepted";
  const eligibility = useOrderEligibility(draft, network, needsVerification);
  const product = view.files.find(file => file.kind === "product");
  const seller = sameAddress(account, draft.seller);
  const buyer = sameAddress(account, draft.buyer);
  // The wording is checked against the hash sealed into this order, so the Seller agrees to exactly what the Buyer did.
  const sealedTermsHash = (() => { try { return String(JSON.parse(draft.termsJson).standardTermsHash ?? ""); } catch { return ""; } })();
  const standard = useStandardTerms(session.accessToken, draft.standardTermsVersion || undefined, sealedTermsHash);
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
    if (action === "accept" && (!termsAgreed || !standard.terms)) throw new Error("Bạn cần đọc và đồng ý với điều khoản trước khi chấp nhận đơn.");
    if ((action === "create" || action === "deposit" || action === "accept") && !eligibility.ready) throw new Error("Buyer và Seller phải được Admin xác minh trên contract hiện tại trước khi tạo đơn hoặc nạp ETH.");
    if (!canSign || (action === "deliver" && blockedHash)) throw new Error("Ví chưa sẵn sàng hoặc hash sản phẩm chưa được xác minh.");
    if (!custodial) await assertWallet(account);
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
      case "accept": method = "acceptOrder"; args = [id]; break;
      case "cancel": method = "cancelOrder"; args = [id]; break;
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
      case "timeout": method = "claimDisputeTimeout"; args = [id]; break;
      case "resolve": method = "resolveDispute"; args = [id, shareBps(percent)]; break;
      default: throw new Error("Thao tác không hợp lệ.");
    }
    if (action === "create") {
      const exists = await contractAt(freshNetwork).usedClientReferences(fresh.draft.buyer, fresh.draft.clientReference) as boolean;
      assertScope();
      if (exists) { creation.refresh(); onRefresh(); throw new Error("Đơn đã được tạo trên chain. Đang chờ backend đồng bộ; không cần tạo lại."); }
    }
    const onTransaction = (transaction: TxRecord) => {
      if (action === "create") creation.track(transaction);
      if (action === "deliver") delivery.track(transaction);
      record(transaction);
    };
    if (custodial) {
      const result = await runOrderAction(session.accessToken, draft.id, action as OrderAction, action === "resolve" ? { sellerShareBps: Number(shareBps(percent)) } : action === "accept" ? { acceptedTermsVersion: fresh.draft.standardTermsVersion } : {});
      onTransaction({ hash: result.transactionHash, label: method, deploymentId: draft.deploymentId, address: account, status: "Đã xác nhận trên chain", phase: "confirmed" });
    } else {
      await sendTransaction(account, draft.deploymentId, method, args, onTransaction, assertScope);
    }
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
    : view.chain.state === "Created" ? "Bạn chưa chấp nhận điều khoản của đơn. Chấp nhận ở phía trên, sau đó chờ Buyer ký quỹ."
    : view.chain.state === "Cancelled" ? "Đơn đã hủy nên không cần bàn giao."
    : view.chain.state === "Accepted" ? "Buyer chưa nạp ETH ký quỹ. Chỉ bàn giao sau khi đơn ở trạng thái Đã ký quỹ."
    : view.chain.state !== "Funded" ? "Trạng thái đơn hiện tại không cho phép bàn giao."
    : !chainTime ? "Đang kiểm tra thời gian blockchain."
    : chainTime > draft.deliveryDeadline ? "Đã quá hạn giao. Không thể xác nhận bàn giao; Buyer có thể yêu cầu hoàn tiền."
    : blockedHash ? "Hash ZIP không khớp. Bàn giao đang bị khóa."
    : !product ? "Bước tiếp theo: tải file ZIP mã nguồn lên ở mục Sản phẩm bàn giao phía trên."
    : custodial ? "Kiểm tra ZIP đã tải lên, tích ô xác nhận rồi bấm nút bên dưới."
    : "Kiểm tra ZIP đã tải lên, tích ô xác nhận rồi bấm nút bên dưới. MetaMask sẽ yêu cầu bạn xác nhận giao dịch bàn giao và phí gas.";
  function button(action: keyof ReturnType<typeof actions>, label: string) {
    const createLabel = creation.created ? "Đã tạo trên chain" : creation.submission ? "Đang chờ xác nhận / đồng bộ" : label;
    return allowed[action] && <button className={action === "dispute" || action === "refund" ? "secondary" : undefined} disabled={disabled || ((action === "create" || action === "deposit") && !eligibility.ready) || (action === "create" && creation.blocked) || (action === "deliver" && (!product || blockedHash)) || (action === "confirm" && !acknowledged)}
      onClick={() => void run(label, () => transact(action), { inlineError: true })}>{action === "create" ? createLabel : label}</button>;
  }
  if (view.chain && ["Completed", "Resolved", "Refunded"].includes(view.chain.state)) return <section className="settlement-card" aria-label="Kết quả thanh toán">
    <h3>{view.chain.state === "Completed" ? "Thanh toán thành công" : view.chain.state === "Refunded" ? "Đã hoàn tiền" : "Đã phân xử"}</h3>
    <dl><div><dt>Seller nhận</dt><dd><Money wei={view.chain.sellerNetWei} /></dd></div><div><dt>Phí nền tảng</dt><dd><Money wei={view.chain.platformFeeWei} /></dd></div><div><dt>Buyer được hoàn</dt><dd><Money wei={view.chain.buyerRefundWei} /></dd></div></dl>
  </section>;
  if (view.chain?.state === "Cancelled") return <section className="settlement-card" aria-label="Đơn đã hủy"><h3>Đơn đã hủy</h3><p>Đơn được hủy trước khi ký quỹ nên không có khoản tiền nào bị khóa. Nếu vẫn muốn giao dịch, Buyer tạo bản nháp mới.</p></section>;
  return <>
    <div className="actions"><h3>Thao tác</h3>
      {actionError && <div ref={errorRegion} tabIndex={-1} className="banner" role="alert"><strong>Chưa thể thực hiện giao dịch</strong><p>{actionError}</p></div>}
      {!canSign && !custodial && <p>Chọn đúng ví liên kết của tài khoản và mạng local để ký.</p>}
      {needsVerification && !eligibility.ready && <section className="banner verification-requirements" aria-label="Điều kiện xác minh ví" aria-live="polite" aria-atomic="true">
        <strong>{eligibility.error ? "Chưa kiểm tra được quyền giao dịch" : eligibility.buyer === null ? "Đang kiểm tra xác minh ví" : "Cần Admin xác minh ví trước khi giao dịch"}</strong>
        {eligibility.error ? <p>{eligibility.error}</p> : eligibility.buyer !== null && <><p>Buyer: <strong>{eligibility.buyer ? "Đã xác minh" : "Chưa xác minh"}</strong><br /><Copyable value={draft.buyer} label="ví Buyer" /></p><p>Seller: <strong>{eligibility.seller ? "Đã xác minh" : "Chưa xác minh"}</strong><br /><Copyable value={draft.seller} label="ví Seller" /></p></>}
        <p>Đăng nhập tài khoản Admin, tra cứu từng ví chưa xác minh rồi bấm “Xác minh ví”. Sau mỗi lần deploy mới cần xác minh lại; KYC mock trong SQL không tự cấp quyền trên chain.</p>
        <button className="secondary" disabled={busy} onClick={eligibility.refresh}>Kiểm tra lại xác minh ví</button>
      </section>}
      {allowed.accept && <section className="seller-acceptance" aria-label="Chấp nhận điều khoản"><h3>Xem xét và chấp nhận đơn</h3>
        <p>Buyer đề nghị <strong>{formatVnd(draft.amountWei)}</strong>, hạn giao <strong>{date(draft.deliveryDeadline)}</strong>, thời gian phản hồi <strong>{draft.reviewWindow} giây</strong>. Arbiter: <strong>{view.parties?.arbiter?.fullName ?? draft.arbiter}</strong>. Xem nội dung và tiêu chí nghiệm thu ở phần thỏa thuận của đơn.</p>
        <StandardTermsPanel {...standard} agreed={termsAgreed} onAgree={setTermsAgreed} disabled={disabled} label="Tôi đã đọc và đồng ý với thỏa thuận của đơn này cùng các điều khoản giao dịch trên." />
        <div className="row"><button disabled={disabled || !termsAgreed || !standard.terms || !eligibility.ready} onClick={() => void run("Chấp nhận đơn", () => transact("accept"), { inlineError: true })}>Chấp nhận đơn</button>
          <button className="secondary" disabled={disabled} onClick={() => void run("Từ chối đơn", () => transact("cancel"), { inlineError: true })}>Từ chối đơn</button></div>
      </section>}
      {buyer && view.chain?.state === "Created" && <p role="status">Đang chờ Seller đọc và chấp nhận điều khoản. Bạn chưa cần ký quỹ.</p>}
      <div className="row">{button("create", "Tạo đơn trên chain")}{button("deposit", custodial ? `Ký quỹ ${formatVnd(draft.amountWei)}` : `Nạp ${eth(draft.amountWei)} ETH`)}</div>
      {seller && <section className="seller-delivery" aria-label="Xác nhận bàn giao mã nguồn"><h3>Xác nhận bàn giao mã nguồn</h3><p>{deliveryReason}</p>
        {!deliveryComplete && <label className="checkbox"><input type="checkbox" checked={deliveryAcknowledged} disabled={disabled || !allowed.deliver || !product || blockedHash || !!delivery.value} onChange={event => setDeliveryAcknowledged(event.target.checked)} />Tôi xác nhận ZIP đã tải lên là mã nguồn hoàn chỉnh theo điều khoản của đơn.</label>}
        <button disabled={disabled || !allowed.deliver || !product || blockedHash || !deliveryAcknowledged || !!delivery.value} onClick={() => void run("Xác nhận đã gửi code", () => transact("deliver"), { inlineError: true })}>{deliveryComplete ? "Đã xác nhận bàn giao" : delivery.value ? "Đang chờ xác nhận bàn giao" : "Xác nhận đã gửi code"}</button>
        {delivery.value && <p className="small">Giao dịch: <TxHash hash={delivery.value.hash} /></p>}
      </section>}
      {!view.chain && creation.created && <p role="status">Đơn đã được tạo trên blockchain. Đang chờ backend đồng bộ để mở bước nạp ETH; không cần bấm tạo lại.</p>}
      {!view.chain && creation.submission && !creation.created && <p role="status">Đã gửi giao dịch tạo đơn. Đang kiểm tra kết quả; nút tạo lại đã bị khóa. <TxHash hash={creation.submission.hash} /></p>}
      {allowed.create && creation.error && <p className="banner" role="alert">Chưa kiểm tra được đơn trên blockchain. Nút tạo đơn đang khóa để tránh gửi trùng. {creation.error} <button className="secondary" disabled={busy} onClick={creation.refresh}>Kiểm tra lại giao dịch tạo đơn</button></p>}
      {allowed.deliver && !product && <p>Seller cần upload ZIP trước khi ký bàn giao.</p>}
      {allowed.confirm && <div><label className="checkbox"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Tôi đã kiểm tra file và chấp nhận sản phẩm theo điều khoản.</label>{button("confirm", "Xác nhận nghiệm thu")}</div>}
      {view.chain?.state === "Delivered" && !view.deliveryFileMatchesChain && <p className="banner">Hash bàn giao trên chain chưa khớp ZIP lưu trên hệ thống. Kiểm tra file hoặc mở tranh chấp trong hạn.</p>}
      {allowed.resolve && <div className="resolution"><label>Phần Seller được hưởng (%)<input type="number" min={0} max={100} step="0.01" value={percent} onChange={e => setPercent(e.target.value)} /></label>
        {preview && <p>Buyer hoàn {formatVnd(preview.buyer)} · Seller thực nhận {formatVnd(preview.seller)} · Phí {formatVnd(preview.fee)} <span className="small muted">({eth(preview.buyer.toString())} / {eth(preview.seller.toString())} / {eth(preview.fee.toString())} ETH)</span></p>}
        {button("resolve", "Phân xử và thanh toán")}</div>}
      {view.chain?.state === "Disputed" && !sameAddress(account, draft.arbiter) && <p>Đang chờ Arbiter của đơn phân xử. Buyer/Seller có thể bổ sung bằng chứng. Nếu Arbiter không phân xử sau 30 ngày, bên nào cũng có thể yêu cầu chia đôi số tiền.</p>}
      <div className="row secondary-order-actions">
        {(buyer || seller) && <button className="secondary" disabled={disabled || !allowed.dispute}
          title={allowed.dispute ? "" : view.chain?.state === "Disputed" ? "Đơn đang tranh chấp." : view.chain?.state === "Delivered" ? "Đã hết hạn phản hồi hoặc đơn chưa sẵn sàng." : "Chỉ mở tranh chấp sau khi Seller xác nhận bàn giao trên chain."}
          onClick={() => void run("Mở tranh chấp", () => transact("dispute"), { inlineError: true })}>Mở tranh chấp</button>}
        {buyer && <button className="secondary" disabled={disabled || !allowed.refund}
          title={allowed.refund ? "" : "Chỉ hoàn tiền khi đã quá hạn giao và Seller chưa bàn giao."}
          onClick={() => void run("Hoàn tiền do quá hạn giao", () => transact("refund"), { inlineError: true })}>Hoàn tiền do quá hạn giao</button>}
        {button("claim", "Nhận tiền sau hạn phản hồi")}
        {button("timeout", "Chia đôi do quá hạn phân xử")}
        {allowed.cancel && (buyer || view.chain?.state === "Accepted") && <button className="secondary" disabled={disabled} onClick={() => void run("Hủy đơn", () => transact("cancel"), { inlineError: true })}>Hủy đơn</button>}
      </div>
      {!allowed.accept && standard.terms && <details className="applied-terms"><summary>Điều khoản giao dịch của đơn</summary><StandardTermsPanel {...standard} /></details>}
    </div>
  </>;
}

