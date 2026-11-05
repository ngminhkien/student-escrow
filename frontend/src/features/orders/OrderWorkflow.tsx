import { sameAddress } from "../../domain/rules";
import type { OrderView } from "../../domain/types";

export default function OrderWorkflow({ view, account, chainTime }: { view: OrderView; account: string; chainTime: number }) {
  const seller = sameAddress(account, view.draft.seller);
  const buyer = sameAddress(account, view.draft.buyer);
  if (!seller && !buyer) return <p className="banner">{sameAddress(account, view.draft.arbiter) ? "Bạn là Arbiter của đơn. Khi có tranh chấp, hãy kiểm tra điều khoản và bằng chứng trước khi phân xử." : "Kết nối đúng ví liên kết của tài khoản để xem quy trình giao dịch của bạn."}</p>;
  const state = view.chain?.state;
  const hasProduct = view.files.some(file => file.kind === "product");
  const steps = seller
    ? ["Chấp nhận", "Chờ ký quỹ", "Tải ZIP", "Bàn giao", "Nghiệm thu", "Hoàn tất"]
    : ["Tạo đơn", "Seller chấp nhận", "Ký quỹ", "Bàn giao", "Nghiệm thu", "Hoàn tất"];
  const current = state && ["Disputed", "Resolved", "Refunded", "Cancelled"].includes(state) ? -1 : state === "Completed" ? 5 : state === "Delivered" ? 4
    : state === "Funded" ? seller ? hasProduct ? 3 : 2 : 3 : state === "Accepted" ? seller ? 1 : 2 : state === "Created" ? seller ? 0 : 1 : 0;
  const message = state === "Disputed" ? "Đơn đang tranh chấp. Các bên bổ sung bằng chứng và chờ Arbiter phân xử."
    : state === "Resolved" ? "Tranh chấp đã được phân xử. Xem kết quả thanh toán bên dưới."
    : state === "Refunded" ? "Đơn đã hoàn tiền cho Buyer."
    : state === "Cancelled" ? "Đơn đã hủy trước khi ký quỹ. Không có khoản tiền nào bị khóa."
    : state === "Completed" ? "Đơn đã hoàn thành và thanh toán."
    : state === "Funded" && chainTime > view.draft.deliveryDeadline ? "Đã quá hạn giao. Seller không thể bàn giao; Buyer có thể yêu cầu hoàn tiền."
    : (state === "Created" || state === "Accepted") && chainTime > view.draft.deliveryDeadline ? "Đơn chưa được ký quỹ trước hạn giao và không thể ký quỹ tiếp. Buyer cần tạo bản nháp mới với hạn giao phù hợp."
    : seller ? state === "Delivered" ? "Bạn đã bàn giao trên blockchain. Chờ Buyer tải ZIP, kiểm tra và xác nhận nghiệm thu."
      : state === "Funded" ? hasProduct ? "ZIP đã được lưu. Tích xác nhận bên dưới rồi bấm “Xác nhận đã gửi code”."
        : "Buyer đã ký quỹ. Tải ZIP mã nguồn lên hệ thống trước khi xác nhận bàn giao."
      : state === "Accepted" ? "Bạn đã chấp nhận điều khoản. Chờ Buyer ký quỹ trước khi làm tiếp."
      : state === "Created" ? "Buyer đã tạo đơn. Đọc kỹ điều khoản bên dưới rồi chấp nhận hoặc từ chối đơn."
      : "Chờ Buyer tạo đơn trên blockchain. Sau đó bạn sẽ xem và chấp nhận điều khoản."
    : state === "Delivered" ? "Seller đã bàn giao. Tải ZIP, kiểm tra theo điều khoản rồi xác nhận nghiệm thu hoặc mở tranh chấp trong hạn."
      : state === "Funded" ? "Tiền đã được ký quỹ. Chờ Seller tải ZIP và xác nhận bàn giao trên blockchain."
      : state === "Accepted" ? "Seller đã chấp nhận điều khoản. Ký quỹ để Seller bắt đầu thực hiện."
      : state === "Created" ? "Đơn đã tạo trên blockchain. Chờ Seller đọc và chấp nhận điều khoản; bạn chưa cần ký quỹ."
      : "Tạo đơn trên blockchain để gửi điều khoản cho Seller.";
  return <section className="order-workflow" aria-label={`Quy trình ${seller ? "Seller" : "Buyer"}`}>
    <p className="page-eyebrow">{seller ? "BẠN LÀ NGƯỜI BÁN" : "BẠN LÀ NGƯỜI MUA"}</p>
    <ol>{steps.map((step, index) => <li key={step} className={index < current ? "done" : index === current ? "current" : ""} aria-current={index === current ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
    <details><summary>Hướng dẫn bước hiện tại</summary><p>{message}</p></details>
  </section>;
}
