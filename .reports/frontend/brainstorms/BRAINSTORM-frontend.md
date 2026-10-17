# Frontend Requirements Discovery

The user requests a thorough understanding of the existing project followed by a professional frontend implementation, with maintainable folders, architecture, and real API integration. The underlying goal is to turn the existing functional demo into a polished, understandable application without weakening its escrow safeguards.

## Evidence and scope

- Root README defines StudentEscrow as a local student-service escrow demo: ETH test, one-payment static landing-page work, buyer/seller/arbiter/admin roles.
- `frontend/README.md` documents an existing React + TypeScript + Vite + ethers frontend with functional authentication, wallet/KYC, orders/files, contract transactions, admin verification and dispute resolution.
- `frontend/package.json` already establishes the stack and build/unit/E2E commands. This is an improvement/refactor of the existing frontend, rather than a separate application.
- `backend/ORDERS.md` defines immutable drafts, authenticated files, SHA-256 validation, SQL projections, pagination, deployment archival and transaction authority.
- `frontend/src/api.ts`, `types.ts`, `rules.ts` and `App.tsx` establish API errors, per-tab JWT sessions, accurate wei/bps arithmetic, transaction tracking and role/deadline gates that must survive the redesign.
- The existing documentation specifies a restrained white/black interface. Use a professional monochrome treatment with strong hierarchy and responsive navigation unless later user steering changes this preference.
- AI analytics, actual identity verification, Sepolia, production hosting and marketplace endpoints do not exist and must not be presented as implemented.

| Stakeholder | Required outcome |
| --- | --- |
| Buyer | Understand terms, create/fund escrow, inspect delivery, accept/dispute or recover funds after deadline |
| Seller | Find relevant orders, upload final ZIP, deliver with its hash, submit evidence and claim eligible settlement |
| Arbiter | Read authorized order/files and resolve disputes with an exact settlement preview |
| Contract administrator | Verify/revoke wallets and manage KYC admin privileges according to contract roles |
| Developer/demo operator | Maintain feature boundaries, run documented commands and diagnose API/chain readiness clearly |

## Requirements and acceptance criteria

| ID | Requirement and measurable acceptance criterion | Priority |
| --- | --- | --- |
| FR01 | Preserve registration, login, profile and logout against existing endpoints. Display field validation, pending state and useful API failures. | Must |
| FR02 | Keep per-tab session storage, expiration handling, and the guard preventing an old 401 from signing out a newly authenticated account. | Must |
| FR03 | Support wallet connect/change, local network selection, signed one-time challenge linking and live account/chain-change handling. Never request keys or seed phrases. | Must |
| FR04 | Display linked wallet, selected wallet, network and service readiness distinctly; block incompatible actions before signing. | Must |
| FR05 | Support existing mock KYC submission and status/rejection feedback; explicitly distinguish mock verification from on-chain verification. | Must |
| FR06 | Provide an order workspace with searchable/filterable current results, pagination using real API skip parameters, useful empty/error states and direct order opening. | Must |
| FR07 | Create immutable drafts with seller/arbiter addresses, description, acceptance criteria, exact ETH amount, delivery deadline and review duration. Validate before request and explain the signing steps. | Must |
| FR08 | Preserve create, deposit, deliver, confirm, dispute, resolve, timeout refund and timeout claim transactions, with role/state/deadline gates and deployment preflight. | Must |
| FR09 | Show readable lifecycle, parties, terms, deadlines, amounts, file metadata and events for each order. Archived or mismatched orders remain readable and cannot mutate. | Must |
| FR10 | Enforce product ZIP <=50,000,000 bytes, evidence <=5,000,000 bytes each, <=5 evidence files, <=75,000,000 bytes total, and immutable product rules. Backend remains final authority. | Must |
| FR11 | Download through authenticated API, verify SHA-256 before delivery download, and require explicit buyer inspection acknowledgment before acceptance. Do not execute/render uploaded products. | Must |
| FR12 | Show transaction pending/confirmed/failed/rejected status and receipt checks; derive escrow state from API projection, never optimistic client state or tx hash alone. | Must |
| FR13 | Preserve administrator verification/revocation and KYC-admin grant/revoke with actual contract role checks, without inventing JWT administrator privileges. | Must |
| FR14 | Show exact integer-based arbitration split and 1% seller-side fee preview, including 0% and 100% cases. | Must |
| NFR01 | Organize application composition, feature modules, shared UI, API infrastructure, wallet integration and domain types/rules coherently; remove root-level panel coupling where appropriate. | Must |
| NFR02 | Centralize typed endpoint services, JSON/multipart/download handling, abort/timeout behavior and consistent error normalization. Support configurable local API/RPC targets without broad backend CORS changes. | Must |
| NFR03 | Provide Vietnamese user-facing text, English code/comments, accessible labels, keyboard navigation, visible focus, live feedback, contrast and layouts usable at 375px and 1440px. | Must |
| NFR04 | Preserve existing dependency stack where feasible; avoid changing backend/contract semantics or adding libraries that require unavailable network access. | Must |
| NFR05 | Build and existing unit suites pass. Update existing browser tests only where navigation/accessible UI changes require it; attempt real integration only with available backend/SQL/Hardhat and state blockers honestly. | Must |
| NFR06 | Update frontend README with final folder responsibilities, configuration, commands and remaining operational limits. Do not claim production readiness or unrun end-to-end checks. | Must |

No business clarification blocks local frontend implementation. Repository documentation supplies the domain, roles, APIs, stack, visual baseline and safety constraints. A developer may choose routine component/layout organization within these requirements. Service availability and installed dependencies must be checked in the subsequent repository analysis phase; inaccessible SQL/RPC is a verification constraint, not permission to fabricate data.
