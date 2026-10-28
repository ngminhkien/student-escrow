# StudentEscrow — monochrome workspace

Direction derived from the local `ui-ux-pro-max` skill and its verified **Minimalism & Swiss Style** result. Stack guidance: React forms and accessible interaction. The generic palette, marketing-page pattern and editorial body font returned by the search do not fit this app; the user's white/black preference takes priority.

## Product

Vietnamese web workspace for service escrow. Buyer and Seller are roles within each order. The configured admin account has a separate management workspace. Preserve wallet checks, transaction preflights, upload permissions and disabled states.

## Visual system

- White workspace, near-black navigation and primary controls, neutral gray surfaces. All RGB channels must match: no colored status accents or gradients.
- Typography: Inter when available, Segoe UI and system sans-serif fallbacks with Vietnamese support. Body 16px; supporting labels 12–14px; page headings 30–36px. Use monospace only for addresses, hashes and IDs.
- Spacing: 4, 8, 12, 16, 24, 32, 48px. Consistent 8–16px radii. Subtle separators; no ornamental shadows.
- Maximum content width 1280px. Sidebar on desktop, compact header/navigation on smaller screens.
- State is conveyed with text, icon shape, border or emphasis, never color alone.

## Information hierarchy

1. Page and account identity.
2. Wallet readiness, current balance and gas price.
3. Buying/selling context and metrics calculated only from loaded orders.
4. Order workflow and the next action; file upload before delivery confirmation.
5. Terms and participants in a secondary summary; hashes and environment diagnostics in disclosure sections.

## Interaction and accessibility

- Native buttons, labels and form submission. Minimum 44px control height, 16px mobile inputs.
- Every page has one clear primary task; disputes and diagnostics are secondary.
- Visible keyboard focus, descriptive control names, contextual live feedback and reduced-motion support.
- Keep essential IDs available in full and wrap long tokens; provide an actual copy-order-ID action.
- Show genuine empty/loading/error states. Do not invent balances, counts, messages, charts, navigation destinations or transaction progress.
- Verify at 375, 768, 1024 and 1440px, landscape, text zoom and keyboard navigation.

## Assets and implementation

Use the existing SVG icon family, extended consistently as needed. No new runtime dependencies, remote fonts, generated images or animation library are required. Keep one stylesheet with semantic tokens rather than additional override layers.
