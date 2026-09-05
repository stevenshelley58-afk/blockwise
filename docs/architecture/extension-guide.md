# Extension guide

Start with the smallest owning layer:

1. Put configuration-only wording and customer navigation in
   `src/config/niche/blockwise.ts`. Each navigation item is plain data with
   `{ href, label, icon, mobileLabel?, section?, feature? }`.
2. The item names and icon union live in `src/config/niche/niche.ts`. The
   structural icon map is in `src/components/sidebar-nav.tsx`; add an icon
   there before referencing a new icon name in niche data.
3. Customer navigation is rendered through native Next `Link`/`NextLink` and
   the shared active-route helper, including nested-route matching. Keep the
   mobile bar to five configured items; additional destinations appear under
   the configured `plusMore`/“More” affordance. Reuse the existing command menu
   and mobile bottom navigation rather than adding a second metadata source.
4. Reuse `src/components/ui/` and existing AdStudio components for customer UI.
   Put workspace/provider reads and writes behind `src/lib`; preserve auth,
   RLS, and provider-token RPC rules. Keep the normal customer flow plain and
   hide campaign/ad-set/placement jargon behind an optional advanced path, while
   retaining exact external-provider labels where connection instructions need
   them and never hiding budget, location, approval, or legal details.
5. Change template contracts/renderer packages only when the layered pack
   contract changes. Frank remains the pack owner.

Adding a new Frank project belongs in the Frank project registry under
`/projects/frank`; Blockwise is not a dynamic project platform. Blockwise
workspace editing, settings, and team management are separate customer
product concerns.

For a new niche, add a narrow config module and tests rather than copying the
product shell. For a new tool, define its input/output contract, workspace
scope, failure state, and customer/operator audience before adding UI. Do not
build a CRM, reprice the product, add integrations, or change Frank templates
for ordinary product polish. Keep provider writes approval-gated and never make
a local mock an acceptance claim.

Run `npm run check:nul`, `npm test`, `npm run typecheck`, and `npm run build`.
The runner discovers `.test.ts`, `.test.tsx`, and `.test.mjs` recursively. Use
`.test.tsx` for tests importing React components or requiring TypeScript
transformation; ordinary `.test.ts` tests use native Node stripping.
For release evidence, follow the production-readiness runbook.
