# Scout: StudentEscrow frontend

Loaded CORE.md, scouter agent definition, BRAINSTORM-frontend.md and RESEARCH-frontend.md. Applied the scouter exploration protocol (repository evidence, dependency mapping, integration constraints); no implementation or tests performed. Inventory excludes dependencies, generated build output and lockfile contents. All findings below derive from first-party code/config/docs; environmental checks were read-only.

## Repository map and refactor boundaries

- Root: README documents local ETH student-service escrow, .NET/SQL setup and mock KYC. StudentEscrow.slnx, global.json and Directory.Build.props establish .NET 10.0.302/net10.0, nullable, implicit usings and warnings as errors. scripts/ contains SDK selection, backend launcher and API/wallet/orders SQL smoke commands.
- backend/StudentEscrow.Domain: Users/User, Wallets/WalletLink/WalletChallenge, Kyc/KycSubmission and Orders/EscrowEntities are persisted domain records. OrderDraft is immutable; ChainOrder/ChainEvent/ChainBlock/ChainDeployment form indexed state; OrderFile holds SQL bytes.
- backend/StudentEscrow.Application: Auth services/contracts, wallet challenge/link services/contracts, mock KYC services/contracts, OrderRules canonical sealing/quotas and EvidenceFormat structural file checks. No application-level JWT buyer/seller/admin role field.
- backend/StudentEscrow.Infrastructure: Auth password/JWT implementations, Ethereum signatures, user/wallet/KYC repositories, EF DbContext and three migration stages; Orders contains SQL locks, authenticated OrderService, RPC/manifest source, transactional/reorg-aware BlockchainSync and EscrowProjector.
- backend/StudentEscrow.API: Program wires services/auth/rate limits/Swagger/optional development migrations/worker; Controllers provide only the endpoints below. Common contains normalized errors, authenticated user extraction and ephemeral development protection keys. ORDERS.md defines authority and operational constraints.
- blockchain/contracts/Escrow.sol implements all money/state authority. contracts/test/SettlementReceiver tests refusal/reentrancy. test/Escrow.ts covers roles, transitions, exact deadline/fee/settlement boundaries and invariants. deployment contains deploy, smoke, API verification and ABI export; Escrow.abi.json is the single shared ABI. hardhat.config.ts/package.json pin Hardhat 3 + node test runner and Solidity 0.8.28; README/DESIGN explain domain/limitations.
- tests/StudentEscrow.Application.Tests: AuthServiceTests, TokenServiceTests, WalletKycTests, WalletKycHttpTests, WalletKycSchemaTests, EscrowOrderTests, EscrowSqlTests. ApiSmoke/Program.cs performs HTTP/signature checks. SQL integration needs real configured SQL; contract unit tests do not.
- frontend is existing React 19/TypeScript/Vite/ethers, no component library/router/query dependency. index.html + main.tsx mount App. Strict TS includes source, tests and config. Vite dev/preview proxy /api to localhost:5180 and /rpc to 127.0.0.1:8545; dev allows the external shared ABI file.
- Actual frontend source: App.tsx 146 lines; OrdersPanel.tsx 228; wallet.ts 170; AccountPanel.tsx 76; AdminPanel.tsx 61; rules.ts 64; api.ts 48; types.ts 25; styles.css 82; main.tsx 5. Total 905 physical lines; dense JSX means refactor surface is larger than this number suggests.
- App owns session, global mutation exclusion/feedback, selected tab, blockchain polling/time, linked wallet eligibility and sessionStorage transaction journal; AuthForm is nested. AccountPanel combines account, wallet linking, mock KYC and on-chain verification. AdminPanel combines actual contract role queries, wallet lookup and mutations.
- OrdersPanel combines paginated polling, query-string selection, immutable draft creation, terms/detail, all contract actions, files/hash verification and events. Split these responsibilities; retain guards and externally visible behavior.
- wallet.ts combines injected-provider discovery/hook, RPC, contract factory, preflight/receipt tracking and error translation. api.ts combines fetch, binary downloads, health and session storage. These are infrastructure boundaries; typed feature services are missing.
- Existing strengths: sessionStorage per tab, stale-token 401 expiration guard, effect cleanup, exact bigint arithmetic, canonical UTF-8 terms SHA-256, deployment fingerprint check, pending staticCall, account/chain recheck before signing, replacement transaction receipt handling, authenticated verified downloads and explicit buyer inspection acknowledgment.
- Gaps: hardcoded targets, no typed endpoint service layer, no robust transport parsing/error normalization, caller signal replaces timeout, no stale wallet refresh generation guard, no order search/filter, list/details/events polling coupled, event pagination absent, frontend total-byte quota check absent, basic dense interface and generic API English errors.
- Deep link currently ?order=UUID and history.replaceState; remount reads it, but App initially opens account tab. A refactor should open the corresponding order workspace and preserve navigation state safely.
- Session-dependent panels use key=session.user.id, clearing state on account change. App only refreshes linked wallet while AccountPanel mounts; moving global linked-account readiness into session infrastructure avoids stale eligibility after leaving account view.
- Existing tests: rules.unit.ts has eight domain cases; wallet-selection.e2e.ts uses mocked provider + unavailable health and checks permission rejection/account change without session mutation; browser.e2e.ts uses injected prompt simulation with actual Hardhat transactions/API/SQL for role/KYC/file/settlement/dispute/wrong-wallet/network flows.
- Browser tests depend on Vietnamese accessible names and a few selectors (.connection .mono[title], .order-detail, .banner, order-state/delivery-match test IDs). Preserve stable selectors or migrate tests intentionally. E2E global setup owns a Vite server on 5174; default channel chrome, override PLAYWRIGHT_CHANNEL.
- Initial git status: only untracked .reports/; no pre-existing tracked modifications. Scope implementation to frontend and documentation unless separately justified.

## Exact integration contracts and authority

JSON uses camelCase. UUIDs/addresses/hashes/order IDs/wei are strings; unix deadlines/windows/block numbers are numbers; timestamps are ISO strings. Every endpoint except auth and health requires Bearer JWT. Error shape is {code,message,traceId}; backend model validation intentionally supplies a general VALIDATION_ERROR, not a field dictionary. 401 expires only the request's still-current token; 429 means rate limited (auth 20/min/IP, wallet/KYC 30/min/user, orders 240/min/user). There is no refresh/logout endpoint.

| Method/path | Request | Success |
| --- | --- | --- |
| POST /api/auth/register | {email,fullName,password}; email <=254, fullName 2..100, password 10..128 | 201 {accessToken,tokenType,expiresAt,user:{id,email,fullName,createdAt}} |
| POST /api/auth/login | {email,password}; email <=254, password <=128 | 200 same auth response |
| GET /api/users/me | None | {id,email,fullName,createdAt} |
| GET /api/wallets/me | None | {linked,address:null|string,chainId:null|number,linkedAt:null|ISO} |
| POST /api/wallets/challenges | {address,chainId}; 42-character valid address, allowed chain | {challengeId,address,chainId,message,expiresAt} |
| POST /api/wallets/link | {challengeId,signature}; 132-character signature | Wallet response |
| GET /api/kyc/me | None | KYC response below |
| POST /api/kyc/submissions | {fullName,studentNumber,documentReference,selfieReference} | KYC response below |
| POST /api/orders | {seller,arbiter,description,acceptanceCriteria,amountWei,deliveryDeadline,reviewWindow} | 201 OrderView below |
| GET /api/orders?skip=N | Offset >=0, backend clamps negative to zero | OrderView[]; newest createdAt then id, maximum 50, no total count |
| GET /api/orders/{draftUuid} | None | OrderView |
| GET /api/orders/{draftUuid}/events?skip=N | Offset, negative clamped | ChainEvent[] maximum 100, oldest block/log first |
| POST /api/orders/{draftUuid}/files | Multipart kind=product or evidence and file | {id,kind,fileName,length,sha256,createdAt} |
| GET /api/orders/{draftUuid}/files/{fileUuid} | None | Attachment application/octet-stream, nosniff/no-store |
| GET /api/health/live | None | {status,component,stage}; liveness only |
| GET /api/health/ready | None | 200 or 503 {status,component,stage}; database/schema readiness |
| GET /api/health/blockchain | None | 200 Ready or 503 non-ready payload below |

KYC response: {status,isMock,walletLinked,walletAddress,maskedStudentNumber,reasonCode,submittedAt,reviewedAt,onChainVerificationStatus,canCreateEscrow}. Status NOT_SUBMITTED/VERIFIED/REJECTED. isMock=true; onChainVerificationStatus=NOT_IMPLEMENTED and canCreateEscrow=false are legacy mock-layer facts, not direct contract authorization. StudentNumber pattern ^DEMO-[A-Z0-9-]{3,24}$; fullName 2..100; documentReference only DEMO-DOCUMENT-PASS/FAIL; selfieReference only DEMO-SELFIE-PASS/FAIL. Both PASS verify immediately, failed fixture rejects with reason; rejected can resubmit, verified cannot. Wallet required. Mock is development-only.

Wallet challenge binds account/domain/address/chain/nonce/expiry; sign EXACT returned message. Single-use challenge default 5-minute expiry; account and wallet each permanently linked once. API accepts configured 31337/11155111 for linking, but actual escrow/frontend only support local 31337; do not enable Sepolia escrow. Check challenge address/expiry, assert selected account and chain before/after signature. No keys/seed input.

OrderView: {draft,chain:null|ChainOrder,termsMatch,syncStatus,lastIndexedBlock,checkedAt:null|ISO,files:FileSummary[],deliveryFileMatchesChain}. Draft: {id,buyerUserId,deploymentId,buyer,seller,arbiter,description,acceptanceCriteria,amountWei,deliveryDeadline,reviewWindow,clientReference,termsJson,termsHash,createdAt}. ChainOrder additionally contains deploymentId,clientReference,buyer,seller,arbiter,amountWei,termsHash,deliveryDeadline,reviewWindow,reviewDeadline:null|number,deliveryHash:null|string,state,buyerRefundWei,sellerNetWei,platformFeeWei,orderId. ChainEvent: {deploymentId,transactionHash,logIndex,blockNumber,blockHash,name,orderId:null|string,payload:string}.

Blockchain health fields when available: {status,deploymentId,chainId:string,contractAddress,deploymentBlock,deploymentBlockHash,lastIndexedBlock:null|number,checkedAt:null|ISO,confirmations}. Important: manifest chainId is a STRING, unlike linked-wallet chainId number. Disabled/unavailable responses may contain status only. Statuses include Ready, Syncing, Stale, Unavailable, InvalidDeployment, Disabled; per-order additionally Archived. >30-second worker staleness blocks writes.

Draft rules: linked wallet supplies buyer; three distinct nonzero valid wallets, no seller/arbiter=contract. Description/criteria nonblank <=4000; amountWei canonical positive integer 1..10^38-1; deadline future at API and contract create; review 1..31536000 sec. Draft immutable, create does not transact or require mock KYC. Backend can persist a future-to-API draft already expired on chain; frontend validates both clocks. Canonical termsJson includes version=1, numeric chainId, contract/deployment/reference/parties/content/wei/deadlines/feeBps=100; SHA-256 the exact string, never reserialize before hashing.

List/read/file access follows JWT user's linked wallet address AND deployment chain; buyer/seller/arbiter can read. Unrelated users receive 404; unlinked users receive 409 WALLET_REQUIRED. Archived orders/files remain readable. No order update/delete, public marketplace, server search, admin REST, transaction submission REST or client-reported payment-state endpoint exists.

| Contract mutation | Actor / state / inclusive deadline | Result |
| --- | --- | --- |
| createOrder(seller,arbiter,amountWei,clientReference,termsHash,deliveryDeadline,reviewWindow) | Buyer; buyer AND seller verified; future deadline | Created |
| deposit(orderId,{value:BigInt(amountWei)}) | Buyer; Created; both verified; <=deliveryDeadline; exact amount | Funded |
| markDelivered(orderId,product.sha256) | Seller; Funded; <=deliveryDeadline; nonzero hash | Delivered; reviewDeadline=chain time+reviewWindow |
| confirmReceipt(orderId) | Buyer; Delivered; <=reviewDeadline | Completed |
| raiseDispute(orderId) | Buyer or seller; Funded <=deliveryDeadline OR Delivered <=reviewDeadline | Disputed |
| refundIfExpired(orderId) | Buyer; Funded; strictly >deliveryDeadline | Refunded |
| claimAfterReviewTimeout(orderId) | Seller; Delivered; strictly >reviewDeadline | Completed |
| resolveDispute(orderId,sellerShareBps) | Assigned arbiter; Disputed; 0..10000 integer bps | Resolved |
| setWalletVerified(address,bool) | KYC_ADMIN_ROLE | Verification flag |
| grantRole/revokeRole(KYC_ADMIN_ROLE,address) | DEFAULT_ADMIN_ROLE | KYC admin permission |

Frontend gates additionally require Ready current deployment, Ready projection, matching terms and selected=linked local wallet; confirm also requires server deliveryFileMatchesChain and inspection acknowledgment. Product must exist before deliver. Revocation affects create/deposit only; do not block funded settlement. Administrator is not automatically arbiter. No automatic timeouts; terminal states never transition. Refund 100% through arbitration is Resolved. Settlement bigint: gross=floor(amount*bps/10000), fee=floor(gross/100), seller=gross-fee, buyer=amount-gross; 0% and 100% valid; gas separate.

Product: one immutable nonempty ZIP <=50,000,000 bytes, seller only while Funded; cannot replace/delete. Evidence: PNG/JPG/JPEG/PDF <=5,000,000 each, <=5 total buyer+seller, Funded/Delivered/Disputed; arbiter read-only. Total <=75,000,000; filename safe 1..150 chars. Backend validates content structure and transactionally locks quota. Upload returns server SHA-256; compare local bytes before allowing delivery. Download with JWT, hash-check bytes before save; never execute/render uploaded content. Backend attachment headers alone cannot replace frontend hash validation.

Preserve sendTransaction sequence: fresh health/deployment, selected wallet chain/account, deployment block hash via injected RPC, contract code exists, signer, pending staticCall, recheck wallet, submit, record pending, wait receipt with replacement/cancel handling, require status=1. Poll API projection after confirmation; hash alone never updates escrow state.

## Commands, availability and handoff

- Observed Node v24.11.0/npm 11.6.1 fits declared >=22.13 <23 or >=24 <25. Frontend React/react-dom 19.3.0, ethers 6.17.0, TS 5.9.3, Vite 8.3.3, React plugin 6.1.2, Playwright 1.63.0 are pinned; no installed frontend/node_modules or blockchain/node_modules at scout time. Dependency install is required before build/tests.
- No listener reported by Get-NetTCPConnection for 1433/5180/8545/5173/5174; no blockchain/deployment/local/latest.json. No .runtime/dotnet/dotnet.exe at that checked path (not proof no global/other SDK exists). Real integration is currently unavailable; no tests were run in this phase.
- Frontend commands in frontend/: npm.cmd ci; npm.cmd run build (tsc --noEmit + Vite); npm.cmd test (Playwright Node unit files, no browser/service); npm.cmd run dev; npm.cmd run preview; npm.cmd run test:e2e (Vite 5174, Chrome default, real services required for browser.e2e.ts).
- Blockchain commands in blockchain/: npm.cmd ci; npm.cmd run build; npm.cmd run typecheck; npm.cmd test; npm.cmd run node; separate terminal npm.cmd run deploy:local. ABI export after contract changes only; contract changes unnecessary for this frontend scope.
- Backend from root: powershell -ExecutionPolicy Bypass -File .\scripts\dotnet.ps1 restore StudentEscrow.slnx; same wrapper build StudentEscrow.slnx --no-restore; powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -NoBuild -Blockchain. SQL connection and migrations required; ephemeral development JWT means re-login after API restart.
- Integration validation should preserve existing domain tests and add focused transport/cancellation/stale-token/wallet race checks where behavior changes. Browser selectors can migrate, but assertions must keep real contract/API safeguards. Do not claim real E2E success with absent SQL/RPC.
- Implementation boundaries: refactor frontend/src into app composition, feature modules, HTTP/wallet infrastructure, shared domain/UI; preserve compatibility exports for rules/types/wallet/api until tests/imports migrate. Keep package stack; do not invent data or endpoints. Config public targets via Vite proxy/env, never client secrets. Vietnamese UI, English code/comments/docs reports. Update frontend/README.md with actual final tree, commands/config and honest demo limits.
