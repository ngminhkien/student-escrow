# Phần 04 — Đơn hàng, file và đồng bộ blockchain local

API giữ bản nháp và file; contract quyết định tiền/trạng thái. Worker Nethereum chỉ đọc RPC, không có private key, không ký hộ người dùng. Tạo draft không gửi giao dịch và không xác minh KYC on-chain. Buyer/Seller phải được Admin xác minh trong contract trước khi tạo/nạp đơn; KYC mock trong SQL vẫn độc lập.

## Chạy và kiểm thử trên PowerShell

SQL Server và Node theo README phải sẵn sàng. Từ gốc `student-escrow`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 build StudentEscrow.slnx --no-restore
cd blockchain
npm.cmd ci
npm.cmd run build
npm.cmd run node
```

Giữ node chạy. Terminal thứ hai, từ gốc repo:

```powershell
cd blockchain
npm.cmd run deploy:local
```

Terminal thứ ba, từ gốc repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild -Blockchain
```

Development áp dụng migration `EscrowOrdersAndSync` vào `StudentEscrowDb`, thêm bảng và giữ dữ liệu cũ. Worker mặc định tắt để phần auth/KYC vẫn chạy độc lập; `-Blockchain` bật worker cho tiến trình API. `http://localhost:5180/swagger` có nhóm Orders.

Tại terminal thứ hai đang ở `blockchain`:

```powershell
Invoke-RestMethod http://localhost:5180/api/health/ready
Invoke-RestMethod http://localhost:5180/api/health/blockchain
npm.cmd run typecheck
npm.cmd run smoke:api
```

Cả hai health cần HTTP 200; blockchain báo `Ready`. Nếu `Syncing`, chờ vài giây. Smoke yêu cầu `Confirmations=0`, tạo bốn tài khoản/ví demo ngẫu nhiên, cấp ETH từ tài khoản Hardhat và Admin xác minh Buyer/Seller. Không nhập private key. Script lưu tài khoản, draft, file và event trong SQL; không reset database. Private key ví ngẫu nhiên chỉ tồn tại trong bộ nhớ và không được ghi vào báo cáo.

Smoke PASS kiểm tra: SHA-256 điều khoản và ZIP thật; xác thực JWT/quyền Buyer/Seller/Arbiter; file giả/rỗng/quá lớn; không ghi đè ZIP; hai upload đồng thời tranh suất bằng chứng thứ năm; Completed; snapshot/revert về Funded rồi Refunded; Disputed → Resolved 70/30; phát hiện điều khoản on-chain không khớp bản nháp. Không chạy cùng một phiên demo khác: script thay đổi thời gian và revert snapshot của node local.

Kiểm tra restart: giữ nguyên node Hardhat, dừng API bằng Ctrl+C rồi chạy lại đúng lệnh `start-backend.ps1 -NoBuild -Blockchain`. Sau khi blockchain health trả Ready:

```powershell
npm.cmd run verify:api
```

Script login lại (JWT development thay đổi khi restart), kiểm tra file/hash, trạng thái Refunded/Resolved và lịch sử không bị nhân đôi. Nó đọc `deployment/local/api-smoke-latest.json` do smoke tạo; file này chỉ chứa ID/email demo/hash, không có token/private key.

Bộ .NET không cần SQL:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 test StudentEscrow.slnx --no-restore
```

Ba test SQL được đánh dấu **SKIP** nếu chưa cung cấp connection string. Để chạy cả chúng sau khi migration đã áp dụng:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-orders-sql.ps1
# Máy khác: thêm -ConnectionString '<SQL connection string của bạn>'
```

Test SQL thêm các deployment giả lập RPC riêng bằng UUID vào SQL thật, kiểm tra commit/rollback, restart qua DbContext mới, dedup, reorg/chain ngắn hơn, RPC thất bại, sai deployment và confirmation depth. Không xóa DB, không dùng InMemory thay SQL. Trên máy phát triển hiện tại, Windows authentication trong sandbox có thể lỗi SSPI; chạy từ PowerShell bình thường.

## API và thao tác thủ công

Đăng nhập và liên kết ví bằng chữ ký như README phần 02. Các bên có thể liên kết ví trước hoặc sau khi draft được tạo; địa chỉ và chain phải khớp. Địa chỉ Seller/Arbiter cố định sau khi tạo draft.

| Endpoint | Hành vi |
|---|---|
| `POST /api/orders` | Buyer có ví liên kết tạo draft bất biến; trả 201, không gửi transaction |
| `GET /api/orders?skip=0` | Tối đa 50 draft của ví đang đăng nhập, gồm lịch sử deployment cũ |
| `GET /api/orders/{id}` | Draft, projection, sync status, `termsMatch`, file metadata, `deliveryFileMatchesChain` |
| `GET /api/orders/{id}/events?skip=0` | Tối đa 100 event theo block/log index; không bao gồm event bị reorg |
| `POST /api/orders/{id}/files` | Multipart `kind=product\|evidence` và `file` |
| `GET /api/orders/{id}/files/{fileId}` | Download attachment qua quyền theo đơn; không có URL public |
| `GET /api/health/blockchain` | Deployment hiện tại, contract, checkpoint, confirmation depth và trạng thái |

Ví dụ tạo draft; thay địa chỉ và Unix deadline bằng giá trị thực, deadline phải ở tương lai cả so với API và chain:

```json
{
  "seller": "0x2222222222222222222222222222222222222222",
  "arbiter": "0x3333333333333333333333333333333333333333",
  "description": "Thiết kế landing page giới thiệu dịch vụ",
  "acceptanceCriteria": "Hiển thị đúng ở 375 px và 1440 px; có mục liên hệ",
  "amountWei": "10000000000000000",
  "deliveryDeadline": 1800000000,
  "reviewWindow": 300
}
```

Buyer ký `createOrder` với **đúng** Seller, Arbiter, amountWei, clientReference, termsHash, deliveryDeadline, reviewWindow trả từ draft; sau đó ký `deposit`. Poll GET tới `chain.state=Funded`, `termsMatch=true`. Seller upload ZIP, ký `markDelivered(orderId, file.sha256)`. Buyer tải file, kiểm tra byte/hash và nghiệm thu rồi ký `confirmReceipt`, hoặc một bên ký `raiseDispute`; Arbiter ký `resolveDispute` nếu có tranh chấp. [Frontend phần 05](../frontend/README.md) đã có nút MetaMask cho các thao tác này.

`termsJson` là chuỗi JSON chính xác do server tạo (version 1, thứ tự field cố định); `termsHash` là SHA-256 của UTF-8 **chuỗi đó**, không hash JSON reserialize ở client. Hash bao gồm deployment/chain/contract, reference, các bên, nội dung, tiêu chí, wei, deadline/review window và phí 100 bps. AmountWei trả dạng chuỗi để không mất độ chính xác JavaScript/SQL.

Không dùng `clientReference` hoặc transaction hash làm bằng chứng thanh toán. Worker tự lọc log theo contract/block, giải mã và đối chiếu tất cả điều khoản với draft. Sai bất kỳ field nào: `termsMatch=false` và upload bị chặn. Không có API nhận trạng thái tiền từ client. Người không thuộc đơn nhận 404; chưa có ví liên kết nhận 409.

## File và giới hạn

- Một ZIP sản phẩm <=50.000.000 byte, không rỗng; chỉ Seller upload ở Funded với điều khoản khớp. Bản này không có thay thế/xóa file, kể cả trước Delivered; chọn ZIP cuối cùng trước khi upload.
- Tối đa 5 bằng chứng PNG/JPG/JPEG/PDF <=5.000.000 byte/file cho cả Buyer và Seller cộng lại; upload ở Funded/Delivered/Disputed. Arbiter chỉ đọc. Tổng <=75.000.000 byte/đơn.
- Kiểm tra extension kèm cấu trúc: directory ZIP, chunk PNG, marker JPEG, header/trailer PDF; không chỉ tin Content-Type. Đây không phải antivirus, kiểm chứng toàn bộ cấu trúc tài liệu hay đánh giá chất lượng. Không giải nén/render/chạy nội dung trên server.
- SQL `varbinary(max)` giữ byte file ngoài blockchain và ngoài thư mục public; API luôn trả attachment/octet-stream, `nosniff`, `no-store`. SHA-256 tính trên chính byte được lưu. Không ghi tệp tạm lâu dài hoặc bản cũ ngoài quota. Giới hạn multipart 51 MB gồm overhead; nội dung được đếm riêng khi đọc. Cần trần tương ứng nếu thêm reverse proxy ở giai đoạn sau.
- Upload dùng SQL transaction và `sp_getapplock` theo draft; mọi replica dùng cùng SQL chia sẻ quota lock. Unique filtered index bảo vệ một ZIP sản phẩm. Không có endpoint ghi đè/xóa file đã bàn giao.
- Sau reorg, file off-chain vẫn giữ nguyên; `deliveryFileMatchesChain` được tính lại theo hash trong projection. Upload/hash khớp không đồng nghĩa Buyer đã nghiệm thu. Trạng thái upload chỉ là ảnh chụp SQL đã đồng bộ; chain có thể tiến thêm trong lúc upload, và contract vẫn kiểm tra trạng thái khi Seller ký.

## Đồng bộ, phục hồi và cấu hình

Trong `appsettings.Local.json` hoặc environment (`Blockchain__Enabled`, ...):

```json
{
  "Blockchain": {
    "Enabled": true,
    "RpcUrl": "http://127.0.0.1:8545",
    "ManifestPath": "../../blockchain/deployment/local/latest.json",
    "Confirmations": 0,
    "PollSeconds": 2,
    "BatchSize": 50
  }
}
```

ManifestPath tương đối với content root của API. Phần 04 chỉ cho Development, RPC loopback và chain 31337. Worker đọc lại manifest mỗi lượt; deploy mới có UUID mới, giữ tách biệt mọi draft/event/projection với deployment cũ dù order ID trùng. Node reset nhưng chưa deploy lại: `InvalidDeployment`, chặn tạo draft/upload; chạy lại `deploy:local`. Đơn deployment cũ được đọc với `Archived` và không nhận upload mới.

Trước đồng bộ, worker kiểm tra chain ID, deployment block hash, receipt tạo contract thành công, địa chỉ contract và code tồn tại. Các block/event/projection/checkpoint commit trong cùng SQL transaction, có lock theo deployment. Event có khóa `(deploymentId, transactionHash, logIndex)`; restart tiếp tục từ checkpoint đã commit. Log sai block/contract hoặc batch lỗi thì rollback, không tiến checkpoint.

Mỗi lượt so hash block checkpoint với RPC. Nếu lệch, tìm common ancestor, xóa block/event orphan, dựng lại projection từ journal còn hợp lệ rồi đọc nhánh mới. Giữ toàn bộ journal/block cho demo local nên phục hồi reorg sâu được nhưng tốn tài nguyên theo lịch sử; chưa tối ưu cho chain lớn. RPC lỗi: `Unavailable`; worker ngừng cập nhật quá 30 giây: `Stale`. File/đơn cũ vẫn đọc được kèm sync status, nhưng tạo draft/upload yêu cầu deployment hiện tại `Ready`. `Ready` là đã bắt kịp head trừ Confirmations tại lượt kiểm tra gần nhất, không phải cam kết finality.

Tài liệu Nethereum cho transport được sử dụng: [JSON-RPC Transport](https://docs.nethereum.com/docs/json-rpc-transport/overview/). Giao diện, đồng bộ KYC API → Admin transaction, Sepolia và cơ chế vận hành production nằm ngoài phần 04.
