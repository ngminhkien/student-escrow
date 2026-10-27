# StudentEscrow Frontend — React + TypeScript + MetaMask

Giao diện ứng dụng với trang đăng nhập riêng, sidebar theo tài khoản, thẻ ví/số dư/gas và bố cục thích ứng điện thoại. React + TypeScript + Vite + ethers; không có UI framework. API và smart contract vẫn quyết định quyền/trạng thái. File ABI được import trực tiếp từ `blockchain/deployment/Escrow.abi.json`, không duy trì một bản ABI riêng.

## Đăng nhập, ví và giao diện theo tài khoản

- `viego.hvnh@gmail.com` mở trang **Quản trị**, không có mục Đơn hàng. Các tài khoản khác mở **Đơn hàng**, không có mục Quản trị. Cả hai đều có Tài khoản & ví. Email được cấu hình trong `src/domain/access.ts`; đây là lựa chọn giao diện, không tự cấp quyền contract.
- Sau đăng nhập hoặc khôi phục phiên, ứng dụng đọc ví đã liên kết từ API, tự yêu cầu kết nối MetaMask và chuyển về mạng local. Nếu sai ví, MetaMask mở hộp chọn tài khoản; người dùng phải chọn đúng địa chỉ được hiển thị. Website không thể âm thầm đổi ví hoặc thêm private key. Yêu cầu bị từ chối không được tự lặp; bấm **Đồng bộ ví** để thử lại.
- Tài khoản chưa liên kết ví cần vào Tài khoản & ví, chọn ví và **Ký và liên kết ví** một lần. Không tự liên kết một địa chỉ đang chọn mà chưa có chữ ký xác nhận.
- Thẻ ví đọc số dư ETH và giá gas mỗi 15 giây khi blockchain sẵn sàng. Giá gas (Gwei) không phải tổng phí giao dịch. Trước từng giao dịch, ứng dụng ước tính gas với dự phòng 20% và kiểm tra số dư đủ cho giá trị giao dịch cộng gas theo phí mạng hiện tại. MetaMask hiển thị phí cuối cùng trước khi người dùng xác nhận.
- Ví của tài khoản quản trị vẫn cần `KYC_ADMIN_ROLE` / `DEFAULT_ADMIN_ROLE` trên deployment hiện tại; hardcode email không cấp các quyền này. Luồng tự kết nối không gửi giao dịch hoặc ký thay người dùng.

## Chạy cả phần 4 và 5

Dùng Node 22.13+ trong dòng 22 hoặc Node 24.x (theo `engines` trong `package.json`), SQL Server và .NET theo README gốc. Các lệnh sau chạy từ gốc `student-escrow` trừ khi đã `cd`.

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

Mở **http://127.0.0.1:5173**, đăng nhập và xác nhận kết nối trong MetaMask. Sidebar hiển thị trạng thái blockchain; mục Chi tiết kết nối có thông tin contract/block. Vite proxy `/api` tới API 5180 và `/rpc` tới node 8545, nên không cần bật CORS rộng ở backend. `npm.cmd run build` build bản tĩnh; `npm.cmd run preview` xem build trên cùng cổng với proxy local (dừng dev trước). Đây là môi trường local, chưa cấu hình hosting production.

## Chuẩn bị MetaMask và vai trò

1. Cài/mở khóa MetaMask trong trình duyệt, truy cập frontend và đăng nhập. Ứng dụng tự kiểm tra ví và mở yêu cầu kết nối khi cần.
2. Xác nhận yêu cầu chuyển mạng local; nếu cần khai báo thủ công: RPC `http://127.0.0.1:8545`, chain ID **31337**, ký hiệu **ETH**.
3. Import các private key **thử nghiệm** do terminal Hardhat in ra vào MetaMask. Chỉ nhập ở giao diện MetaMask, không nhập vào frontend/Swagger. Các key Hardhat là key công khai, chỉ dùng local.
4. Gợi ý phân vai theo tài khoản node: **#0 Admin, #1 Buyer, #2 Seller, #3 Arbiter, #4 Platform**. Admin được cấp quyền bởi script deploy; không thể chọn vai trò Admin bằng cách đăng ký tài khoản trên web.
5. Đăng ký ba tài khoản ứng dụng riêng cho Buyer, Seller, Arbiter. Mỗi tài khoản vào **Tài khoản & ví**, chọn đúng ví trong MetaMask và bấm **Ký và liên kết ví**. Mỗi tài khoản/ví chỉ liên kết một lần. Có thể thử KYC PASS/FAIL ở đây; KYC mock không tự xác minh on-chain.

Có thể dùng một trình duyệt và lần lượt đăng xuất/đăng nhập + đổi ví. Hoặc dùng nhiều profile/tab: phiên JWT lưu trong sessionStorage theo tab; chọn ví MetaMask có thể tác động các tab nên luôn xem cảnh báo đúng/sai ví trước khi ký. Ví đã liên kết trong SQL từ lần test trước thì tiếp tục dùng tài khoản đó; reset node không xóa liên kết SQL.

**Admin xác minh Buyer/Seller:** đăng nhập `viego.hvnh@gmail.com`, xác nhận đúng ví đã liên kết, vào mục **Quản trị**, nhập từng địa chỉ ví, bấm **Tra cứu**, kiểm tra kết quả rồi bấm **Xác minh ví** và xác nhận MetaMask. Ví liên kết phải được cấp quyền contract bởi Admin hiện tại (mặc định ví #0 khi deploy). Khi đổi địa chỉ, cần tra cứu lại trước khi xác minh, thu hồi hoặc phân quyền. Có thể tra cứu/thu hồi xác minh, cấp/thu hồi KYC_ADMIN_ROLE bằng ví có DEFAULT_ADMIN_ROLE. Quyền đọc trực tiếp từ contract và được contract kiểm tra lại khi giao dịch thực thi. Không có hàng đợi phê duyệt giấy tờ thật hoặc đồng bộ tự động KYC mock.

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
npm.cmd run test:ui
npm.cmd run test:e2e
```

`test:ui` dùng API/RPC mô phỏng, không cần SQL/Hardhat và không tạo tài khoản trong database. Bao gồm giao diện admin/user trên desktop/mobile, tự chuẩn bị ví, từ chối/thử lại, số dư/gas, kiểm tra thiếu ETH và các trường hợp đổi phiên khi đang ký.

`test:e2e` chạy thêm kịch bản tích hợp thật, yêu cầu API + worker, node local đã deploy và health Ready. Test tự mở Vite cổng 5174, Chrome headless có trên máy; có thể dùng Edge với `$env:PLAYWRIGHT_CHANNEL='msedge'`. Nó tạo tài khoản/ví demo Buyer/Seller/Arbiter, giữ dữ liệu SQL, và phát giao dịch thật trên Hardhat qua signer ở tiến trình Node. Phiên hiển thị admin là fixture mô phỏng trong trình duyệt, dùng signer #0 với quyền contract thật; không đăng nhập hay sửa tài khoản Gmail thật. EIP-1193 được inject để mô phỏng popup/đổi ví/mạng/từ chối ký. **Test này không tự điều khiển extension MetaMask thật**; cần test tay popup theo luồng ở trên.

Để test riêng phần 4, dùng [hướng dẫn backend](../backend/ORDERS.md), `scripts/test-orders-sql.ps1` và lệnh `npm.cmd run smoke:api` trong thư mục `blockchain`. Không chạy smoke reorg/time-travel cùng lúc đang demo UI trên cùng node.

## Cấu trúc và hướng phụ thuộc

```text
src/
  app/                    App, AppShell, quản lý phiên và readiness
  features/
    auth/                 Đăng nhập/đăng ký
    account/              Hồ sơ, liên kết ví, KYC mock
    orders/               Danh sách, draft, chi tiết, thao tác, file, sự kiện
    admin/                Quyền và xác minh ví trực tiếp trên contract
    transactions/         Nhật ký giao dịch của ví hiện tại
  services/               auth, account, orders, health: endpoint và DTO
  infrastructure/
    http/                 Transport dùng chung, lỗi API, timeout/cancellation
    wallet/               Khám phá provider, chọn ví, RPC, ký giao dịch
  domain/                 Kiểu dữ liệu, số học wei/bps, quyền và deadline
  shared/                 Định dạng, feedback và các UI component nhỏ
  main.tsx                Điểm khởi động React
  styles.css              Design tokens, layout và responsive
```

`app` ghép các tính năng; `features` dùng `services`, `domain`, ví và `shared`; `services` dùng HTTP transport và kiểu domain. `domain` và `shared` độc lập với màn hình. Các file gốc `api.ts`, `types.ts`, `rules.ts`, `wallet.ts` và các panel cũ giữ vai trò adapter tương thích; khi thêm chức năng, đặt code vào module tương ứng.

API dùng đường dẫn cùng origin `/api`; chỉ một transport xử lý Bearer token, lỗi HTTP, JSON lỗi/rỗng, response nhị phân, timeout và hủy request. `ApiError` giữ `status`, `code`, `message`, `traceId` khi backend cung cấp. Upload để trình duyệt tự tạo multipart boundary. Không tự retry thao tác ghi. Timeout mặc định 60 giây; caller có thể hủy request mà vẫn giữ timeout. Health blockchain đọc được payload 503 để hiển thị trạng thái thực tế.

JWT lưu trong `sessionStorage` theo tab, có thời hạn và được xóa khi đăng xuất/hết hạn. HTTP 401 của token cũ không đăng xuất phiên mới. Đăng nhập ứng dụng và chọn ví là hai bước độc lập. Contract và API kiểm tra quyền; điều kiện khóa nút trên frontend chỉ hỗ trợ người dùng. Số tiền dùng chuỗi wei/`bigint`; SHA-256 điều khoản tính trên nguyên chuỗi canonical do API trả về. Transaction receipt xác nhận giao dịch; trạng thái đơn vẫn chờ API/worker cập nhật.

Danh sách đơn phân trang thật theo offset, tối đa 50 đơn/trang; bộ lọc/tìm kiếm chỉ áp dụng trên trang đã tải. Lịch sử lấy tối đa 100 sự kiện/trang. Có thể mở đơn qua `?order=UUID`; API vẫn kiểm tra quyền truy cập. Các màn hình giữ dữ liệu đọc được khi blockchain chưa sẵn sàng và khóa thao tác cần ghi.

## Cấu hình proxy local

Mặc định không cần tạo file môi trường. Nếu đổi cổng backend/RPC, từ `frontend`:

```powershell
Copy-Item .env.example .env.local
```

Sửa hai giá trị rồi khởi động lại Vite:

```dotenv
API_PROXY_TARGET=http://localhost:5180
RPC_PROXY_TARGET=http://127.0.0.1:8545
```

Đây là đích proxy cho Vite dev/preview, không phải bí mật và không có tiền tố `VITE_`. `/api` giữ nguyên prefix; `/rpc` bỏ prefix khi chuyển tới JSON-RPC. Không đặt private key, seed phrase, JWT signing key hoặc mật khẩu SQL trong frontend. Bản build tĩnh không mang theo Vite proxy: hosting phải tự cấu hình route cùng origin `/api` và `/rpc`, HTTPS và chính sách truy cập thích hợp. `preview` chỉ dùng xem bản build local.

## Phạm vi kiểm chứng

Build/unit test không cần SQL hoặc node blockchain đang chạy. Test browser hoàn chỉnh cần API, SQL, worker, Hardhat và manifest deployment local; các lệnh test ở trên không khởi tạo thay các dịch vụ đó. Không có trạng thái Ready thì không thể kết luận luồng ký quỹ đã được kiểm chứng. Kiểm tra MetaMask extension thật vẫn thực hiện thủ công theo hướng dẫn vai trò và kịch bản ở trên. Đây là demo ETH local với KYC fixture; chưa có KYC thật, Sepolia, analytics/AI hoặc cấu hình production.
