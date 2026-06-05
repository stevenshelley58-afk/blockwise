# Landing Page Spec — v3.2 (implemented)

Status: **implemented in app** · Owner: Steven · Date: 2026-06-04
This spec is reference material, not a rulebook. Steven owns the page — copy, CTAs and sections can be edited freely; nothing in this document requires sign-off or blocks a change.
Design source of truth: `stitch/` ("Executive Precision" — DESIGN.md tokens, code.html, screen.png)
Implementation: `src/app/page.tsx` + `lp-*` styles appended to `src/app/globals.css`

---

## 1. What shipped (v3.2)

The stitch export was the design source; it was truncated (trial cards empty, no FAQ/managed-setup/footer) and not app-aware. Implementation decisions:

- **Ported to the app's plain-CSS system** (namespaced `lp-*` classes appended to `globals.css`) — no Tailwind dependency added. Manrope headlines via the existing `--font-manrope` (already loaded in `layout.tsx`).
- **Wired to real flows:** all primary CTAs are `CtaLink` → `/signup` with analytics locations (`nav`, `hero`, `radar-scan`, `radar-use-angle`, `control-table`, `trial`, `faq-walkthrough`); `SignInLink` → `/login` (label "Client sign in" → "Log in"); managed setup reuses the live `DemoForm` (Meta-pixel intent still fires on `#demo` CTAs); footer links only to real routes (`/privacy`, `/terms`, `/data-deletion` + section anchors).
- **Completed the truncated sections** from earlier spec content: trial fact cards (7 days / 10 campaigns / No card / Connect anytime), FAQ (6 questions), managed setup section, 3-column footer with no dead links.
- **Stitch deviations:** hero CTAs say "Create your first campaign" / "See example campaign" (stitch's "Create ad" broke the settled campaign terminology); remote placeholder images replaced with `/ads/*.jpg`; radar uses fictional agencies (Coastline Property, Hillview Agents, Northstar Realty — fictional names keep invented ads from being pinned on real brands); radar "Change" location link is decorative pending a real picker.
- **Metadata updated** (`layout.tsx`): replaced the dead "More listings. Nothing hidden. / Blockwise runs Meta ads…" title/description with platform positioning + trial terms.
- Demo form label → "Suburb you want to advertise in" (was "…want listings in" — read as a lead-gen promise).
- **Verification:** JSX syntax-checked and full-page rendered via an isolated harness (zero page errors; screenshot reviewed). The Cowork sandbox's repo mount serves stale file views, so run `npm run typecheck` and `npm run dev` on the real machine for final confirmation. App pages the sandbox flagged "broken" were verified intact on the real filesystem.

## 2. Product facts reference

Handy when writing or editing copy: what the product does today, with code sources. Reference only — not a gate.

| Claim | Source |
|---|---|
| 7-day trial, no card, 10 campaign generations, email-confirm gate | `202606040004_self_serve_trial.sql`; `generation-trial.ts:79`; `rate_limits limit_count=10` |
| Brief = campaign type + suburb + goal + photo + notes | `FirstAdInput` (`types.ts`); `POST /api/adstudio/campaigns` (`goal`, `suburb`) |
| Campaign templates: Just Listed, Coming Soon, New to Market, Open Home, Just Sold, Price Update, Market Update, Free Appraisal, Buyer Demand, Seller Checklist | `src/lib/adstudio/templates.ts` |
| Up to 8 variants/angles; formats 1:1, 4:5, 9:16 (+1.91:1) | `generator.ts`, `types.ts` |
| One lead form per campaign (questions, privacy, thank-you screen) | `metaLeadAdPackSchema` (`types.ts:196-212`) |
| Publish flow exists; live writes flag-gated | `publish/route.ts:57,145` |
| Budget actions + pacing (activate, pause, increase_budget) | `202605280001_meta_execution_layer.sql:73`; `BudgetPacingChart.tsx` |
| Reporting inside Blockwise (KPIs, ad performance, pacing, suburb breakdowns) | `src/components/monitor/` |
| Lead inbox (quality labels, dedupe) | `/leads` route |
| Ad radar: search live AU real-estate ads by postcode/suburb/page/ad copy; longest-running sort; save-as-template; trial-accessible | `(customer)/ad-radar/page.tsx`; `template-gallery-modal.tsx`; `canAccessSurface` |
| Compliance checks flag issues; team owns final sign-off | `compliance.ts` — never claim "every campaign is compliant" |
| After trial: generation pauses (402), drafts stay | `generation-trial.ts` |
| Managed setup: 15-min call, reply in 1 business day | `demo-form.tsx` |

**Accuracy notes (FYI):** not in the product yet — CRM routing, lead volume/cost guarantees, a pricing page, listing-URL import, budget/ad-account as brief fields, a lead-form library. Live publishing is flag-gated (§3). Mock ads use fictional agency names.

## 3. Provider-writes status (context, not a gate)

Live provider writes are controlled by `BLOCKWISE_ENABLE_PROVIDER_WRITES` (while false, the publish route returns "Live provider writes are disabled." for non-dry runs). Copy that mentions launching/publishing assumes the flag is on. Optional softer strings if you want them while it's off: hero "Create real estate ad campaigns from one platform."; step 4 "Connect your ad account when you're ready to run, and track performance inside the app."; dashboard status pill "Awaiting approval". Ship whenever you like.

## 4. Remaining alignment items

1. Signup page sub-copy still says "Create your first listing ad before connecting Meta." — optionally align to "7 days, 10 campaigns, no card required." (left as-is per current file state).
2. In-app terminology PR: first-run explainer "1 of 10 free ad packs" → "campaigns" (`first-run-explainer.tsx`); start-choice "Create first ad" → "Create first campaign".
3. "Local Ad Radar" (marketing) vs in-product "Research" naming — align whenever convenient.
4. Nav/footer "Pricing" intentionally absent until a pricing page exists.
5. Trial publish cap (1 campaign) — add to FAQ when writes go live.
6. Old landing artifacts can be deleted: `landing-demo.html`, `landing-preview.html` (repo root), `blockwise_landing_build/` once this is approved.
