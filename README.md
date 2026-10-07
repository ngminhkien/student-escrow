# StudentEscrow – Code trong một repo

`student-escrow` là thư mục gốc của repo code, có `.gitignore` riêng. Thao tác Git và push từ thư mục này, không từ thư mục cha `dvcntc`. Tài liệu ý tưởng/phân công ở thư mục cha không thuộc repo. Thư mục `docs/` bên trong chứa ghi chú kiểm chứng cục bộ và cũng được gitignore; README này giữ lại để hướng dẫn chạy code.

## Phần đang triển khai

**01 – Backend nền tảng đã đạt gate:** .NET 10, bốn lớp, SQL Server, migration, đăng ký/đăng nhập JWT, hồ sơ và Swagger.

**02 – Liên kết ví và KYC mock đã đạt gate (TV2 + TV4):** ví EOA ký challenge một lần, chống replay/hết hạn/chiếm ví; KYC có PASS/REJECTED và API chỉ xem hồ sơ của chính tài khoản. Ngày 04/10/2026, agent chạy backend ngoài sandbox và cả hai smoke script trên SQL thật đều PASS, gồm các request đồng thời và kiểm tra persistence. Trong sandbox vẫn gặp SSPI.

**03 – Blockchain local đã đạt gate (TV1 + TV5):** Solidity/Hardhat, xác minh ví on-chain bằng quyền Admin, đủ vòng đời ký quỹ ETH test, phí 1%, tranh chấp chia tỷ lệ và hai timeout. 71 test PASS; coverage Escrow.sol 100% dòng/câu lệnh. Deploy và bốn luồng smoke trên node local PASS, đối chiếu số dư/gas. ABI, đặc tả và hướng dẫn ở [blockchain/README.md](blockchain/README.md) và [blockchain/DESIGN.md](blockchain/DESIGN.md).

**04 – Draft/file/hash và Nethereum worker đã đạt gate local:** API tạo draft bất biến, lưu file theo quyền/quota, tính SHA-256; worker đọc contract local vào SQL với checkpoint, dedup, restart và phục hồi reorg. Ngày 06/10/2026: 64/64 test .NET PASS gồm SQL thật; smoke API/blockchain, restart và hồi quy auth/ví/KYC PASS. Hướng dẫn chạy, API, cấu hình và giới hạn ở [backend/ORDERS.md](backend/ORDERS.md).

**05 – React/MetaMask, giao diện trắng–đen:** tài khoản/ví/KYC, draft/đơn/file, ký giao dịch, Admin xác minh/phân quyền KYC và Arbiter phân xử. Build, 8 test logic và browser E2E với API/SQL/Hardhat thật PASS; EIP-1193 trong test mô phỏng popup ví, cần thử MetaMask extension thật khi demo. Hướng dẫn [chạy và test chung phần 4–5](frontend/README.md). Ví ký phía client; server không giữ private key. AI và Sepolia chưa triển khai.

Ghi chú tiến độ và hướng dẫn Swagger chi tiết nằm trong `docs/` trên máy phát triển, không được push. Các bước chạy và kiểm tra API cần thiết nằm ngay trong README này.

Kết quả phần 01: build sạch, 11 test lúc hoàn thành phần này và HTTP public/Swagger chạy được. Người dùng đã chạy full smoke bằng PowerShell thường với SQL thật, tất cả ca PASS; **phần 01 đạt gate**. Sau phần 02, bộ test .NET có 42 test PASS. SQL ngoài sandbox được agent kiểm chứng lại ngày 04/10/2026; lỗi SSPI vẫn xảy ra trong sandbox. Kết quả chi tiết lưu cục bộ trong `docs/01_VALIDATION.md`, `docs/02_VALIDATION.md` và `docs/03_VALIDATION.md`.

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
docs/         ghi chú cục bộ, không push
```

`frontend/` chứa React/MetaMask và giao diện các vai trò ở phần 05. Phần 04 nối API/file với contract qua Nethereum worker; contract vẫn là nguồn sự thật cho tiền/trạng thái. Bước kế tiếp là phần 06: analytics/ML.NET; `analytics` chưa triển khai.
