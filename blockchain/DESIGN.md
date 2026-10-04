# Escrow contract / ABI — phần 03

`contracts/Escrow.sol` là nguồn sự thật về tiền/state. SQL sau này chỉ index event; input tx hash không đủ để cập nhật đơn. Contract không đọc SQL hoặc KYC mock.

## Dữ liệu và quyết định thiết kế

Order ID bắt đầu từ 1; ID 0 hoặc chưa tạo đều revert `OrderNotFound`, tránh default enum trong mapping. `getOrder` trả đầy đủ struct. Platform wallet bất biến theo deployment. Order không có hàm sửa Buyer/Seller/Arbiter, amount, reference, termsHash, deadline, reviewWindow hoặc fee.

`amountWei`: uint256, miền 1..10^38-1 wei. Giới hạn này cho phép chọn decimal(38,0) ở phần 04, còn API luôn truyền tiền bằng chuỗi. `Math.mulDiv` tránh overflow khi tính tích/chia. `reviewWindow`: 1 giây..365 ngày. `deliveryDeadline`: tương lai và không vượt uint64; cộng reviewWindow an toàn trong uint256. Deadline cho phép cùng giây để test, UI demo sẽ chọn khoảng đủ thao tác.

`clientReference`: bytes32 khác 0; backend sẽ tạo reference ngẫu nhiên, unique theo Buyer ở contract. Một Buyer không tái sử dụng reference kể cả khi đơn kết thúc. Buyer khác có thể có reference giống nhưng worker không ghép chéo draft. `termsHash`: SHA-256 của byte tài liệu điều khoản đã thống nhất, khác 0; phần 04 phải giữ đúng phiên bản byte đã hash, phần 05 hiển thị cho hai bên. Contract ghi commitment bất biến, không chứng minh Seller đã ký đồng ý (chưa có chữ ký chấp thuận riêng). Không đưa PII/file/chi tiết KYC lên chain. `deliveryHash`: SHA-256 byte file gốc, digest 32 byte với tiền tố 0x.

## Hàm và điều kiện

| Hàm | Caller | Điều kiện / kết quả |
|---|---|---|
| `setWalletVerified(wallet,bool)` | KYC_ADMIN_ROLE | Không zero/self; phát WalletVerificationUpdated |
| `createOrder(seller,arbiter,amountWei,clientReference,termsHash,deliveryDeadline,reviewWindow)` | Buyer | Buyer/Seller verified, khác nhau; Arbiter không Buyer/Seller; địa chỉ không zero/self; tham số hợp lệ → Created |
| `deposit(orderId)` payable | Buyer | Created, cả hai vẫn verified, đúng amount, timestamp <= deliveryDeadline → Funded |
| `markDelivered(orderId,deliveryHash)` | Seller của đơn | Funded, hash khác 0, timestamp <= deliveryDeadline → Delivered; reviewDeadline = deliveredAt + reviewWindow |
| `confirmReceipt(orderId)` | Buyer | Delivered, timestamp <= reviewDeadline → Completed |
| `refundIfExpired(orderId)` | Buyer | Funded, timestamp > deliveryDeadline → Refunded |
| `claimAfterReviewTimeout(orderId)` | Seller | Delivered, timestamp > reviewDeadline → Completed |
| `raiseDispute(orderId)` | Buyer/Seller | Funded chưa quá hạn giao hoặc Delivered chưa quá hạn phản hồi → Disputed |
| `resolveDispute(orderId,sellerShareBps)` | Arbiter của đơn | Disputed, share 0..10000 → Resolved |

Created quá hạn vẫn Created, không tự refund. Disputed chặn mọi nhánh giải ngân/hoàn thường. Completed/Resolved/Refunded không chuyển tiếp. KYC chỉ chặn create/deposit; không khóa quyền xử lý tiền đã Funded.

Admin được cấp DEFAULT_ADMIN_ROLE và KYC_ADMIN_ROLE trong constructor. Có thể grant/revoke KYC role bằng AccessControl; Admin không mặc nhiên là Arbiter. Không có hàm rút tiền của Admin, đổi phí hay Platform. Platform có thể trùng ví một bên, nhưng quyền của nó vẫn đến từ vai trò cụ thể trong đơn; script demo dùng các ví riêng.

## Event phục vụ phần 04/05

Chữ ký và `indexed` chính xác xem `deployment/Escrow.abi.json` xuất từ compiler, không viết ABI bằng tay.

| Event | Dữ liệu và ánh xạ |
|---|---|
| WalletVerificationUpdated | wallet indexed, verified |
| OrderCreated | orderId indexed, clientReference indexed, buyer indexed; seller, arbiter, amountWei, feeBps, termsHash, deliveryDeadline, reviewWindow → Created |
| Deposited | orderId indexed, amountWei → Funded |
| Delivered | orderId indexed, deliveryHash, deliveredAt, reviewDeadline → Delivered |
| Disputed | orderId indexed, raisedBy indexed → Disputed |
| Released | orderId indexed, sellerGrossWei, sellerNetWei, platformFeeWei → Completed |
| Resolved | orderId indexed, buyerRefundWei, sellerGrossWei, sellerNetWei, platformFeeWei → Resolved |
| Refunded | orderId indexed, buyerRefundWei → Refunded |

Các event quyết toán chỉ tồn tại nếu toàn bộ giao dịch thành công. Worker phải đọc receipt/log đúng deployment, kiểm tra confirmations, dùng logIndex để dedup và blockHash cho reorg. AccessControl cũng phát event quản lý quyền theo ABI.

## Tiền và invariant

```text
gross = floor(amountWei * sellerShareBps / 10000)
refund = amountWei - gross
fee = floor(gross * 100 / 10000)
net = gross - fee
refund + fee + net = amountWei
```

Confirm/claim dùng share=10000; refund dùng share=0 và phí=0; resolve dùng share Arbiter chọn. Phần dư tỷ lệ thuộc Buyer. Gas do caller trả riêng. `totalLockedWei` tăng đúng amount khi deposit, giảm đúng amount khi quyết toán. Không đơn này chi tiêu khoản khóa của đơn khác; locked <= contract balance, không ép bằng nhau vì có thể nhận ETH cưỡng bức. Contract không có receive/fallback nhận ETH tự do.

Quyết toán kiểm tra quyền/state ở hàm public, cập nhật state/locked trước khi external call và có nonReentrant. Recipient từ chối ETH → tất cả chuyển tiền/state/log revert; không quyết toán một phần. Guard chặn cả deposit lồng trong callback của settlement. Các hàm không chuyển tiền vẫn kiểm tra quyền/state riêng.

## Định danh deployment

Manifest local chứa UUID deploymentId, network/chainId, address, deployment block/hash, tx hash, ABI, roles và compiler. Manifest bị gitignore để tránh địa chỉ stale sau reset. Từng UUID có file riêng; latest chỉ phục vụ thao tác local. Chain ID không đủ nhận dạng chain local đã reset. Không gán đơn cũ sang contract mới.
