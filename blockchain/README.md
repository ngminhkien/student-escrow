# StudentEscrow — phần 03: blockchain local

Smart contract giữ ETH test và quản lý vòng đời đơn. Phần này chạy độc lập trên Hardhat local; worker SQL, React/MetaMask và Sepolia thuộc các phần tiếp theo.

## Cài và kiểm thử

Đã khóa Node tương thích trong `package.json` (máy phát triển: Node 22.14.0), Hardhat 3.18.1, ethers 6.17.0, OpenZeppelin 5.6.1 và Solidity 0.8.28. Dùng lockfile để tái lập. Plugin test là Node test runner, không dùng cấu hình Hardhat 2/Mocha.

Từ `student-escrow`, PowerShell:

```powershell
cd blockchain
npm.cmd ci
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:coverage
npm.cmd run export:abi
```

Windows có thể chặn `npm.ps1`; dùng `npm.cmd`. Cache npm riêng ở `.runtime/npm-cache`; lần build đầu Hardhat tải compiler vào cache mặc định của công cụ. Không cần SQL để chạy contract test. Hướng dẫn tương thích: [Hardhat Node support](https://hardhat.org/docs/reference/nodejs-support), [Node test runner](https://hardhat.org/docs/plugins/hardhat-node-test-runner), [ethers plugin](https://hardhat.org/docs/plugins/hardhat-ethers).

## Node local, deploy và smoke giao dịch thật trên local

Terminal đầu:

```powershell
cd blockchain
npm.cmd run node
```

Terminal thứ hai:

```powershell
cd blockchain
npm.cmd run deploy:local
npm.cmd run smoke:local
```

RPC `http://127.0.0.1:8545`, chain ID `31337`. Script deploy chỉ chấp nhận mạng `localhost`/31337. Signer local theo thứ tự: Admin, Buyer, Seller, Arbiter, Platform (năm tài khoản khác nhau). Không cần nhập private key. Các khóa do Hardhat node hiển thị là khóa công khai cho local, không dùng cho mạng giữ tiền thật.

Deploy tạo `deployment/local/<deploymentId>.json` và `latest.json` (gitignore), gồm chain ID, contract, deployment block/hash, tx hash, vai trò và ABI. Mỗi lần deploy có UUID riêng; không ghép các lịch sử sau reset local. Smoke kiểm tra manifest và deployment block hash, Admin xác minh ví on-chain rồi chạy bốn luồng: hoàn thành, tranh chấp 70/30, hoàn quá hạn giao, nhận sau hạn phản hồi. Smoke đối chiếu số dư, trừ riêng gas và kiểm tra khoản khóa/trạng thái. Script tăng thời gian local để thử timeout; không chạy đồng thời với một người dùng đang demo trên cùng node. Mỗi lần smoke giữ lại các đơn local, không reset chain.

`deployment/Escrow.abi.json` là ABI chia sẻ cho backend/frontend. Sau mọi thay đổi contract, build/test rồi export lại ABI. Không dùng contract fixture `SettlementReceiver` trong deploy ứng dụng.

## Quyền và luồng tiền

Enum cố định: `Created=0, Funded=1, Delivered=2, Completed=3, Disputed=4, Resolved=5, Refunded=6`. Chi tiết hàm/event trong [DESIGN.md](DESIGN.md).

- Admin quản lý `KYC_ADMIN_ROLE`; người có role này cập nhật `verifiedWallets`. Arbiter của đơn chỉ có quyền phân xử đúng đơn Disputed. Platform chỉ nhận phí.
- Buyer và Seller phải được xác minh on-chain khi tạo và nạp. `VERIFIED` mock của API không tự tạo cờ on-chain; chưa có cầu nối API/Admin UI trong phần này.
- Buyer nạp đúng một lần, đúng khoản wei; Seller ghi SHA-256 file; Buyer xác nhận trong hạn phản hồi. Tiền đến Seller trừ phí 1%.
- Hạn giao và hạn phản hồi khác nhau. Giao/confirm/dispute hợp lệ tại deadline; refund/claim chỉ sau deadline. Timeout cần người dùng gọi hàm.
- Buyer/Seller khiếu nại từ Funded hoặc Delivered trong hạn. Chỉ Arbiter của đơn quyết toán tỷ lệ Seller 0–10000 bps; hoàn 100% Buyer qua phân xử vẫn là Resolved.
- Thu hồi KYC không chặn bàn giao/phân xử/quyết toán đơn đã Funded. Không có quyền Admin rút ký quỹ hoặc sửa điều khoản.

## Kiểm thử và giới hạn

Test bao phủ caller/state, KYC bypass/revoke, reference trùng, tham số lỗi, tiền thiếu/thừa, deadline đúng mốc và +1 giây, phí/làm tròn/0–100% Seller, trạng thái cuối không xử lý lại, nhiều đơn và invariant tiền. Các receiver test mô phỏng từ chối ETH và reentrancy; số liệu test thực tế ghi trong `docs/03_VALIDATION.md` cục bộ.

Chuyển ETH trực tiếp có checks-effects-interactions và OpenZeppelin `nonReentrant`: nếu bất kỳ người nhận nào từ chối ETH, toàn bộ giao dịch revert và tiền vẫn khóa. Disputed cần Arbiter trực tuyến; chưa có cơ chế thay trọng tài hoặc xử lý trọng tài mất liên lạc. Hash xác minh byte nội dung, không quyết định chất lượng hoặc chứng minh Seller đã đồng ý điều khoản. File/bằng chứng giữ ngoài chain. Đây là demo local có test, chưa phải audit độc lập hay hệ thống sử dụng tiền thật.

Không triển khai milestone, ERC-20, automation timeout, upgrade, pull-payment, KYC thật hay AI ở phần này. Sepolia triển khai ở phần 07 sau tích hợp; node local do nhóm điều khiển.
