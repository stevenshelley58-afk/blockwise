# HANDOVER: Finish Ad Studio §3 + §4 Implementation

**Date:** 2026-06-10 · **For:** any agent/session picking this up
**Read first:** `docs/plans/ad-studio-3-4-execution-plan.md` (task specs + full run log) and `AGENTS.md` (hard rules). Parent context: `docs/ad-studio-improvement-roadmap.md`.

## Current state — one paragraph

All 12 tasks (A0–A6, B1–B5) are **code-complete and manually verified** in the working tree, **uncommitted**, because bash/git/typecheck were unavailable for the entire session. Two agents implemented the work (agent-A: server/lib, agent-B: components/UI); a verifier pass then implemented the A6 publish-panel multi-select UI, confirmed the four suspected-reverted lib files are in their final intended state, and ran a manual consistency review (details in run-log entries dated 2026-06-10, especially the last three). No `[B]` blocked tasks. Both roadmap §3/§4 "Implemented" notes are already written.

## Your job (in order)

1. **Typecheck + tests.** `npm run typecheck` (or `tsc --noEmit`) and `npm test` / `node --test`. Nobody has run these. Most likely friction points, per the agents:
   - `ExportFormatStatus` contextual literal types in `setExportStatus` calls (`src/components/adstudio/use-campaign-actions.ts` ↔ `panels/publish-panel.tsx`).
   - `VariantStrip` pending/skeleton ternary JSX in `src/components/adstudio/preview.tsx`.
   - `tests/adstudio-real-loop-regressions.test.ts` was updated by agent-A to match the new `Promise.allSettled` enrichment source — confirm it passes as updated.
2. **Fix whatever typecheck/tests surface.** Smallest change wins; consult the plan's task spec before altering anything semantic.
3. **Smoke-test critical paths** (Vercel preview per AGENTS.md — no localhost acceptance):
   - Generate (trial + non-trial draft-kit workspace; B2 changed both paths — non-trial draft kits now generate via `trial-brand-kit.ts` fallback; `generator.ts` approved-kit throw was removed, approval now gates publish only).
   - Publish: full pack (must be byte-identical plan), then a 2-variant A/B selection (ad names get ` | bw:v=…;a=…;t=…` suffix; response echoes `metaPublishPlan.variantIds`).
   - Monitor: angle table renders only with tagged ads; fatigue pill only with ≥1k impressions per 7d window; demo/sample mode unaffected.
   - Export with one format failing → other formats still download, Retry chip works.
   - Double-click Generate → one generation (NOTE: workbench creates via POST `/api/adstudio/campaigns`, which has only the client guard; the server hash-dedup lives on `campaigns/[id]/generate`. Optional follow-up: add the same small guard to the campaigns POST route).
4. **AGENTS.md report + commits.** `git diff --stat` for the LOC report (template in plan's Verification section). Commit per-workstream; tag B-task and A6-UI commits `simplification`. A-tasks: behaviour changed = yes (additive). Verify zero schema/auth/dep changes (already manually confirmed: package.json untouched, no new migrations).
5. **Update the plan file**: tick the last Verification checkbox, append your run-log entry.

## Constraints (non-negotiable, from AGENTS.md)

No new dependencies · no schema changes · no auth changes · no removed/renamed API response fields (additive only) · publish-visible deltas are limited to the A3 ad-name suffix and the opt-in `variantIds` body field · prefer deletion over abstraction.

## Known intentional oddities (don't "fix" these)

- `page.tsx` `buildDraftBrandBundle` casts `reviewStatus: "approved"` for the generator only; the UI keeps the real draft kit. Harmless, deliberately left.
- A6: empty/absent `variantIds` both mean full-pack publish; >3 or 0 selections are blocked in the panel UI, not the server.
- A2 similarity warnings are non-blocking by design (Andromeda diversity hint, not a gate).
- Different A/B selections share one idempotency key per (workspace, campaign, adapter, approval) — latest selection overwrites the draft plan. Intentional.
- A3 template tag uses `campaign.offerId` because packs don't persist templateId.

## Open follow-ups (not required to close this work; next-up candidates)

1. Dedup guard on POST `/api/adstudio/campaigns` (see 3e above).
2. Roadmap §1/§2 quick wins not in scope here: prompt/model-profile caching, image-count defaults, bulk-cell concurrency, background image upload.
3. §3 phase 2: CPL-calibrated scoring + biasing generation toward winning angles (needs A3/A4 data to accumulate first).
4. Banner stacking on `page.tsx` (`SampleBanner`/`TrialBrandBanner` vs fixed-position workbench) — pre-existing, likely invisible; audit separately.

## File inventory (all uncommitted)

**Server/lib (agent-A):** `src/lib/adstudio/`: `campaign-copy-enrichment.ts`, `scoring.ts`, `creative-qa.ts`, `generator.ts`, `types.ts`, `trial-brand-kit.ts` · `src/lib/providers/meta-execution.ts` · `src/lib/meta-monitor/`: `calculations.ts`, `getMetaMonitorData.ts`, `types.ts` · `src/lib/operator/prompts/`: `prompt-registry.ts`, `redact-prompt-run.ts` · `src/app/api/adstudio/export-packages/[id]/publish/route.ts` · `src/components/monitor/`: `MetaMonitorDashboard.tsx`, `AdPerformanceCard.tsx` · `tests/adstudio-real-loop-regressions.test.ts`

**Components/UI (agent-B + verifier):** `src/components/adstudio/`: `use-campaign-actions.ts`, `preview.tsx`, `ad-studio-workbench.tsx`, `styles.ts`, `panels/publish-panel.tsx` · `src/app/(customer)/ad-studio/`: `page.tsx`, `brand/page.tsx` · `src/app/api/adstudio/campaigns/[id]/generate/route.ts`

**Docs:** `docs/ad-studio-improvement-roadmap.md`, `docs/plans/ad-studio-3-4-execution-plan.md`, this file.
