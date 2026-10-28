# Orders and transaction pages

User-requested simplification, building on the monochrome master and the local UI/UX skill's deep-linking, browser history, and progressive-disclosure guidance.

- List page: buying/selling tabs, search, status filter, amount, delivery date and open action. No summary metric cards or transaction controls.
- Transaction page: its own `?order=<draft UUID>` URL. Keep browser Back/Forward, reload and deep links working. Preserve list filters when navigating within the mounted workspace. Clicking the order title supports native browser open-in-new-tab behavior.
- Creation page: `?create=1`; navigate to the transaction after the draft is saved.
- Compact wallet status remains visible; balance, gas and diagnostics are under “Số dư & kết nối”. Wallet mismatch warnings and disabled controls remain visible and enforced.
- Show the order's status, progress, product and current action. For terminal orders, show actual settlement amounts before the product.
- Put rules, step guidance, participants, hashes, synchronization and transaction events in native disclosure controls. Preserve consent checkboxes, deadline checks and transaction safeguards.
- Desktop: primary transaction column and secondary agreement summary. Mobile: one column with a compact five-step indicator. White, black and neutral gray only.

Reference patterns (structure only; no exchange branding or assets):
- OKX P2P orders → specific completed order / detail page: https://www.okx.com/en-us/help/how-do-i-download-a-p2p-order-receipt
- Bybit order history → individual order details: https://www.bybit.com/en/help-center/article/The-differences-between-trade-history-and-order-history?category=50e323f3535c1f4e7b
