# Frontend independent review

Date: 2026-10-17. Final verdict: **APPROVED for the implemented local-demo frontend scope**, with real integration validation still dependent on unavailable SQL/API/RPC/deployment services. No unresolved blocker identified after correction review and affected tests.

Inputs: complete frontend plan, scout/domain constraints, final frontend source, original and migrated integration tests, final TEST-frontend.md. Reviewer changed only this report; engineers own source corrections and tester owns executed checks.

## Findings resolved

1. **Permanent wallet linking could outlive session/provider identity.** Original AccountPage captured BrowserProvider before the challenge await, signed through an obsolete provider after EIP-6963 replacement, and could POST link after logout during the signature prompt. Final `features/account/AccountPage.tsx:54` pins exact provider, guards mounted lifecycle/token/account/generation, aborts link HTTP on disposal, validates challenge address/chain/expiry, reasserts wallet around signing and refuses stale final POST/result. Regression: same-address provider replacement produces zero personal_sign; logout during signature produces zero wallet-link POST.

2. **Transaction could prompt after originating order/admin scope became obsolete.** Final `features/orders/OrderActions.tsx:18` propagates mount/token/account/deployment/order/canSign assertion through sendTransaction. Final `features/admin/AdminPage.tsx:61` captures target/account/deployment/status/mount generation and propagates its assertion independently of JWT. Final `infrastructure/wallet/transactions.ts:21` checks caller scope and pinned provider after pre-submit awaits. An additional ethers internal estimateGas await was confirmed in installed signer source; final BrowserProvider request wrapper checks synchronously at the actual signing/submission dispatch. Regression: logout during staticCall and during ethers estimateGas both produce zero eth_sendTransaction. Read RPC and already-submitted receipt/journal processing intentionally continue.

3. **Original real E2E assumptions no longer matched redesigned navigation/gates/labels.** Final `tests/browser.e2e.ts` waits for authenticated state before account navigation, expands UUID disclosure only when closed, uses current input/admin/upload labels and translated KYC status, and explicitly looks up target before admin writes. Existing real settlement/hash/state/permission/deadline assertions remain. Test is typechecked; real execution remains unrun. Frontend README now documents required lookup and correct navigation.

## Plan and safety assessment

- App/features/services/HTTP/wallet/domain boundaries match the plan. Existing pinned dependencies and compatibility exports retained; no unnecessary new library.
- Transport preserves backend status/code/message/trace, rejects malformed/empty JSON, composes cancellation with timeout, supports authenticated binary/multipart, preserves health 503 payload, and protects new session from stale 401.
- Queries guard identity/generation, cancel disposed reads, retain prior data with explicit refresh errors, and independently paginate actual 50-row/100-event offsets. Search/filter scope is clearly local to loaded data.
- Exact wei/bps arithmetic and inclusive/strict deadlines retained. Assigned arbiter, current deployment/projection, original canonical terms hash, server delivery-file hash and buyer inspection gates retained. Funded settlement remains possible after verification revocation; create/deposit contract preflight enforces current verification.
- Immutable nonempty product ZIP, evidence count/size and aggregate quotas retained. Upload compares local/server SHA-256; product mismatch persists per user/order and blocks delivery. Authenticated download verifies byte length/hash before save. Uploaded content is not executed/rendered.
- Admin uses actual contract roles, independently of JWT. Receipt success/replacement/cancel handling retained; order state changes only through API projection.
- Semantic landmarks, labels, focus/skip link, live feedback, responsive layout and reduced-motion rules are present. Executed browser evidence covers 375/1440 only; no executed 768px or comprehensive accessibility audit claimed.
- Endpoint DTOs are compile-time types, with JSON syntax validation and selected health/session guards; comprehensive runtime endpoint schemas are not implemented. Unexpected valid JSON shape remains a robustness limitation, without a demonstrated unchanged-backend contract defect.

Final tester evidence: TypeScript/Vite build PASS, 13 unit tests PASS, 9 mocked Chrome browser tests PASS, including all four signing races. Bundle remains above Vite 500 kB advisory threshold (554.49 kB). Real SQL/API/worker/Hardhat escrow E2E, actual extension popup and server upload integration remain unverified because required services were unavailable. This approval does not assert production readiness or real escrow integration success.
