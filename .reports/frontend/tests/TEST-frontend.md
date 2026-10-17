# Frontend verification

Date: 2026-10-17. Read CORE, Debugging verification guidance, frontend plan, implementation handoff and final source. No application implementation files changed by tester.

## Executed results

Commands ran in frontend directory:
- `npm.cmd run build`: PASS after final signing guard fixes, TypeScript and Vite, 196 modules. Final JS 554.49 kB / gzip 183.68 kB. Existing Vite >500 kB warning remains.
- `npm.cmd test`: PASS, 13 tests (8 existing domain tests, 5 new HTTP tests).
- `npx.cmd playwright test tests/wallet-selection.e2e.ts tests/workspace-smoke.e2e.ts tests/signing-races.e2e.ts`: PASS, 9 Chrome tests.
- Listener check `Get-NetTCPConnection -State Listen` filtered to 5180, 8545, 1433: no matching listeners.

HTTP tests verify backend status/code/message/trace preservation, malformed and empty success rejection, 204 handling, accepted 503 readiness payload, exact binary bytes, multipart boundary ownership, timeout with caller signal, distinguishable caller abort, and stale 401 versus replacement login expiry.

Existing domain tests verify exact wei and fee rounding, inclusive delivery/strict refund deadlines, review deadlines, assigned arbiter, confirmation ZIP hash gates, stale/deployment/terms write gates, file count and immutable product gates, and canonical raw terms hash binding.

Browser tests verify existing wallet permission rejection/reselection without losing auth context; mocked login/logout; account/admin/orders navigation and accessible labels; unavailable-wallet mutation gates; loaded-page local filtering/reset; actual skip=50 request and appended row; no document horizontal overflow at 375 and 1440 pixels for orders/account; protected pending read discarded on logout; real OrderFiles component refuses a downloaded payload with mismatched recorded SHA-256.

Review follow-up added four mocked signing races: replace EIP6963 provider with same account/chain while wallet challenge is held (zero personal_sign requests); logout while personal_sign is pending (zero wallet-link POSTs); logout during pending staticCall (zero eth_sendTransaction); logout during ethers internal eth_estimateGas (zero eth_sendTransaction). Transaction cases use actual App/OrderActions/sendTransaction with canonical fixture terms and mocked API/RPC/EIP1193. These confirm the final provider dispatch scope guard, not real-chain behavior.

Real integration test selectors migrated without removing escrow assertions: await authenticated session then account navigation after registration, preserve details open state and UUID input label, current admin navigation and mandatory target lookup, translated KYC status badges and current upload button label. This test was typechecked but remains unexecuted. Frontend README now requires target Tra cứu before administrative writes.

## Screenshots and limits

Screenshots use MOCKED API data, not a live backend:
- `screenshots/orders-375.png`
- `screenshots/orders-1440.png`
- `screenshots/account-375.png`
- `screenshots/account-1440.png`

Screenshots capture viewport, not full long pages. Root orchestrator performs visual review separately. Browser smoke uses Vite and installed Chrome; isolated file component harness imports Vite source modules and mocked file response. Browser tests explicitly say mocked.

Full `browser.e2e.ts` requires real SQL/API/worker/RPC/deployment. It was not run because no corresponding service listeners were available. No real escrow integration, deployed contract transaction, extension popup, upload-server behavior, pending blockchain race or live draft submission success is claimed. Draft UI constraints and all upload limits were inspected in source; only domain amount/hash/quota guards and downloaded hash mismatch were executed. 768px and additional accessibility audits remain unexecuted.

Initial screenshot output into .reports via Node mkdir hit EPERM; writing into ignored frontend/test-results succeeded and PowerShell copied the four final screenshots into this report directory. Initial isolated harness imported CommonJS prebundle as named exports and failed; corrected default imports and variable source paths, reran browser suite and final build successfully. Signing fixture errors (wrong orders response shape and missing challenge chainId) were corrected before final successful run. Reviewer identified async signing defects; owning engineers fixed them and the four new signing race checks pass on final source.

Added files: frontend/tests/http.unit.ts, frontend/tests/workspace-smoke.e2e.ts and frontend/tests/signing-races.e2e.ts. Existing domain/wallet tests preserved; real E2E migrated. Generated frontend/test-results and dist remain ignored.
