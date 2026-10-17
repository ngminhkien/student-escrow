# Frontend UI/UX specification

## Scope and evidence
- Improve the existing React/Vite/ethers frontend; preserve API, contract, exact arithmetic, authenticated file and signing safeguards described by SCOUT-frontend.md.
- Vietnamese interface, English code/comments. Local ETH test demo; no invented marketplace, balances, analytics, identity service, notification center or production claims.
- Applied ui-ux-pro-max accessibility, interaction and responsive guidance. Its design-system CLI could not run because Python is unavailable; recommendations below derive from the repository and skill rules.

## Visual system
- Product character: calm, precise monochrome financial workspace with generous whitespace and strong typographic hierarchy.
- Tokens: canvas #f6f7f8; surface #ffffff; subtle surface #f2f3f5; text #17191c; muted #565c65; border #dfe2e6; strong border #777d86; primary #17191c; inverse #ffffff.
- Use system sans stack supporting Vietnamese; mono only for addresses, hashes, IDs. No network font dependency.
- Page title 30/38px semibold; section title 20/28px; card title 16/24px semibold; body 16/24px; metadata 13/20px. Mobile page title 25/32px.
- Spacing scale 4/8/12/16/20/24/32/40px. Surface radius 12px; inputs/buttons 8px; pill badges 999px. Borders 1px, shadows subtle and limited to elevated menus.
- Buttons minimum 44px high; primary dark solid, secondary white with border, tertiary text. Destructive actions use explicit verb/consequence and strong border, never color alone.
- Status badges combine short Vietnamese text with outline/fill/pattern or simple SVG glyph. Never depend on green/red to communicate state.
- Use one inline SVG icon vocabulary, 20px icons with consistent stroke; no emoji icons or decorative stock images.

## Workspace shell
- At 1440px: 232px sidebar, main flexible width with min-width:0; header 72px; content padding 32px; content max-width 1200px.
- Sidebar: StudentEscrow wordmark and small “Ký quỹ dịch vụ sinh viên”; navigation “Đơn hàng”, “Tài khoản & ví”, “Quản trị”; optional “Giao dịch” section only if implemented as the existing local transaction journal.
- Active navigation has dark text, subtle fill and visible left indicator; use aria-current. Keep administration discoverable because its actual authority is queried from contract, not JWT.
- Sidebar footer: “Môi trường local” / “ETH test”; authenticated name/email and logout. Never display invented avatar imagery; optional initial circle derives from name.
- Header shows current section and a compact connection area: selected wallet, network, connect/change button. Connection detail exposes linked wallet, full address, chain 31337, health and indexed block.
- One concise readiness strip below header. Ready: “Sẵn sàng”; other states: readable reason and direct repair action where possible. Detailed contract/block/worker fields belong in expandable “Chi tiết kết nối”.
- Wrong network and wrong linked wallet retain prominent actionable banners. A disconnected blockchain must not obscure readable existing orders or account forms.
- Retain stable .connection .mono[title], .banner, .order-detail, order-state and delivery-match selectors or explicitly migrate existing browser tests.
- Deep link ?order=UUID opens the orders workspace after authentication and loads only authorized detail. Preserve existing UUID link compatibility.

## Authentication and account
- Logged-out screen uses centered 440px form alongside a restrained explanatory panel on desktop; one column on mobile. Keep connection controls accessible outside the auth card.
- Heading “Đăng nhập” / “Tạo tài khoản”; explain that application login and MetaMask are separate. Never imply login changes MetaMask selection.
- Visible labels, proper autocomplete and field limits; registration full name, email, password; login email/password. Password visibility toggle only if accessible and useful.
- Form failure remains adjacent to form, values preserved, pending submit disabled. Do not add forgotten-password or social-login controls without endpoints.
- Account page heading “Tài khoản & ví”, subtitle explaining the three independent readiness steps.
- Three cards: “Tài khoản” with real profile; “Liên kết ví” with selected versus permanently linked wallet and network; “Xác minh thử nghiệm” with mock KYC status and real rejection reason.
- Show workflow “Đăng nhập → Liên kết ví → Kiểm tra xác minh on-chain”. Mock VERIFIED never appears as permission to create/deposit escrow.
- Linking explains the single-use signature and permanent one-wallet association before clicking “Liên kết ví”. Sign exactly the server challenge; do not expose keys/seed fields.
- KYC inputs explicitly use allowed DEMO fixtures and DEMO student number; show existing verified/rejected/not-submitted states, no identity-file uploader.
- On-chain verification is a separate labeled value; verification management remains administrator functionality.

## Orders workspace
- Page heading “Đơn hàng”, subtitle “Theo dõi các đơn bạn tham gia”; primary “Tạo bản nháp”, secondary refresh.
- Optional summary cards derive only from currently loaded rows: “Đang hiển thị”, “Đang thực hiện”, “Cần phản hồi”; label scope clearly, never imply account-wide totals. Omit cards if they crowd the essential interface.
- Toolbar search matches description/UUID/address within loaded data; state and account-role filters operate locally. Label “Lọc trong các đơn đã tải”; no fake backend search.
- Table columns: work description + short UUID; role; exact ETH; status; deadline; explicit “Mở” button. Desktop rows 72px, descriptions clamp visually to two lines with full text in detail.
- Mobile uses compact order cards with same data and labeled open action, rather than forcing a 6-column horizontal table.
- Empty states distinguish no authorized orders, no filter match, wallet link required, and unavailable request. Offer clear filter reset/create/account/retry action as appropriate.
- Pagination respects real skip and page limits (50 rows); “Xem thêm 50 đơn” only when previous page is full. No fabricated total-page number.
- Secondary expandable “Mở bằng mã đơn” retains direct UUID access with validation and unauthorized/not-found feedback.

## Draft creation
- Inline dedicated bordered section or in-workspace page, not a cramped modal; heading “Bản nháp mới”, close/cancel returns to list.
- Three semantic groups: parties (seller/arbiter, linked buyer read-only), work (description/acceptance criteria), payment/deadlines (ETH, local datetime, review seconds).
- Use two columns desktop, one mobile. Textareas full width; limits and validation adjacent to fields.
- Summary below form: exact ETH, local deadline, review duration, 1% seller-side fee, gas separate. Explain “Lưu bản nháp → Tạo đơn trên chain → Nạp ETH” as three separate steps.
- Immutable terms warning appears before save: “Điều khoản không thể sửa sau khi lưu bản nháp.” Retain input values on errors; successful save opens detail.
- Validate distinct nonzero wallets, contract exclusion, positive exact ETH/wei limits, future client/chain deadline and review integer 1..31536000. Never alter domain validation to fit UI convenience.

## Order detail and actions
- Detail opens below list or as a focused workspace with “Quay lại danh sách”; ensure selected content scrolls/focuses into view without repeated focus stealing during polling.
- Header: actual description, short UUID/copy button if implemented, role and status badge. Never invent a separate title field.
- Main content 2/3 width and 1/3 summary at desktop; stack on mobile. Summary includes exact amount, delivery/review deadlines and current on-chain state.
- Lifecycle uses actual states: draft → created → funded → delivered → completed, with distinct disputed/resolved/refunded branches. Do not mark merely inferred events as completed.
- Terms and parties remain readable with full wrapped addresses; technical canonical JSON/hash/reference sit in disclosure.
- Action card shows only role/state/deadline-eligible mutations from existing rules. Disabled actions have visible reasons (wallet/network, absent ZIP, inspection, unavailable projection).
- Before receipt confirmation retain explicit buyer inspection checkbox and matching server delivery hash. Dispute stays available under real deadline rules.
- Show absolute local deadline and chain time; optional relative time is supplementary. Inclusive/strict deadline semantics remain existing domain rules; no client automatic refunds or claims.
- Arbitration: percent input 0..100 step .01, exact buyer refund/seller net/platform fee preview, final “Phân xử và thanh toán”. Include 0% and 100% as valid.
- Terminal states show actual persisted settlement amounts; archived/mismatched terms show read-only notice while retaining authorized downloads.

## Files, events and transaction feedback
- Separate “Sản phẩm bàn giao” and “Bằng chứng” subsections. File row: name, type, byte/MB size, SHA-256 disclosure, authenticated download action.
- Product ZIP is one immutable nonempty file <=50,000,000 bytes. Evidence PNG/JPG/JPEG/PDF <=5,000,000 each, <=5 files; all files <=75,000,000 bytes. Display remaining counts from loaded metadata; server is final authority.
- Native accessible file input with clear allowed formats; no fake upload progress percentage. Show “Đang tải lên” and hashing phase when known.
- Local/server upload hash mismatch blocks delivery. Downloads verify bytes before saving. Existing local-file hash checker remains available; never inline-execute or preview uploaded products.
- Events section is an accessible chronological list/table with real event, block and tx hash. Fetch additional 100-event pages explicitly; distinguish no events from loading/error.
- Local transaction journal labels wallet/deployment scope and 30-record retention; show pending/confirmed/failed/rejected where actually available and explicit receipt refresh.
- Pending signing: “Mở MetaMask để xác nhận”; mined: “Đã xác nhận trên chain; đang chờ đồng bộ đơn”. Successful transaction receipt does not change projected escrow state optimistically.
- Long hashes wrap; full value accessible. Do not create explorer links for a local chain.

## Administration
- Heading “Quản trị xác minh”; query actual DEFAULT_ADMIN_ROLE and KYC_ADMIN_ROLE from current local contract.
- Read-only role summary and address lookup remain usable; wallet verification/revocation controls only for actual KYC admin; grant/revoke only for default admin.
- Show target full address, current role/verification and intended change before action. No fictitious admin REST endpoint or globally privileged arbiter role.
- Pending controls follow the existing transaction/preflight flow; absent permission explains the required contract role without hiding the whole page.

## Responsive, accessibility and async acceptance
- 375px: 16px outer padding; full-width cards/fields; 44px targets; header wraps; sidebar becomes compact top navigation with wrapping items. No off-canvas menu dependency required.
- 768px: 24px padding; two-column cards only when content fits; 1024px enables desktop sidebar and detail split; 1440px uses 32px content padding.
- No body horizontal scrolling. min-width:0 on flex/grid children; overflow-wrap:anywhere on identifiers; technical tables may scroll inside labeled regions.
- Semantic header/nav/main/footer, one page h1, ordered headings, skip-to-content, labels tied to controls, aria-describedby for help/errors and aria-invalid for invalid fields.
- Focus visible >=2px with offset; keyboard order follows DOM; current navigation accessible; any dialog requires focus trap/restore and Escape (prefer inline forms to avoid unnecessary dialogs).
- Body text contrast >=4.5:1, UI boundaries >=3:1 where essential; no color-only state. Icons decorative unless labeled buttons. Motion <=200ms and disabled with prefers-reduced-motion.
- Initial loading uses stable skeleton/card footprint plus live status; refresh retains last good data and announces staleness/error instead of blanking the screen. Mutation pending prevents duplicate submit.
- Errors: concise Vietnamese guidance, retry on safe reads; trace ID optional disclosure. Distinguish 401 expiry, 404 inaccessible order, 409 wallet prerequisite, 429 rate limit and unreachable services. Never automatically retry writes.
- Session change clears protected data immediately; stale requests cannot replace current user/order/wallet state. API service/backend/SQL/RPC unavailability must be reported honestly in validation.
