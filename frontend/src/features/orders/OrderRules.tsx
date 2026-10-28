export default function OrderRules() {
  return <details className="trade-rules"><summary>Quy tắc giao dịch</summary><ol>
    <li>Buyer tạo đơn trên chain và nạp đủ ETH ký quỹ. Buyer và Seller cần được Admin xác minh trên contract hiện tại.</li>
    <li>Seller tải ZIP trước hạn giao, sau đó xác nhận bàn giao trong MetaMask. ZIP chỉ được tải lên một lần, tối đa 50 MB.</li>
    <li>Buyer kiểm tra sản phẩm theo tiêu chí nghiệm thu trước khi xác nhận thanh toán. Chỉ mở tranh chấp sau khi Seller xác nhận bàn giao trên chain và còn trong hạn phản hồi; tải ZIP lên chưa được tính là bàn giao.</li>
    <li>Quá hạn giao mà chưa bàn giao: Buyer có thể hoàn tiền. Hết hạn phản hồi: Seller có thể nhận tiền nếu không có tranh chấp.</li>
    <li>Arbiter phân xử khi có tranh chấp. Bằng chứng hỗ trợ PNG/JPG/JPEG/PDF, tối đa 5 MB/file và 5 file/đơn. Tổng dung lượng đơn tối đa 75 MB.</li>
    <li>Phí nền tảng là 1% phần tiền Seller được hưởng; phí gas tính riêng. Bạn xác nhận mọi chữ ký và giao dịch trong MetaMask.</li>
  </ol></details>;
}
