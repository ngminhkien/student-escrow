import { sameAddress } from "../../domain/rules";
import type { OrderView } from "../../domain/types";

export default function OrderWorkflow({ view, account, chainTime }: { view: OrderView; account: string; chainTime: number }) {
  const seller = sameAddress(account, view.draft.seller);
  const buyer = sameAddress(account, view.draft.buyer);
  if (!seller && !buyer) return <p className="banner">{sameAddress(account, view.draft.arbiter) ? "Bạn là Arbiter của đơn. Khi có tranh chấp, hãy kiểm tra điều khoản và bằng chứng trước khi phân xử." : "Kết nối đúng ví liên kết của tài khoản để xem quy trình giao dịch của bạn."}</p>;
  const state = view.chain?.state;
  const hasProduct = view.files.some(file => file.kind === "product");
  const steps = seller
    ? ["Chờ ký quỹ", "Tải ZIP", "Bàn giao", "Nghiệm thu", "Hoàn tất"]
    : ["Tạo đơn", "Ký quỹ", "Bàn giao", "Nghiệm thu", "Hoàn tất"];
  const current = state && ["Disputed", "Resolved", "Refunded"].includes(state) ? -1 : state === "Completed" ? 4 : state === "Delivered" ? 3
    : state === "Funded" ? seller ? hasProduct ? 2 : 1 : 2 : seller ? 0 : state === "Created" ? 1 : 0;
  const message = state === "Disputed" ? "Đơn đang tranh chấp. Các bên bổ sung bằng chứng và chờ Arbiter phân xử."
    : state === "Resolved" ? "Tranh chấp đã được phân xử. Xem kết quả thanh toán bên dưới."
    : state === "Refunded" ? "Đơn đã hoàn tiền cho Buyer."
    : state === "Completed" ? "Đơn đã hoàn thành và thanh toán."
    : state === "Funded" && chainTime > view.draft.deliveryDeadline ? "Đã quá hạn giao. Seller không thể bàn giao; Buyer có thể yêu cầu hoàn tiền."
    : state === "Created" && chainTime > view.draft.deliveryDeadline ? "Đơn chưa được ký quỹ trước hạn giao và không thể nạp ETH tiếp. Buyer cần tạo bản nháp mới với hạn giao phù hợp."
    : seller ? state === "Delivered" ? "Bạn đã bàn giao trên blockchain. Chờ Buyer tải ZIP, kiểm tra và xác nhận nghiệm thu."
      : state === "Funded" ? hasProduct ? "ZIP đã được lưu. Tích xác nhận bên dưới rồi bấm “Xác nhận đã gửi code” và xác nhận giao dịch trong MetaMask."
        : "Buyer đã ký quỹ. Tải ZIP mã nguồn lên hệ thống trước khi xác nhận bàn giao."
      : "Chờ Buyer tạo đơn trên blockchain và nạp ETH ký quỹ. Bạn chưa thể bàn giao ở bước này."
    : state === "Delivered" ? "Seller đã bàn giao. Tải ZIP, kiểm tra theo điều khoản rồi xác nhận nghiệm thu hoặc mở tranh chấp trong hạn."
      : state === "Funded" ? "ETH đã được ký quỹ. Chờ Seller tải ZIP và xác nhận bàn giao trên blockchain."
      : state === "Created" ? "Đơn đã tạo trên blockchain. Nạp ETH để Seller có thể bắt đầu bàn giao."
      : "Tạo đơn trên blockchain, sau đó nạp ETH ký quỹ để bắt đầu giao dịch.";
  return <section className="order-workflow" aria-label={`Quy trình ${seller ? "Seller" : "Buyer"}`}>
    <p className="page-eyebrow">{seller ? "BẠN LÀ NGƯỜI BÁN" : "BẠN LÀ NGƯỜI MUA"}</p>
    <ol>{steps.map((step, index) => <li key={step} className={index < current ? "done" : index === current ? "current" : ""} aria-current={index === current ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
    <details><summary>Hướng dẫn bước hiện tại</summary><p>{message}</p></details>
  </section>;
}
