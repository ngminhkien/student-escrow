# Phần 05 — React + MetaMask, giao diện demo tối giản

Giao diện trắng/đen, tập trung thao tác đủ phần 01–05. React + TypeScript + Vite + ethers; không có UI framework, không thêm ảnh hoặc animation. API và smart contract vẫn quyết định quyền/trạng thái. File ABI được import trực tiếp từ `blockchain/deployment/Escrow.abi.json`, không duy trì một bản ABI riêng.

## Chạy cả phần 4 và 5

Dùng Node 22.13+ trong dòng 22 (máy phát triển: 22.14.0), SQL Server và .NET theo README gốc. Các lệnh sau chạy từ gốc `student-escrow` trừ khi đã `cd`.

**Chuẩn bị một lần hoặc sau khi cập nhật dependencies:**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 build StudentEscrow.slnx --no-restore
cd blockchain
npm.cmd ci
npm.cmd run build
cd ../frontend
npm.cmd ci
```

**Terminal 1 — blockchain local**, từ gốc repo:

```powershell
cd blockchain
npm.cmd run node
```

Giữ terminal mở. Node in sẵn 20 tài khoản/ví local có ETH test.

**Terminal 2 — deploy rồi chạy API**, từ gốc repo:

```powershell
cd blockchain
npm.cmd run deploy:local
cd ..
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild -Blockchain
```

API sẽ áp dụng migration phần 4, giữ dữ liệu SQL cũ. Nếu Rider đang chạy API cổng 5180 thì dừng trước. Không cần khởi động một API riêng cho frontend.

**Terminal 3 — frontend**, từ gốc repo:

```powershell
cd frontend
npm.cmd run dev
```

Mở **http://127.0.0.1:5173**. Header phải hiển thị `Blockchain: Ready`. Vite proxy `/api` tới API 5180 và `/rpc` tới node 8545, nên không cần bật CORS rộng ở backend. `npm.cmd run build` build bản tĩnh; `npm.cmd run preview` xem build trên cùng cổng với proxy local (dừng dev trước). Đây là môi trường local, chưa cấu hình hosting production.

## Chuẩn bị MetaMask và vai trò

1. Cài/mở khóa MetaMask trong trình duyệt, truy cập frontend rồi bấm **Kết nối MetaMask**.
2. Bấm **Chuyển sang mạng local**; nếu cần khai báo thủ công: RPC `http://127.0.0.1:8545`, chain ID **31337**, ký hiệu **ETH**.
3. Import các private key **thử nghiệm** do terminal Hardhat in ra vào MetaMask. Chỉ nhập ở giao diện MetaMask, không nhập vào frontend/Swagger. Các key Hardhat là key công khai, chỉ dùng local.
4. Gợi ý phân vai theo tài khoản node: **#0 Admin, #1 Buyer, #2 Seller, #3 Arbiter, #4 Platform**. Admin được cấp quyền bởi script deploy; không thể chọn vai trò Admin bằng cách đăng ký tài khoản trên web.
5. Đăng ký ba tài khoản ứng dụng riêng cho Buyer, Seller, Arbiter. Mỗi tài khoản vào **Tài khoản & ví**, chọn đúng ví trong MetaMask và bấm **Ký và liên kết ví**. Mỗi tài khoản/ví chỉ liên kết một lần. Có thể thử KYC PASS/FAIL ở đây; KYC mock không tự xác minh on-chain.

Có thể dùng một trình duyệt và lần lượt đăng xuất/đăng nhập + đổi ví. Hoặc dùng nhiều profile/tab: phiên JWT lưu trong sessionStorage theo tab; chọn ví MetaMask có thể tác động các tab nên luôn xem cảnh báo đúng/sai ví trước khi ký. Ví đã liên kết trong SQL từ lần test trước thì tiếp tục dùng tài khoản đó; reset node không xóa liên kết SQL.

**Admin xác minh Buyer/Seller:** chọn ví #0, vào mục **Admin**, nhập từng địa chỉ ví rồi bấm **Xác minh ví** và xác nhận MetaMask. Admin không cần đăng nhập JWT để dùng quyền contract. Có thể tra cứu/thu hồi xác minh, cấp/thu hồi KYC_ADMIN_ROLE bằng ví có DEFAULT_ADMIN_ROLE. Quyền đọc trực tiếp từ contract và được contract kiểm tra lại khi giao dịch thực thi. Không có hàng đợi phê duyệt giấy tờ thật hoặc đồng bộ tự động KYC mock.

## Một luồng hoàn chỉnh để test chung 4–5

| Bước | Tài khoản / ví | Thao tác và kết quả |
|---|---|---|
| 1 | Admin | Xác minh Buyer và Seller trên deployment hiện tại |
| 2 | Buyer | Đơn hàng → Tạo bản nháp; nhập Seller, Arbiter, điều khoản, ETH, hạn giao và khoảng phản hồi |
| 3 | Buyer | Mở draft → Tạo đơn trên chain → xác nhận MetaMask; chờ `Đã tạo trên chain` |
| 4 | Buyer | Bấm Nạp ETH → xác nhận MetaMask; chờ `Đã ký quỹ` |
| 5 | Seller | Đăng nhập/chọn đúng ví; mở cùng đơn (danh sách hoặc UUID Buyer gửi) |
| 6 | Seller | Chọn Sản phẩm ZIP → Upload file; sau đó Ký bàn giao → xác nhận MetaMask |
| 7 | Buyer | Chờ `Đã bàn giao`; tải ZIP, frontend kiểm tra SHA-256 trước khi tải; xem hash khớp và nghiệm thu nội dung |
| 8 | Buyer | Tích ô đã kiểm tra sản phẩm → Xác nhận nghiệm thu → xác nhận MetaMask |
| 9 | Các bên | Chờ `Hoàn thành`, xem tiền Seller/phí và event Released trong lịch sử |

ZIP thử có thể tạo bằng PowerShell, không cần tool khác:

```powershell
New-Item -ItemType Directory -Force .runtime\demo-product
Set-Content -Encoding utf8 .runtime\demo-product\index.html '<!doctype html><h1>Demo landing page</h1>'
Compress-Archive -Path .runtime\demo-product\index.html -DestinationPath .runtime\demo-product.zip -Force
```

Upload `.runtime/demo-product.zip`. Một ZIP tối đa 50 MB; một bản bất biến, không thay thế/xóa. Bằng chứng PNG/JPG/JPEG/PDF tối đa 5 MB/file, 5 file/đơn cho cả Buyer/Seller cộng lại. Tổng 75 MB. Chỉ người thuộc đơn tải được file, kể cả sau khi kết thúc. File không được render hoặc giải nén trong frontend/server.

## Các nhánh còn lại

- **Tranh chấp:** tạo một đơn khác, nạp tiền. Buyer hoặc Seller bấm **Mở tranh chấp** ở Funded/Delivered trong hạn. Hai bên upload bằng chứng nếu cần. Arbiter đăng nhập/chọn đúng ví, mở đơn, nhập phần Seller 0–100% (tối đa 2 số thập phân), xem phân bổ dự kiến rồi **Phân xử và thanh toán**. Ví dụ 0.01 ETH, 70% Seller → Seller thực nhận 0.00693, Buyer hoàn 0.003, phí 0.00007 ETH.
- **Quá hạn giao:** tạo đơn hạn giao gần, nạp tiền, không bàn giao. Sau hạn, Buyer thấy **Hoàn tiền do quá hạn giao**. Timeout không tự gửi tiền; vẫn phải ký giao dịch.
- **Quá hạn phản hồi:** tạo đơn với khoảng phản hồi 30–60 giây, Seller upload và bàn giao, Buyer không nghiệm thu/tranh chấp. Sau hạn, Seller thấy **Nhận tiền sau hạn phản hồi**. Giao diện đọc thời gian block chờ và cập nhật khoảng 5 giây/lần, kể cả Hardhat không có giao dịch mới.
- **Từ chối ký:** Reject trong MetaMask; UI báo từ chối, trạng thái đơn không tự đổi, nút có thể thử lại.
- **Sai ví/mạng:** đổi tài khoản/mạng trong MetaMask. UI cảnh báo, khóa thao tác; trước mỗi giao dịch kiểm tra lại chain, account, deployment block hash, địa chỉ contract và quyền/trạng thái bằng preflight.
- **Admin thu hồi:** thu hồi xác minh Buyer/Seller chặn tạo/nạp đơn mới; đơn đã Funded vẫn có thể bàn giao/quyết toán.
- **Restart API:** dữ liệu SQL và file giữ nguyên; đăng nhập lại vì JWT development dùng key tạm. Worker tiếp tục checkpoint. **Restart node:** deploy lại, Admin xác minh lại. Đơn deployment cũ hiện Archived và không cho gửi giao dịch/upload mới.

Giao dịch có thể đã xác nhận trên chain nhưng SQL chưa kịp cập nhật. Mục **Giao dịch của ví hiện tại** có hash, trạng thái và nút kiểm tra receipt. UI chỉ đổi trạng thái đơn theo API sau worker, không dựa trên việc bấm nút hoặc client gửi tx hash. Không reset/redeploy node trong lúc MetaMask đang chờ ký.

## Test tự động

Từ `frontend`:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:e2e
```

`test:e2e` yêu cầu API + worker, node local đã deploy và health Ready. Test tự mở Vite cổng 5174, Chrome headless có trên máy; có thể dùng Edge với `$env:PLAYWRIGHT_CHANNEL='msedge'`. Nó tạo tài khoản/ví demo riêng, giữ dữ liệu SQL, và phát giao dịch thật trên Hardhat qua signer ở tiến trình Node. EIP-1193 được inject để mô phỏng popup/đổi ví/mạng/từ chối ký. **Test này không tự điều khiển extension MetaMask thật**; cần test tay popup theo luồng ở trên.

Để test riêng phần 4, dùng [hướng dẫn backend](../backend/ORDERS.md), `scripts/test-orders-sql.ps1` và lệnh `npm.cmd run smoke:api` trong thư mục `blockchain`. Không chạy smoke reorg/time-travel cùng lúc đang demo UI trên cùng node.

## Cấu trúc để chỉnh FE tiếp

`src/App.tsx`: phiên đăng nhập, navigation, kết nối và lịch sử giao dịch. `AccountPanel.tsx`, `OrdersPanel.tsx`, `AdminPanel.tsx`: ba màn hình. `api.ts`: gọi API. `wallet.ts`: adapter MetaMask/RPC/giao dịch. `rules.ts`: quyền và deadline, xử lý wei/bps chính xác. `styles.css`: toàn bộ giao diện trắng–đen; có responsive 375 px. Có thể thay CSS/layout mà không phải sửa logic contract.

Tài liệu chính thức tham khảo: [Vite proxy](https://vite.dev/config/server-options), [ethers v6](https://docs.ethers.org/v6/single-page/), [MetaMask network management](https://docs.metamask.io/metamask-connect/evm/guides/manage-networks/).
