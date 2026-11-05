using System.Text;

namespace StudentEscrow.Application.Orders;

public sealed record StandardTermsDocument(string Version, string Title, string Text)
{
    public string Hash { get; } = OrderRules.Hash(Encoding.UTF8.GetBytes(Text));
}

// The hash of this text is sealed into every order's terms, so published versions must never be edited.
// To change the wording, add a new version here and make it Current; old orders keep resolving to the text they agreed to.
public static class StandardTerms
{
    public static readonly StandardTermsDocument Current = new("2026-11-v1", "Điều khoản giao dịch ký quỹ StudentEscrow",
        """
        1. Phạm vi
        Các điều khoản này áp dụng cho mọi đơn trên StudentEscrow. Cùng với nội dung công việc, tiêu chí nghiệm thu, số tiền, hạn giao và thời gian phản hồi ghi trên đơn, chúng tạo thành thỏa thuận giữa Buyer và Seller. Mã hash của toàn bộ thỏa thuận được ghi lên blockchain nên không thể sửa sau khi tạo đơn; muốn thay đổi, hai bên hủy đơn và tạo đơn mới.

        2. Chấp nhận điều khoản
        Buyer đồng ý khi tích chọn đồng ý và lưu đơn. Seller đồng ý khi tích chọn đồng ý và xác nhận chấp nhận đơn; việc chấp nhận được ghi trên blockchain. Buyer chỉ ký quỹ được sau khi Seller chấp nhận. Trước khi ký quỹ, Buyer hoặc Seller có thể hủy đơn mà không mất phí nền tảng.

        3. Ký quỹ
        Buyer ký quỹ đúng số tiền ghi trên đơn. Tiền được khóa trong hợp đồng thông minh; nền tảng không có quyền rút khoản tiền này. Số tiền hiển thị theo tỷ giá cố định 1 ETH = 100.000.000 ₫, là tỷ giá quy đổi của bản demo, không phải giá thị trường.

        4. Bàn giao
        Seller tải lên một tệp ZIP sản phẩm duy nhất và xác nhận bàn giao trước hạn giao; mã hash của tệp được ghi lên blockchain. Buyer chỉ tải được sản phẩm sau khi Seller xác nhận bàn giao.

        5. Nghiệm thu
        Buyer kiểm tra sản phẩm theo tiêu chí nghiệm thu trong thời gian phản hồi. Khi Buyer xác nhận nghiệm thu, tiền được thanh toán cho Seller. Hết thời gian phản hồi mà Buyer không xác nhận và không có tranh chấp, Seller có quyền nhận toàn bộ số tiền.

        6. Hoàn tiền
        Đã quá hạn giao mà Seller chưa xác nhận bàn giao, số tiền ký quỹ được hoàn đầy đủ cho Buyer và không tính phí nền tảng.

        7. Tranh chấp và phân xử
        Sau khi Seller bàn giao, Buyer hoặc Seller có thể mở tranh chấp trong thời gian phản hồi và cung cấp bằng chứng. Arbiter của đơn được Buyer chọn từ danh sách do nền tảng quản lý và được Seller chấp nhận cùng các điều khoản này. Arbiter quyết định tỷ lệ chia tiền dựa trên thỏa thuận và bằng chứng; quyết định được hợp đồng thông minh thi hành ngay và không thể đảo ngược. Arbiter đã bị gỡ khỏi danh sách không thể phân xử nữa. Quá 30 ngày kể từ khi mở tranh chấp mà chưa có phán quyết, bất kỳ ai cũng có thể yêu cầu chia đôi số tiền.

        8. Phí
        Phí nền tảng là 1% trên phần tiền Seller được nhận; phần hoàn cho Buyer không tính phí. Với ví lưu ký, nền tảng trả phí gas. Với ví tự giữ như MetaMask, người ký tự trả phí gas.

        9. Trách nhiệm của các bên
        Mỗi bên tự chịu trách nhiệm về tính chính xác của thông tin mình cung cấp. Seller bảo đảm có quyền bàn giao sản phẩm. Các bên không tải lên nội dung vi phạm pháp luật, phần mềm độc hại hoặc dữ liệu cá nhân của người khác khi chưa được phép, và chỉ nộp bằng chứng trung thực.

        10. Tính chất thử nghiệm
        StudentEscrow là sản phẩm demo của môn học, chạy trên mạng blockchain thử nghiệm. ETH trên mạng này không có giá trị thực và nền tảng không phải dịch vụ tài chính được cấp phép. Không dùng để giao dịch bằng tiền thật.
        """);

    private static readonly StandardTermsDocument[] Published = [Current];

    public static StandardTermsDocument? Find(string? version) => Published.FirstOrDefault(document => document.Version == version);
}
