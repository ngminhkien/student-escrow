# StudentEscrow – Code trong một repo

`student-escrow` là thư mục gốc của repo code, có `.gitignore` riêng. Thao tác Git và push từ thư mục này, không từ thư mục cha `dvcntc`. Tài liệu ý tưởng/phân công ở thư mục cha không thuộc repo. Thư mục `docs/` bên trong chứa ghi chú kiểm chứng cục bộ và cũng được gitignore; README này giữ lại để hướng dẫn chạy code.

## Phần đang triển khai

**01 – Backend nền tảng đã đạt gate:** .NET 10, bốn lớp, SQL Server, migration, đăng ký/đăng nhập JWT, hồ sơ và Swagger.

**02 – Liên kết ví và KYC mock đã đạt gate (TV2 + TV4):** ví EOA ký challenge một lần, chống replay/hết hạn/chiếm ví; KYC có PASS/REJECTED và API chỉ xem hồ sơ của chính tài khoản. Ngày 04/10/2026, agent chạy backend ngoài sandbox và cả hai smoke script trên SQL thật đều PASS, gồm các request đồng thời và kiểm tra persistence. Trong sandbox vẫn gặp SSPI.

**03 – Blockchain local đã đạt gate (TV1 + TV5):** Solidity/Hardhat, xác minh ví on-chain bằng quyền Admin, đủ vòng đời ký quỹ ETH test, phí 1%, tranh chấp chia tỷ lệ và hai timeout. 71 test PASS; coverage Escrow.sol 100% dòng/câu lệnh. Deploy và bốn luồng smoke trên node local PASS, đối chiếu số dư/gas. ABI, đặc tả và hướng dẫn ở [blockchain/README.md](blockchain/README.md) và [blockchain/DESIGN.md](blockchain/DESIGN.md).

**04 – Draft/file/hash và Nethereum worker đã đạt gate local:** API tạo draft bất biến, lưu file theo quyền/quota, tính SHA-256; worker đọc contract local vào SQL với checkpoint, dedup, restart và phục hồi reorg. Ngày 06/10/2026: 64/64 test .NET PASS gồm SQL thật; smoke API/blockchain, restart và hồi quy auth/ví/KYC PASS. Hướng dẫn chạy, API, cấu hình và giới hạn ở [backend/ORDERS.md](backend/ORDERS.md).

**05 – Frontend React/TypeScript/MetaMask:** không gian làm việc tiếng Việt cho tài khoản/ví/KYC, draft/đơn/file, ký giao dịch, Admin xác minh/phân quyền KYC và Arbiter phân xử. Frontend được tổ chức theo tính năng, tách tầng gọi API, domain và hạ tầng ví. Hướng dẫn [chạy, cấu hình và kiểm tra phần 4–5](frontend/README.md). Ví MetaMask ký phía client; ví lưu ký do server ký (xem mục bên dưới). Kiểm chứng đầy đủ cần API/SQL/worker và Hardhat đã deploy; test mô phỏng EIP-1193 không thay thế thử popup MetaMask thật. Sepolia chưa triển khai.

**06 – Analytics và AI Risk Scoring:** điểm rủi ro 0–100 cho từng đơn bằng Logistic Regression ML.NET đã huấn luyện trên dữ liệu giả lập, có baseline theo luật làm phương án dự phòng; bảng thống kê cho Admin tách riêng dữ liệu chain và giả lập. Điểm rủi ro và bảng thống kê chỉ Admin được xem. Điểm chỉ để cảnh báo, không ảnh hưởng tới tiền hay trạng thái đơn. Trên tập test, mô hình **không tốt hơn** baseline. Quy trình, số liệu và hạn chế ở [analytics/README.md](analytics/README.md).

Ghi chú tiến độ và hướng dẫn Swagger chi tiết nằm trong `docs/` trên máy phát triển, không được push. Các bước chạy và kiểm tra API cần thiết nằm ngay trong README này.

Kết quả phần 01: build sạch, 11 test lúc hoàn thành phần này và HTTP public/Swagger chạy được. Người dùng đã chạy full smoke bằng PowerShell thường với SQL thật, tất cả ca PASS; **phần 01 đạt gate**. Sau phần 02, bộ test .NET có 42 test PASS. SQL ngoài sandbox được agent kiểm chứng lại ngày 04/10/2026; lỗi SSPI vẫn xảy ra trong sandbox. Kết quả chi tiết lưu cục bộ trong `docs/01_VALIDATION.md`, `docs/02_VALIDATION.md` và `docs/03_VALIDATION.md`.

## Ví lưu ký, số dư và tỷ giá VND

**Người dùng chọn khi đăng ký và không đổi được sau đó.** Mặc định là **Hệ thống giữ ví hộ**: server sinh private key, mã hóa rồi lưu vào SQL, và tự ký giao dịch khi người dùng bấm thao tác; số dư nằm trong sổ cái SQL. Lựa chọn còn lại là **Tự giữ ví bằng MetaMask**: người dùng liên kết ví bằng chữ ký, tự xác nhận giao dịch và trả gas; số dư là ETH của ví, không có sổ cái; nạp tiền qua cổng sẽ nhận ETH thẳng vào ví. Hai loại ví giao dịch được với nhau trong cùng một đơn. Admin dùng loại nào cũng quản trị được, vì quyền nằm ở role trên contract của ví đã liên kết. `CustodialWallet__ImportHardhatWallets` (mặc định tắt) chuyển mọi tài khoản đang liên kết ví Hardhat #0–#19 sang ví lưu ký mỗi khi API khởi động, nên chỉ bật khi chạy `smoke:custodial`. Tài khoản dùng ví MetaMask khác (server không có khóa) tiếp tục ký bằng MetaMask như cũ và không có số dư sổ cái. API vẫn nhận `useExternalWallet: true` khi đăng ký để dùng ví tự giữ.

**Tỷ giá cố định:** `1 ETH = 100.000.000 VND`, tức `1 VND = 10^10 wei`, nên đổi VND sang wei không bao giờ làm tròn. Đây là tỷ giá demo, không phải giá thị trường. Hằng số nằm ở `ExchangeRate.cs` và `frontend/src/domain/money.ts`; `rules.unit.ts` báo lỗi nếu hai bên lệch nhau. Xem qua `GET /api/wallets/exchange-rate`.

**Khóa riêng:** AES-256-GCM, ciphertext gắn với UserId và địa chỉ ví nên chuyển dòng giữa các tài khoản sẽ không giải mã được. API không bao giờ trả khóa. Master key lấy từ `CustodialWallet__MasterKey` (base64 của 32 byte), hoặc ở Development tự tạo tại `.runtime/custodial-master.key` (đã gitignore). **Mất file này thì mọi ví đã tạo không ký được nữa, nên hãy sao lưu nó riêng, không commit.** Mức bảo vệ này đủ cho demo; hệ thống thật cần HSM/KMS. Ví lưu ký bị khóa ở Development và chain local vì ví nền tảng và ví import dùng mnemonic công khai của Hardhat.

**Số dư và blockchain:**

- Sổ cái là số dư của người dùng và tồn tại độc lập với chain. Mọi thay đổi đi kèm một dòng `LedgerEntries` có khóa chống ghi trùng.
- Ký quỹ trừ sổ cái trước, thiếu tiền thì không có gì lên chain. Giao dịch chắc chắn không thực thi thì hoàn lại. Worker ghi có khi đọc được `Released`/`Resolved`/`Refunded`, cùng transaction với checkpoint, và đảo lại nếu reorg.
- Mỗi khoản ghi có đều kèm ETH thật gửi vào ví lưu ký, nên ETH trên chain luôn lớn hơn hoặc bằng số dư sổ cái. Trước khi ký, ví nền tảng (Hardhat #0, cũng là ví Admin và ví nhận phí) cấp thêm phí gas nếu thiếu, nên số dư VND không bị gas làm lệch.
- Khởi động lại Hardhat làm mất ETH đang khóa. Khi deployment mới được đồng bộ lần đầu, các khoản ký quỹ chưa quyết toán của deployment cũ tự hoàn về Buyer.

**Nạp tiền:** người dùng tự nạp ở **Tài khoản & ví** qua cổng giả lập (xem mục bên dưới). Admin vẫn ghi có thủ công được ở mục **Quản trị** (`POST /api/admin/wallets/credits`). Tài khoản mới và tài khoản import bắt đầu từ 0 ₫. Quyền Admin ở API kiểm tra role trên contract của chính ví người gọi, không dựa vào email.

**Sau khi cập nhật:** contract đã đổi nên phải khởi động lại Hardhat và deploy lại, rồi Admin xác minh lại Buyer/Seller. Migration chạy tự động khi API khởi động ở Development.

```powershell
cd blockchain; npm run node              # terminal 1
cd blockchain; npm run deploy:local      # terminal 2, sau đó chạy API và frontend
npm run smoke:custodial                  # chỉ chạy với API trỏ vào database thử nghiệm
```

`smoke:mixed` kiểm tra Admin dùng MetaMask và đơn giữa hai loại ví; chạy với API tắt import, trên database thử nghiệm mới. `smoke:custodial` cần `CustodialWallet__ImportHardhatWallets=true` và một tài khoản đang giữ ví Hardhat #0 (`ESCROW_ADMIN_EMAIL`, `ESCROW_ADMIN_PASSWORD`) và sẽ deploy một contract mới ở cuối.

## Chạy demo: mỗi lần là một chain mới

```powershell
.\scripts\demo-run.ps1            # lần đầu
.\scripts\demo-run.ps1 -Restart   # tắt node, API, frontend đang chạy rồi chạy lại
```

Script dừng lại nếu cổng 8545, 5180 hoặc 5173 đang bận, và không xóa gì nếu deploy lỗi. Theo thứ tự, nó làm:

1. Bật Hardhat node mới và deploy contract. Ví #0 là Admin, ví nhận phí và ví nền tảng cấp ETH.
2. Sao lưu DB vào thư mục Backup của SQL Server (`<tên DB>_before_demo_run.bak`, ghi đè bản trước), rồi xóa dữ liệu không còn đúng với chain: đơn hàng và file đơn hàng, yêu cầu nạp, lịch sử sổ cái, bản sao block, sự kiện, Arbiter và deployment. Số dư sổ cái về 0.
3. Đưa ETH của ví #1 đến #19 về 0, và Admin xác minh on-chain các ví có KYC `VERIFIED`.
4. Bật API và frontend.

**Được giữ:** tài khoản, liên kết ví, khóa ví lưu ký, hồ sơ KYC. **Arbiter:** script đặt ví Admin #0 làm Arbiter mặc định; Admin phân xử ở mục **Phân xử**. Admin cũng là ví nhận phí 1% trên phần Seller được nhận, nên đây là lựa chọn cho demo, không phải mô hình trung lập. **Không tự làm:** xác minh tài khoản chưa có KYC `VERIFIED`. KYC đạt giữa chừng chỉ được tự xác minh từ lần chạy sau.

Trước khi demo, xóa dữ liệu hoạt động của từng tài khoản trong MetaMask (Settings → Advanced) vì chain đã mới. Mục **Blockchain** trong ứng dụng đọc thẳng từ node: mỗi giao dịch có một biên lai tại `/?tx=<mã giao dịch>`, ai có link đều xem được mà không cần tài khoản; danh sách biên lai và các block được phân trang; Admin có thêm phần đối chiếu SQL với chain. Link chỉ mở được ở nơi truy cập được ứng dụng và hết hiệu lực khi chain được chạy lại từ đầu. Đây vẫn là một node do bạn điều khiển, nên nó cho thấy dữ liệu minh bạch thế nào chứ chưa chống được chủ node.

## Nạp tiền qua cổng giả lập

Luồng giống một cổng thật, chỉ khác là người dùng tự chọn kết quả và **không có tiền thật nào được chuyển**:

1. `POST /api/wallets/deposits` tạo yêu cầu `Pending` (10.000 ₫ đến 50.000.000 ₫, hết hạn sau 15 phút, tối đa 5 yêu cầu đang mở mỗi tài khoản). Tài khoản ví tự giữ phải liên kết ví trên mạng local trước. Gửi lại cùng `reference` không tạo yêu cầu thứ hai.
2. `POST /api/wallets/deposits/{id}/mock-payment` đóng vai trang thanh toán của cổng: ký kết quả `Succeeded` hoặc `Failed` rồi đưa vào đúng đường xử lý webhook. `POST .../cancel` hủy yêu cầu.
3. `POST /api/payments/webhook` là đường duy nhất biến yêu cầu thành tiền. Webhook phải có chữ ký HMAC-SHA256 của `depositId|amountVnd|status|gatewayTransactionId|timestamp` và lệch giờ không quá 5 phút, nếu không sẽ bị từ chối với 401. Số tiền phải khớp yêu cầu. Thành công thì ví lưu ký được ghi một dòng `GatewayDeposit` vào sổ cái trong cùng transaction. Sau khi commit, cả hai loại ví đều được ví nền tảng (Hardhat #0) gửi ETH thật theo tỷ giá cố định.

**Không trả tiền hai lần:** sổ cái dùng khóa `deposit:{id}`, nên webhook gửi lại hoặc gửi đồng thời chỉ ghi có một lần. Yêu cầu đã kết thúc thì không đổi trạng thái nữa. Hết hạn được tính theo thời điểm cổng báo đã thanh toán, nên khoản trả đúng hạn vẫn được ghi nhận dù webhook đến muộn.

**Gửi ETH vào ví:** địa chỉ nhận được chốt lúc tạo yêu cầu. Trạng thái gửi (`payoutStatus`) đi từ `Queued` sang `Sending` và được lưu trước khi phát giao dịch, rồi thành `Sent` kèm mã giao dịch. Nếu chắc chắn giao dịch chưa thực hiện, trạng thái quay về `Queued` và người dùng bấm **Gửi lại ETH** (`POST .../{id}/payout`). Nếu chưa rõ kết quả, trạng thái giữ ở `Sending` và không tự gửi lại để tránh trả hai lần; cần đối chiếu với chain bằng tay. Mã giao dịch được lưu vào yêu cầu nạp và dòng sổ cái.

**Bật và tắt:** `Payments__MockEnabled` đang bật trong `appsettings.Development.json`. API từ chối khởi động nếu bật ở môi trường khác Development, vì cổng này tạo số dư mà không có tiền vào. Khóa ký lấy từ `Payments__WebhookSecret` (base64, tối thiểu 32 byte); Development tự tạo `.runtime/payment-webhook.key` nếu chưa đặt. Thư mục này không được commit.

**Khi chuyển sang VNPay hoặc MoMo sandbox:** thay `mock-payment` bằng bước chuyển hướng sang cổng, đổi cách kiểm tra chữ ký theo tài liệu của cổng và bỏ điều kiện chỉ chạy ở Development. Phần ghi sổ cái giữ nguyên.

**Giới hạn tần suất:** các lệnh đọc số dư, ví, KYC và lịch sử nạp dùng giới hạn `orders` (240/phút); lệnh ghi dùng `wallet-kyc` (30/phút); webhook 120/phút theo IP.

## Thỏa thuận giao dịch: Seller chấp nhận, Arbiter do nền tảng quản lý

**Luồng mới:** Buyer lưu bản nháp → Buyer tạo đơn trên chain → **Seller đọc và chấp nhận** → Buyer ký quỹ → các bước còn lại như cũ. Contract chặn `deposit` cho đến khi có `acceptOrder`, nên Buyer không thể khóa tiền vào một thỏa thuận Seller chưa đồng ý. Trước khi ký quỹ, Buyer hoặc Seller có thể hủy đơn (`cancelOrder`, trạng thái `Cancelled`); không có tiền nào bị giữ.

**Tìm đối tác theo email:** form tạo đơn nhận email Seller thay vì địa chỉ ví (`POST /api/orders/party-lookup`, khớp đúng email, cần đăng nhập, có rate limit). Kết quả chỉ trả tên, email đã che và địa chỉ ví để Buyer đối chiếu trước khi lưu. Hai bên thấy nhau theo tên và email che trong chi tiết đơn.

**Trò chuyện trong đơn:** Buyer và Seller trao đổi ngay trong đơn. Arbiter chỉ đọc và trả lời khi có tranh chấp, đơn kết thúc thì chỉ còn đọc, và không có chức năng sửa hoặc xóa tin. Xem `backend/ORDERS.md`.

**Danh sách Arbiter:** Buyer chỉ chọn được Arbiter trong `approvedArbiters` trên contract. Admin thêm hoặc gỡ ở mục **Quản trị** (cần `DEFAULT_ADMIN_ROLE`; riêng `KYC_ADMIN_ROLE` không đủ). Worker đồng bộ danh sách vào bảng `ChainArbiter` để API liệt kê. Gỡ một Arbiter thì các đơn chưa ký quỹ của họ không chấp nhận hay ký quỹ được nữa, và họ mất quyền phân xử ngay; tranh chấp đang mở sẽ được giải quyết bằng cơ chế chia đôi sau 30 ngày nếu không thêm lại họ. Workspace Admin không có mục Đơn hàng nên không phân xử được; hãy chọn một tài khoản thường làm Arbiter.

**Điều khoản soạn sẵn:** nội dung nằm ở `StandardTerms.cs`, có phiên bản, và không được sửa sau khi đã phát hành (thêm phiên bản mới thay vì sửa). Mã hash của nội dung được đưa vào `termsJson`, nên `termsHash` trên chain gắn với đúng văn bản đó; giao diện băm lại văn bản trước khi cho Seller đồng ý. Đồng ý được ghi nhận ở hai nơi: Buyer tích ô khi lưu nháp (API lưu `BuyerAcceptedTermsAt`, từ chối nếu phiên bản không khớp), Seller tích ô rồi ký `acceptOrder` (sự kiện `OrderAccepted` trên chain). Văn bản này là mẫu cho bản demo, chưa được rà soát pháp lý.

**Sau khi cập nhật:** contract đã đổi nên phải deploy lại, rồi Admin xác minh lại ví và thêm ít nhất một Arbiter. Nếu chưa có Arbiter, form tạo đơn sẽ báo và không cho lưu.

## Quy chuẩn demo đã chốt

Người dùng đã chốt phạm vi: **ETH test + thuê thiết kế/lập trình landing page tĩnh**, thanh toán một lần. Chưa tạo token riêng. Đơn phải ghi rõ nội dung, tiêu chí nghiệm thu, số tiền, hạn giao, khoảng phản hồi và các bên trước khi tạo on-chain.

- Bàn giao chính: **một ZIP tối đa 50 MB** chứa HTML/CSS/JavaScript, tài nguyên cần thiết và README; không kèm node_modules, .git hoặc cache. Bản demo mẫu có các mục giới thiệu, dịch vụ, bảng giá và liên hệ, hiển thị được trên desktop/mobile; không bao gồm backend, database hoặc hosting trong sản phẩm thuê.
- Bằng chứng: **PNG/JPG/JPEG/PDF, tối đa 5 MB/file, 5 file/đơn**; tổng sản phẩm và bằng chứng tối đa **75 MB/đơn**. Quy ước MB = 1.000.000 byte; giới hạn áp dụng cho nội dung file, không tính multipart overhead.
- File lưu ngoài blockchain, truy cập theo quyền của đơn. Blockchain chỉ lưu SHA-256 của byte file bàn giao. Phiên bản đã gắn với Delivered không được ghi đè. Server không tự giải nén hoặc chạy sản phẩm upload; Buyer/Arbiter nghiệm thu theo điều khoản, không theo việc upload thành công.
- **API phần 04 đã áp dụng giới hạn upload và quyền theo đơn.** `smoke:api` upload ZIP thật; `smoke:local` vẫn dùng hash fixture để kiểm tra contract độc lập. Contract nhận bytes32 hash, không tự kiểm tra định dạng/dung lượng file.

Quy chuẩn chi tiết và kịch bản test cục bộ: `docs/DEMO_SCOPE_AND_TEST_SCENARIOS.md`, bản đọc PDF `docs/StudentEscrow_Quy_chuan_demo_va_kich_ban_test.pdf`. Thư mục docs được gitignore; các quy tắc chính ở mục này vẫn đi cùng repo.

## Chạy trên Windows PowerShell

Mở terminal ở `student-escrow`. Script chọn .NET ở `$env:USERPROFILE\.dotnet` trước, vì máy hiện có .NET 10 tại đó. Có thể mở `StudentEscrow.slnx` bằng IDE hỗ trợ .NET 10.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 --info
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 build StudentEscrow.slnx --no-restore
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 test StudentEscrow.slnx --no-build
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild
```

Swagger: `http://localhost:5180/swagger`. SQL development dùng instance `.\MINHKIEN1`, database mới `StudentEscrowDb`; không dùng database của dự án cũ. Khởi động instance trước. Startup development áp dụng migration vào database này; nếu lỗi, Swagger vẫn mở nhưng `/api/health/ready` trả 503. Phải sửa SQL trước khi coi phần này hoàn thành.

Máy khác: ghi connection string của mình vào biến môi trường `ConnectionStrings__StudentEscrow` hoặc `backend/StudentEscrow.API/appsettings.Local.json` (đã gitignore). Không commit mật khẩu. HTTP + `Encrypt=False` chỉ phục vụ local; triển khai thật cần HTTPS và cấu hình SQL TLS phù hợp.

Nếu tự tạo `StudentEscrowDb` và dùng SQL login, sao chép `appsettings.Local.example.json` thành `appsettings.Local.json` trong thư mục API, rồi điền thông tin thật. Tài khoản kết nối cần quyền migration/đọc/ghi trong database demo. Database rỗng là đủ; API tạo bảng từ migration, không cần tự tạo bảng Users.

Script .NET dùng cache package riêng tại `.runtime/packages` (đã gitignore), không sửa cache của dự án khác. Rider có thể dùng cache mặc định của máy như bình thường.

Không truy cập được NuGet nhưng đủ package trong cache: chạy restore với `--source "$env:USERPROFILE\.nuget\packages" --source .runtime/nuget-feed --force-evaluate -p:NuGetAudit=false`. Nguồn `.runtime/nuget-feed` chỉ có trên máy phát triển hiện tại, không được push; bỏ nguồn này nếu không tồn tại. Đây là chế độ offline tạm thời; không có kết quả kiểm tra advisory mạng. Bình thường giữ NuGet audit và nguồn nuget.org.

## Kiểm tra API thật

Giữ API chạy ở terminal đầu; terminal thứ hai:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-api.ps1
```

Script yêu cầu readiness 200, kiểm tra Swagger/JWT, đăng ký/login/profile, email trùng, validation và lỗi 401/404. Mỗi lần chạy tạo một tài khoản `smoke.*@example.test` riêng trong database demo. Không tự xóa dữ liệu hoặc reset database.

Thêm `-PublicOnly` để chỉ kiểm tra HTTP/Swagger/validation/401/404 khi SQL chưa sẵn sàng. Chế độ này không đạt gate SQL và không thay thế smoke test đầy đủ.

Development không đặt `Jwt__SigningKey`: tạo khóa ngẫu nhiên trong bộ nhớ mỗi lần chạy; tài khoản SQL vẫn giữ, token cũ hết hiệu lực sau restart nên login lại. Có thể đặt khóa riêng qua environment để duy trì token. `.env.example` chỉ là mẫu tên biến, ứng dụng không tự đọc `.env`.

Data Protection development cũng dùng bộ nhớ để không đọc/ghi key dùng chung của các dự án khác. Chưa có tính năng cookie cần giữ key qua restart. Production không dùng cấu hình key tạm này.

## Kiểm tra phần 02 – Ví và KYC mock

### Chạy lại backend và smoke test

Nếu API đang chạy trong Rider, **Stop**, restore/build solution rồi chạy lại cấu hình `http` (Development, cổng 5180). Migration `WalletProofAndMockKyc` sẽ thêm `WalletLinks`, `WalletChallenges`, `KycSubmissions` vào `StudentEscrowDb`; giữ nguyên Users, không reset database. `/api/health/ready` phải trả 200.

Hoặc chạy tại terminal trong `student-escrow`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx
powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 build StudentEscrow.slnx --no-restore
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild
```

Terminal thứ hai, giữ backend đang chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-api.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-wallet-kyc.ps1
```

Kết quả mong đợi: `API smoke checks passed` và `Wallet/KYC API smoke checks passed`. Nếu auth trả 429 do chạy lặp nhiều lần, chờ một phút. Script mới kiểm tra chữ ký Ethereum thật, chữ ký sai/sửa message, challenge khác tài khoản, replay, một ví không thuộc hai tài khoản, hai request liên kết đồng thời chỉ một thành công, KYC PASS/REJECTED/resubmit và quyền hồ sơ. Script yêu cầu readiness 200, **không chuyển sang database giả nếu SQL lỗi**.

Mỗi lần chạy tạo hai tài khoản `wallet.smoke.*@example.test` và ví ngẫu nhiên trong database demo. Private key chỉ nằm trong bộ nhớ của chương trình test, không gửi tới server, không in và không lưu; không nạp tiền vào những ví này vì khóa không được giữ lại. Đây không phải test giao dịch blockchain. `dotnet test` chạy 42 ca; HTTP integration test dùng repository riêng trong test host, không thay thế kiểm chứng SQL thật bằng hai script trên.

### API trong Swagger

Đăng ký/login, bấm **Authorize** với accessToken. Các endpoint chỉ sử dụng `sub` trong JWT, không nhận userId để xem/sửa tài khoản khác:

| Endpoint | Mục đích |
|---|---|
| `GET /api/wallets/me` | Ví đã liên kết; tài khoản mới trả `linked: false` |
| `POST /api/wallets/challenges` | Gửi `address`, `chainId` 31337 hoặc 11155111; nhận `challengeId`, `message`, `expiresAt` |
| `POST /api/wallets/link` | Gửi `challengeId`, `signature`; server kiểm tra message đã lưu, không tin message do client gửi |
| `GET /api/kyc/me` | Trạng thái KYC mock của ví/tài khoản hiện tại |
| `POST /api/kyc/submissions` | Nộp dữ liệu mẫu sau khi liên kết ví |

Challenge hết hạn sau 5 phút, nonce ngẫu nhiên và có ràng buộc tài khoản/domain/URI/chain. Nonce được tiêu thụ và ví được tạo trong cùng transaction SQL; unique index trên UserId và Address chống liên kết trùng. Chỉ hỗ trợ chữ ký EOA `personal_sign`, chưa hỗ trợ ví smart contract/EIP-1271. Chưa hỗ trợ thay/xóa ví để tránh bỏ qua chính sách escrow ở phần sau. Chữ ký chứa chain ID để ràng buộc nội dung ký; chưa kiểm tra RPC hoặc số dư hay chuyển mạng MetaMask tự động.

Định dạng nội dung dựa trên [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361); xác minh bằng Nethereum theo [EIP-191](https://eips.ethereum.org/EIPS/eip-191), không phải transaction. Đây là luồng liên kết ví vào tài khoản JWT, không tuyên bố cung cấp đầy đủ SIWE login/session. `Wallet:Domain`/`Wallet:Uri` là cấu hình server tin cậy; nếu đổi cổng/domain, sửa hai giá trị tương ứng trong appsettings.Local.json, không lấy từ input client.

### Ký thử bằng MetaMask khi chưa có frontend

Mở Swagger local trên trình duyệt đã cài MetaMask, dùng ví demo của bạn (không dùng ví giữ tiền thật). Sau khi gọi `/api/wallets/challenges`, giữ nguyên message nhận được. Trong DevTools Console của **trang local**, chạy:

```javascript
const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
const challenge = JSON.parse(prompt("Dán toàn bộ JSON response của challenge từ Swagger"));
if (challenge.address.toLowerCase() !== account.toLowerCase()) throw new Error("MetaMask đang chọn sai ví");
const message = challenge.message;
const messageHex = "0x" + Array.from(new TextEncoder().encode(message), value => value.toString(16).padStart(2, "0")).join("");
const signature = await window.ethereum.request({ method: "personal_sign", params: [messageHex, account] });
console.log({ address: account, signature });
```

Trước đó phải tạo challenge bằng đúng `account`; ký trong thời hạn 5 phút. Dán toàn bộ JSON giúp JSON.parse khôi phục xuống dòng thật, tránh ký sai chuỗi literal `\\n`. Xem rõ nội dung trên popup MetaMask trước khi đồng ý; chữ ký này chỉ liên kết ví, không yêu cầu gas/chuyển tiền. Gửi chữ ký cùng challengeId vào `/api/wallets/link`. Không nhập private key/seed phrase vào Swagger hoặc Console. Nếu trình duyệt không inject MetaMask ở trang này, dùng smoke script để kiểm tra trước, tích hợp nút ký trực tiếp ở phần frontend sau. Tham khảo [hướng dẫn ký của MetaMask](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/).

### Dữ liệu KYC mẫu

Chỉ dùng thông tin giả; chưa upload giấy tờ/ảnh thật, chưa OCR, nhận diện khuôn mặt hoặc AI. Hai reference dưới đây là tên fixture do server kiểm tra, không phải đường dẫn file:

```json
{
  "fullName": "Demo Student",
  "studentNumber": "DEMO-123456",
  "documentReference": "DEMO-DOCUMENT-PASS",
  "selfieReference": "DEMO-SELFIE-PASS"
}
```

- Cả hai PASS → `VERIFIED`; đổi document thành `DEMO-DOCUMENT-FAIL` hoặc selfie thành `DEMO-SELFIE-FAIL` → `REJECTED`, kèm reasonCode.
- Trạng thái do server quyết định, không nhận `status` từ client. KYC REJECTED có thể nộp lại; VERIFIED không cho người dùng thay thế/hạ trạng thái.
- Hiện giữ một hồ sơ KYC hiện tại cho mỗi ví; nộp lại thay hồ sơ REJECTED trong transaction, kiểm tra rowversion chống ghi đè đồng thời. Chưa cung cấp lịch sử kiểm duyệt/audit đầy đủ.
- Response luôn có `isMock: true`, `onChainVerificationStatus: "NOT_IMPLEMENTED"`, `canCreateEscrow: false`. **VERIFIED mock trong SQL không có nghĩa ví đã được xác minh trong smart contract.**
- Mock chỉ bật ở Development (`Kyc:EnableMockVerification`); startup từ chối bật mock ở Production. Không dùng API này làm dịch vụ định danh thật.

## Thư mục

```text
backend/      API / Application / Domain / Infrastructure
tests/        test auth/ví/KYC và chương trình smoke HTTP có ký Ethereum
scripts/      chọn SDK, chạy backend, smoke test HTTP
blockchain/   contract Solidity, test Hardhat, ABI, deploy và smoke local
frontend/     React/MetaMask, giao diện demo trắng–đen và test trình duyệt
analytics/    console huấn luyện ML.NET, mô hình đã lưu, dữ liệu giả lập
docs/         ghi chú cục bộ, không push
```

`frontend/` chứa React/MetaMask và giao diện các vai trò ở phần 05. Phần 04 nối API/file với contract qua Nethereum worker; contract vẫn là nguồn sự thật cho tiền/trạng thái. Phần 06 ở `analytics/`. Phần 07 (Sepolia, kiểm thử tích hợp và video demo) chưa triển khai.
