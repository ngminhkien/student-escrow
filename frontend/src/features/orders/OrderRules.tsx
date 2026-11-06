export default function OrderRules() {
  return <details className="trade-rules"><summary>Quy tắc giao dịch</summary><ol>
    <li>Buyer chọn Arbiter trong danh sách của nền tảng và tạo đơn. Seller đọc điều khoản rồi chấp nhận; sau đó Buyer mới ký quỹ được. Trước khi ký quỹ, một trong hai bên có thể hủy đơn. Buyer và Seller cần được Admin xác minh trên contract hiện tại.</li>
    <li>Seller tải ZIP trước hạn giao, sau đó xác nhận bàn giao. ZIP chỉ được tải lên một lần, tối đa 50 MB. Buyer tải được ZIP sau khi Seller đã xác nhận bàn giao.</li>
    <li>Buyer kiểm tra sản phẩm theo tiêu chí nghiệm thu trước khi xác nhận thanh toán. Chỉ mở tranh chấp sau khi Seller xác nhận bàn giao trên chain và còn trong hạn phản hồi; tải ZIP lên chưa được tính là bàn giao.</li>
    <li>Quá hạn giao mà chưa bàn giao: Buyer có thể hoàn tiền. Hết hạn phản hồi: Seller có thể nhận tiền nếu không có tranh chấp.</li>
    <li>Arbiter phân xử khi có tranh chấp. Arbiter mặc định là Admin của nền tảng, cũng là ví nhận phí 1% trên phần Seller được nhận. Arbiter bị gỡ khỏi danh sách thì không phân xử được nữa. Quá 30 ngày không phân xử, một trong hai bên có thể yêu cầu chia đôi số tiền. Bằng chứng hỗ trợ PNG/JPG/JPEG/PDF, tối đa 5 MB/file và 5 file/đơn. Tổng dung lượng đơn tối đa 75 MB.</li>
    <li>Phí nền tảng là 1% phần tiền Seller được hưởng; tỷ giá hiển thị cố định 1 ETH = 100.000.000 ₫.</li>
    <li>Trò chuyện trong đơn được lưu lại, không sửa hoặc xóa được. Arbiter chỉ đọc được khi đơn có tranh chấp.</li>
  </ol></details>;
}
