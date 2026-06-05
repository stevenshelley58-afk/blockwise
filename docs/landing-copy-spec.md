# Landing Page Spec — v3.2 (implemented)

Status: **implemented in app** · Owner: Steven · Date: 2026-06-04
Design source of truth: `stitch/` ("Executive Precision" — DESIGN.md tokens, code.html, screen.png)
Implementation: `src/app/page.tsx` + `lp-*` styles appended to `src/app/globals.css`

---

## 1. What shipped (v3.2)

The stitch export was the design source; it was truncated (trial cards empty, no FAQ/managed-setup/footer) and not app-aware. Implementation decisions:

- **Ported to the app's plain-CSS system** (namespaced `lp-*` classes appended to `globals.css`) — no Tailwind dependency added. Manrope headlines via the existing `--font-manrope` (already loaded in `layout.tsx`).
- **Wired to real flows:** all primary CTAs are `CtaLink` → `/signup` with analytics locations (`nav`, `hero`, `radar-scan`, `radar-use-angle`, `control-table`, `trial`, `faq-walkthrough`); `SignInLink` → `/login` (label "Client sign in" → "Log in"); managed setup reuses the live `DemoForm` (Meta-pixel intent still fires on `#demo` CTAs); footer links only to real routes (`/privacy`, `/terms`, `/data-deletion` + section anchors).
- **Completed the truncated sections** from earlier spec content: trial fact cards (7 days / 10 campaigns / No card / Connect anytime), FAQ (6 questions), managed setup section, 3-column footer with no dead links.
- **Stitch deviations:** hero CTAs say "Create your first campaign" / "See example campaign" (stitch's "Create ad" broke the settled campaign terminology); remote placeholder images replaced with `/ads/*.jpg`; radar uses fictional agencies (Coastline Property, Hillview Agents, Northstar Realty) — never attribute invented ads to real brands; radar "Change" location link is decorative pending a real picker.
- **Metadata updated** (`layout.tsx`): replaced the dead "More listings. Nothing hidden. / Blockwise runs Meta ads…" title/description with platform positioning + trial terms.
- Demo form label → "Suburb you want to advertise in" (was "…want listings in" — read as a lead-gen promise).
- **Verification:** JSX syntax-checked and full-page rendered via an isolated harness (zero page errors; screenshot reviewed). The Cowork sandbox's repo mount serves stale file views, so run `npm run typecheck` and `npm run dev` on the real machine for final confirmation. App pages the sandbox flagged "broken" were verified intact on the real filesystem.

## 2. Verified product facts (claims register)

Every claim on the page traces to code. Nothing else may be claimed.

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
| Ad radar: search live AU real-estate ads by postcode/suburb/page/ad copy; longest-running sort; save-as-template; trial-accessible | `(customer)/research/page.tsx`; `template-gallery-modal.tsx`; `canAccessSurface` |
| Compliance checks flag issues; team owns final sign-off | `compliance.ts` — never claim "every campaign is compliant" |
| After trial: generation pauses (402), drafts stay | `generation-trial.ts` |
| Managed setup: 15-min call, reply in 1 business day | `demo-form.tsx` |

**Do NOT claim:** live launching today (gate below), CRM routing, lead volume/cost numbers, pricing, listing-URL import, budget/ad-account as brief fields, a lead-form library, real agency examples in mock ads.

## 3. ⚠️ Launch gate (blocking)

Live provider writes are disabled (`BLOCKWISE_ENABLE_PROVIDER_WRITES=false`; publish route returns "Live provider writes are disabled." for non-dry runs). The page's hero H1 ("Create and launch…"), step 4 ("Launch from Blockwise") and the Active dashboard mock assume publishing is enabled. **Do not ship until writes are on**, or swap fallbacks: hero "Create real estate ad campaigns from one platform."; step 4 "Connect your ad account when you're ready to run, and track performance inside the app."; dashboard status pill → "Awaiting approval".

## 4. Remaining alignment items

1. Signup page sub-copy still says "Create your first listing ad before connecting Meta." — optionally align to "7 days, 10 campaigns, no card required." (left as-is per current file state).
2. In-app terminology PR: first-run explainer "1 of 10 free ad packs" → "campaigns" (`first-run-explainer.tsx`); start-choice "Create first ad" → "Create first campaign".
3. "Local Ad Radar" (marketing) vs in-product "Research" naming — align before launch.
4. Nav/footer "Pricing" intentionally absent until a pricing page exists.
5. Trial publish cap (1 campaign) — add to FAQ when writes go live.
6. Old landing artifacts can be deleted: `landing-demo.html`, `landing-preview.html` (repo root), `blockwise_landing_build/` once this is approved.
