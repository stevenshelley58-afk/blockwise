# AdStudio Template Flow — Execution Plan (fix → prod-ready → cleanup)

Date: 2026-07-01. Companion to `TEMPLATE-FLOW-REVIEW.md` (the findings; this is the work).
Audience: an executing agent. Every task states the files, the exact change, and an acceptance check. Do phases in order; tasks within a phase are ordered by dependency. Do not improvise beyond what is written; where a decision is marked **[DECISION]**, the recommended option is stated — confirm with the owner only if you must deviate.

## Ground rules (hold for every task)

- `AGENTS.md` is binding: never weaken `scripts/verify/adstudio-templates.mjs` to pass — gate changes must strengthen it, with tests; workspace isolation and RLS stay intact; schema changes ship as tested migrations; destructive table changes require a row-count check and archive non-empty tables to `legacy_archive`.
- Every PR: `npm run typecheck`, `npm test`, `npm run verify:hard-reset` green. Runtime acceptance on Vercel Preview only — never localhost.
- Delete > simplify > abstract. When a task says delete, delete — git history preserves it.
- Each task is one PR (or a small stack). Tag cleanup PRs `simplification`.

## Target end-state (what "done" looks like)

One generation path: **pick template → photos + one brief → one AI copy pass (on-image fields + Meta feed copy + CTA enum) → clone the sample with that copy (provider cascade, async job) → vision QA verifies text + returns editable regions (auto-reroll) → Stitch-style in-place editing (targeted regen anchored on the current image, fast tier) → Finalize (quality tier, all export formats) → publish to lead form.** No Fabric editor, no second renderer, no dead panels, no baked sample copy, and the whole loop exercised by CI on every PR.

Definition of prod-ready (release gate, checked at the end of Phase 3):
1. CI runs the real-loop e2e against a Vercel Preview and it passes.
2. A persistence failure is impossible to mistake for success anywhere in the flow.
3. Every AI call goes through the profile registry, records a provider run, and has a fallback.
4. The generated image always contains the user's copy, verified by vision QA before the user sees it.
5. Every user-visible error state has a surfaced message; zero `.catch(() => {})` in `src/components/adstudio` + `src/app/api/adstudio`.
6. The cleanup inventory (Phase 5) is empty.

---

## Phase 0 — Safety net & stop-the-bleeding (~1 week)

### P0.1 — Real-loop e2e in CI **(do first; everything else regresses without it)** [L]
Files: `.github/workflows/hard-reset-verification.yml`, `e2e/adstudio-real-loop.spec.ts`, new `scripts/e2e/seed-adstudio-e2e.mjs`, repo secrets.
Change:
- Create a dedicated e2e workspace + user in Supabase (seed script, idempotent: upserts user, workspace, approved brand kit; prints workspace id). Store `ADSTUDIO_E2E_WORKSPACE_ID`, e2e user credentials as GitHub secrets.
- New workflow job `e2e-preview`: triggers on `deployment_status` success from Vercel (or polls the preview URL from the Vercel deployment for the PR SHA), generates storage state by logging in with the e2e user (add `scripts/e2e/login-storage-state.mjs` using Playwright), sets `PLAYWRIGHT_BASE_URL` to the preview URL, runs `playwright test e2e/adstudio-real-loop.spec.ts`.
- Remove the silent `describe.skip`: in CI (`process.env.CI`), missing preconditions **fail** the job with a clear message instead of skipping.
- Extend the spec to also assert: generated image responds 200; copy edit survives reload (already there); export produces a non-empty file.
Accept: a PR that breaks create→edit→save→reload→export turns the check red. Verify by intentionally breaking `saveDraft` in a scratch branch.

### P0.2 — Persistence failures fail loudly [M]
Files: `src/app/api/adstudio/campaigns/route.ts:198-217`, `src/app/api/adstudio/campaigns/[id]/draft/route.ts:52-59`, `src/lib/adstudio/persistence.ts`, new migration + RPC.
Change:
- New Postgres function `adstudio_persist_campaign_pack(jsonb)` performing the multi-table write in one transaction (campaign, variants, creatives, platform copy, compliance). `persistAdStudioCampaignPack` calls the RPC; keep the row-shaping in TS, move only the write into SQL.
- `campaigns` POST: on persist error → refund credit → **500** `{ error: "generation_not_saved" }`. Delete the `not_persisted` warning path and `buildAdStudioLiveResult`'s partial-success shape (`live-workflow.ts:29`). Client (`use-campaign-actions.ts`) shows a retryable error toast.
- `draft` PATCH: same — 500 on persist error, client keeps `saveState:"error"` with retry.
Accept: unit test forcing a mid-sequence DB error → API 5xx and no partial campaign rows (transaction rolled back). E2E still green.

### P0.3 — The brief reaches the ad (review finding 1b) [M]
Files: `src/components/adstudio/new-ad-dialog.tsx:726-770,1237`, `src/lib/adstudio/copy-generation.ts`, `src/app/api/adstudio/copy/route.ts`, `src/app/api/adstudio/generate-clone/route.ts`, `src/lib/adstudio/reference-clone.ts`.
Change:
- New exported function `generateTemplateCloneCopy({ brief, description, brandKit, imageUrl })` in `copy-generation.ts`: one `structured_json` call that returns values for every `brief.copyFields[].key` (sample copy passed as tone/shape reference with the instruction "match the voice and length, replace the content with the user's details") **plus** Meta feed copy (primaryText/headline/description) **plus** `cta` as the Meta enum. Extend `/api/adstudio/copy` with a `templateFields` request mode.
- Dialog `submit()`: call the copy endpoint first, pass `copy` into `generateTemplateClone` (the route already accepts it — `generate-clone/route.ts` `resolveCloneCopy`), and pass the same feed copy into `onGenerate` so the deterministic offer-library copy is replaced by the generated set (template mode keeps skipping `enrichCampaignPackCopyWithAi` — this call replaces it).
- Show the generated on-image copy in the dialog for a beat ("Here's what we'll write — Generate / tweak first") — a single confirm textarea list, not per-field forms.
Accept: e2e generates with description "Open home Saturday, 18 Smith St Scarborough" → vision-check (manual on Preview for now; automated in P1.2) shows that text in the image; sample placeholder copy never appears. Unit test: `generateTemplateCloneCopy` returns a value for every declared field, clamped to `maxLength`.

### P0.4 — Editor honesty on clone creatives (interim, until Phase 2) [S]
Files: `src/components/adstudio/canvas/fabric-ad-editor.tsx`, `ad-studio-workbench.tsx`, `panels/copy-panel.tsx`.
Change: when the current creative is a clone (single `template_clone_image` object), do not mount the Fabric editor — render the image with a badge "AI-designed — text changes regenerate the image" and a "Regenerate with current copy" button (re-runs P0.3 copy + clone). Copy panel keeps editing feed copy; label the section "Feed text (around the image)" vs "On the image (regenerates)".
Accept: no click-target on a clone creative silently no-ops; regenerate button produces a new image with the edited copy.

### P0.5 — Defuse landmines [S]
Files/changes:
- Delete `scripts/generate-adstudio-samples.mjs` (stale wireframe generator that would overwrite all 26 real samples). Grep for references first.
- Add `FAL_KEY=` + comment to `.env.example` (until P1.1 retires fal).
- `src/lib/adstudio/template-preview.ts:15-17`: missing `thumbnailSrc` returns a neutral placeholder data-URL instead of throwing (a template card must never crash the gallery).
- `ad-studio-workbench.tsx:599-613`: replace unload-flush fetch with `navigator.sendBeacon` to the draft endpoint (add a beacon-friendly `POST` alias accepting the compact pack).
Accept: `npm run verify:hard-reset` green; killing the tab mid-edit persists the last state (manual Preview check).

### P0.6 — Unfreeze or remove frozen fields; delete dead panels [M]
Files: `src/components/adstudio/panels/{campaign,audience,landing,templates}-panel.tsx` (delete all four), `ad-studio-workbench.tsx:275-277`, `panels/settings-panel.tsx`, `panels/publish-panel.tsx`.
Change: **[DECISION — recommended]** `market` and `propertyType` become editable in Settings panel (two inputs, they feed copy generation); `destinationUrl` moves to Publish panel as an editable input with URL validation (it feeds readiness). Delete the four dead panel files and the special-cased `item.id === "templates"` nav wiring (`ad-studio-workbench.tsx:1147,1342`) in favour of a plain "New ad" button. Delete the `promptedForFirstAd` no-op effect (`:633-636`).
Accept: typecheck finds no orphan imports; the three fields are user-editable on Preview; grep shows zero references to the deleted panels.

### P0.7 — Cross-instance double-submit guard [S]
Files: `src/app/api/adstudio/campaigns/route.ts:38-116`, migration.
Change: replace the module-level `Map` with a DB guard: `insert ... on conflict do nothing` on a new `adstudio_generation_locks (dedupe_key text primary key, created_at)` row keyed by the deterministic campaign id; if the row exists and is <60s old → 409; delete the row in a `finally`. Keep the Map as a cheap first check.
Accept: two concurrent identical POSTs (test with `Promise.all` in an integration test) → one 201, one 409, one set of AI spend (assert one provider-run row).

---

## Phase 1 — Clone pipeline hardened (~1–2 weeks)

### P1.1 — Provider cascade for clones; retire fal [M]
Files: `src/app/api/adstudio/generate-clone/route.ts`, `src/lib/adstudio/reference-clone.ts`, `ai-providers.ts`, `model-registry.ts`, delete `fal-image-provider.ts`.
Change:
- Add a `image_clone_fast` profile (Gemini flash-image class via OpenRouter — preview/edit tier) and reuse `image_final` (gpt-image-2 direct OpenAI — finalize tier) in `model-registry.ts`; mirror both in `model-control-config.ts` so the operator catalog and registry finally agree (also reconcile the existing image profiles — one catalog, one truth).
- `generate-clone` route: accept `tier: "preview" | "final"`; build the provider list from the resolved profile (primary + fallbacks + hardcoded OpenAI last resort), first-success-wins — reuse the cascade shape from `creative-options.ts:83-120`. Call `recordAdStudioProviderRun` and `runComplianceGate` (parity with `generate-options`). Delete `createFalImageProvider` and its env keys from `.env.example`.
- Delete the dead `generateAdFromTemplate` + `generateMixedImageVariantsInParallel` after folding their multi-provider logic into the cascade (do not keep both).
Accept: with `OPENROUTER_API_KEY` unset, clones still succeed via OpenAI (and vice versa); every clone leaves a provider-run row; unit tests cover cascade order and tier→profile mapping.

### P1.2 — Vision QA + editable-regions pass with auto-reroll [L]
Files: new `src/lib/adstudio/clone-qa.ts`, `generate-clone/route.ts`, `creative-qa.ts` (reuse), then delete `bulk-cell.ts` and `style-profile.ts` (their patterns are absorbed; nothing else calls them).
Change:
- `runCloneQA({ image, expectedCopy, slots })` → one `vision_classification`-profile call returning strict JSON: `{ copyChecks: [{key, expected, rendered, exact: boolean}], regions: [{key|role, box: {x,y,w,h} normalized 0-1}], defects: string[] }`. Fail = any required copy field not exact, or defects include warped text/faces.
- Clone route loop: generate → QA → if fail, reroll with a corrective prompt suffix ("previous attempt rendered X as Y — render exactly X") up to 3 attempts (fast tier), else 502 with the QA report. Persist `regions` + QA report on the creative (`canvas_json.meta.cloneQa`).
- Store per-attempt provider runs; log rerolls.
Accept: fixture test with a hard headline ("O'Connor's 3-bed — $1,249,000?") on a live Preview run renders exactly or errors visibly; response includes regions for every copy field; unit tests for the QA JSON schema and reroll control flow (mock provider).

### P1.3 — Async generation (kill the 120s ceiling) [L]
Files: new `trigger/adstudio-generate.ts`, `supabase/migrations/20260614221051_adstudio_creative_jobs.sql` (already exists — add RLS read policy for workspace members), `src/app/api/adstudio/campaigns/route.ts`, new `src/app/api/adstudio/jobs/[id]/route.ts`, `use-campaign-actions.ts`, `new-ad-dialog.tsx`.
Change:
- `campaigns` POST validates + reserves credit + inserts an `adstudio_creative_jobs` row + triggers `adstudio-generate` task, returns **202 { jobId }**. The task runs: copy pass (P0.3) → clone cascade (P1.1) → QA/reroll (P1.2) → pack build → persist (P0.2 RPC) → job `succeeded` with `campaignId` (or `failed` with the QA/provider error).
- `GET /api/adstudio/jobs/[id]`: workspace-scoped job status. Dialog shows staged progress ("Writing copy → Designing → Checking text") polling 1.5s; on success loads the campaign.
- Keep a synchronous fallback path behind `ADSTUDIO_SYNC_GENERATE=1` for local/dev only.
- Deploy the trigger task and confirm registration before merge (AGENTS.md).
Accept: e2e passes through the async path; a job that fails QA thrice shows the error in the dialog; no route exceeds 30s wall-time in Vercel logs.

### P1.4 — Targeted in-place edit endpoint [M]
Files: new `src/app/api/adstudio/creatives/[id]/edit/route.ts`, `reference-clone.ts` (add `buildTargetedEditRequest`), `clone-qa.ts`.
Change: request `{ fieldKey, newValue }` (text) or `{ slotRole, newImage }` (image). Build a fast-tier edit anchored on the **current creative image** (not the template sample): prompt "change only <field label> to \"<newValue>\"; keep everything else pixel-identical", mask from the stored region box (OpenAI edits accepts masks; instruction-only for OpenRouter). QA-verify (changed field exact AND unchanged fields' `rendered` values still match), one reroll, persist new render + updated copy value + refreshed regions, append to a `renders` history array on the creative (max 10) for undo.
Accept: integration test on Preview: edit headline → new image in <15s, other fields byte-identical per QA report; undo restores the previous render.

### P1.5 — One copy model: CTA enum + publish gates [S]
Files: `src/lib/adstudio/readiness.ts:23`, `use-copy.ts:54`, `generator.ts:1419`, `panels/copy-panel.tsx`, `panels/publish-panel.tsx`, `types.ts`.
Change: single `src/lib/adstudio/meta-cta.ts` exporting the enum, labels, and (one) label→enum mapper; delete the two divergent keyword maps. Copy panel: CTA becomes a select of the four Meta buttons (free-text label removed; on-image CTA text is a copyField like any other). Publish/readiness: over-limit copy (`COPY_LIMITS`) blocks export/publish with a specific message, not a warning.
Accept: grep shows one `toMetaCta`; publish with a 130-char primary text is blocked in UI and API.

---

## Phase 2 — Edit surface rebuild + old editor removal (~1–2 weeks)

### P2.1 — In-place ad editor (Stitch UX) [L]
Files: new `src/components/adstudio/canvas/in-place-ad-editor.tsx`, `ad-studio-workbench.tsx`.
Change: renders the creative image with absolutely-positioned hit-targets from `cloneQa.regions` (scaled to the displayed size). Click text region → inline input overlay pre-filled with the current value; Enter → optimistic shimmer on the region → P1.4 edit → swap image. Click image slot → media picker → P1.4 image edit. Esc cancels. Keyboard: tab cycles regions. Mobile: tap region → bottom-sheet input. Replaces the P0.4 interim badge.
Accept: e2e adds "click headline on the image, type, expect new render"; no Fabric code in the template-ad path.

### P2.2 — Review screen = real Meta chrome [M]
Files: `preview.tsx`, `panels/copy-panel.tsx`, `ad-studio-workbench.tsx`.
Change: the primary stage shows the ad exactly as Meta renders it — page header, primary text (feed copy, plain-text editable inline), the creative image (P2.1 editor), headline/description strip, and the **real CTA button** from the enum. Story/feed/square toggles preview the corresponding render. Delete the faux static preview duplication in `preview.tsx` that renders copy separately from the creative.
Accept: what the user sees on the stage is field-for-field what `export`/publish sends (assert in e2e by comparing DOM text to the export payload).

### P2.3 — Cut blank mode; single generation path **[DECISION — recommended: cut]** [M]
Files: `new-ad-dialog.tsx` (`isBlank` paths), `generator.ts` (`buildCustomCreative`, `buildTemplateCreative` text-layout path, `renderGeneratedCreativeSvg`), `creative-svg.ts`, `creative-design-builder.ts`, `creative-design-json.ts`.
Change: remove "Start blank" — every ad starts from a template or an Ad Radar reference (which maps to the closest template). Then delete the compositor's creative-rendering half: `buildCustomCreative`, SVG creative rendering, design-JSON builders. `generator.ts` shrinks to campaign/variant/copy-pack scaffolding around the clone pipeline. **Legacy data**: existing canvas-composited campaigns must still open read-only — one-time task renders each legacy creative's `canvas_json` to a PNG via the existing SVG renderer *before* deleting it (script `scripts/migrations/snapshot-legacy-creatives.mjs`, stores to `workspace-artifacts`, sets `render_status:"legacy_snapshot"`); run it against prod, verify counts, then delete the renderer.
Accept: row-count check on legacy creatives = snapshot count; old campaigns open and export; grep shows no `renderGeneratedCreativeSvg`/`creative-svg` references; typecheck green.

### P2.4 — Delete the Fabric stack + duplicate exporter [M]
Files: delete `canvas/fabric-ad-editor.tsx`, `canvas/browser-creative-renderer.ts`, `canvas/use-creative-history.ts`, `fabric-image-load.ts`, `smart-crop.ts` (keep `outpaint-layout.ts` — the cascade uses its size mapping); remove `fabric` from `package.json`; `use-campaign-actions.ts` export path.
Change: export = upload of the finalized renders themselves. **Finalize** (new button, quality tier): for each export format (1:1/4:5/9:16), run a quality-tier reframe clone of the accepted preview (same copy, format-target size), QA each, store as the export set (~3 × $0.21 per finalized ad). Remove the dangling `1.91:1` format from `PREVIEW_TO_AD_FORMAT`/`FORMAT_META`.
Accept: bundle no longer contains fabric (check build output size drops); export ZIP contains the three QA-passed renders; e2e export step green.

### P2.5 — Workbench state cleanup [M]
Files: `ad-studio-workbench.tsx` (1,414 lines), hooks.
Change: consolidate the ~30 `useState` blob into a `useReducer`-backed `CampaignDraftState` (pack, copy, media, selection, generation) with a single autosave subscription; delete the three parallel role vocabularies — the only vocabulary left is `copyFields` keys + slot roles (Fabric meta and `SelectedElement` translation tables go with P2.4). Save/Delete buttons get busy/disabled states; delete flow awaits and guards double-click; replace `window.confirm` regenerate with the standard dialog.
Accept: workbench file <700 lines; e2e green; React StrictMode double-render produces no duplicate saves.

---

## Phase 3 — Template factory & gallery (~1 week)

### P3.1 — Semi-automated template factory [L]
Files: new `scripts/adstudio/build-template.mjs` (the path `template-brief.ts:4` already cites), rewrite `hermes/skills/adstudio-template-builder/SKILL.md`.
Change: input = source ad (radar `creativeId` or `meta_ad_candidates/` file). Pipeline: (1) vision extraction (top-tier vision model) → slots, copy fields (with sample values), classification, brand hex; (2) sample-image creation — image model recreates the source ad's design with **fictional placeholder content** (invented agency, suburb, price) so the shipped sample is sanitized, not the scraped ad; (3) emit template JSON (slim schema, P3.3) + sample PNG/SVG into the gallery + `public/adstudio-samples/`; (4) run the gate; (5) human approves the rendered card. Store `sourceAd.contentHash` (sha256 of the source creative) for verifiable provenance.
Accept: running the script on a new source ad yields a gate-passing template in one command; SKILL.md documents the new flow and deletes the false "gallery == generator == editor" equivalence claim.

### P3.2 — Slim template schema + gate v2 [M]
Files: `templates.ts`, all 26 `template-gallery/*.json` (migration script `scripts/migrations/slim-templates.mjs`), `scripts/verify/adstudio-templates.mjs`, tests in `tests/`.
Change: template = `{ id, templateKey, name, goal, offerId, category, audienceIntent, tags, promptHint, sourceAd(+contentHash), classification, format, dimensions, slots[] (role, required, aspect, description), copyFields[] (key, label, maxLength, sample), sampleCopy, gallery, meta }`. Delete `canvas.objects` + `fabricJson` (nothing consumes them after Phase 2). Gate v2 (strengthen, don't weaken): keep envelope/provenance-uniqueness/classification/diversity checks unchanged; **replace** the canvas/fabric-lockstep checks with: sample image file exists and is non-wireframe (no `#d0cdc8`, contains raster content), every `copyFields.key` unique and non-empty, ≥1 required slot, `sourceAd.contentHash` present for new templates. Add a gate self-test fixture set (passing + each failure mode) under `tests/adstudio-gate/`.
Fix the legacy types while here: `sampleCopy` free-form record, delete `AdStudioTemplateEditableImage` fixed-role enum, `editableImage/editableText`, `AdStudioLibraryTemplate` + `mapAdStudioLibraryTemplate` + `mergeAdStudioTemplateLibrary` stubs, and the `as unknown as` cast in `template-gallery/index.ts:33`.
Accept: gate passes on the 26 migrated templates; intentionally corrupting each new invariant fails it (covered by the fixture tests); `npm run verify:hard-reset` green.

### P3.3 — Brand kit contract honesty [S]
Files: `src/app/(customer)/ad-studio/page.tsx:64-152`, `generator.ts`.
Change: `generateAdStudioCampaignPack` accepts `{ allowUnapprovedKit: true }` for starter/draft bundles instead of the page spoofing `reviewStatus:"approved"`; the spoof comments and cloned-kit hacks are deleted.
Accept: grep shows no `reviewStatus: "approved"` literal outside real approval code; starter flow still works on Preview.

---

## Phase 4 — Prod-readiness hardening (~3–4 days)

### P4.1 — Error surfacing sweep [S]
Files: `topbar.tsx:57`, `page.tsx:94,154`, `new-ad-dialog.tsx:1323`, `ad-studio-workbench.tsx:373`, `publish-panel.tsx:120`.
Change: every `.catch(() => {})` / silent-return becomes a toast or inline state ("Couldn't load campaigns — retry"). Publish-readiness polling failure shows "Status unavailable" instead of hanging on "Queued…".
Accept: `grep -rn "catch(() => {})\|catch(() => null)" src/components/adstudio src/app/api/adstudio src/app/\(customer\)/ad-studio` returns nothing.

### P4.2 — Silent degradation fixes [S]
Files: `resolve-image-for-model.ts:14,30`, `copy/route.ts`.
Change: oversized/unreadable grounding image → downscale server-side (sharp is unavailable on the edge; do it client-side pre-upload — `downscaleImageForUpload` already exists, enforce ≤4MB there) and if resolution still fails, return a `warnings: ["photo_not_used"]` field the client surfaces ("We couldn't read your photo — copy was written without it").
Accept: unit test: >9MB path yields the warning, not silence.

### P4.3 — Config truth + observability [S]
Files: `model-registry.ts`, `model-control-config.ts`, `.env.example`, `docs/`.
Change: reconcile the two catalogs (P1.1 started this) — the control-config catalog lists only models the registry can express; document every `BLOCKWISE_*` model env in `.env.example`; delete `pickProvider` legacy fallback in `copy-generation.ts:173` (the profile cascade is the fallback). Confirm `emitModelFallbackAlert` fires on clone-path fallbacks too. Add a `docs/runbooks/adstudio-generation.md` runbook: profiles, tiers, job table, how to read provider runs, how to kill-switch a profile.
Accept: a new dev can configure generation from `.env.example` alone; alert fires in a forced-fallback test.

### P4.4 — Rollout [S]
Change: ship Phases 1–2 behind `adstudio_clone_v2` workspace flag; enable on the e2e + internal workspaces first; watch provider-run error rates + QA reroll rates for 48h; then default-on and delete the flag (flags are not permanent residents).
Accept: flag deleted by the end of the phase; error rate <2% sustained.

---

## Phase 5 — Cleanup inventory (delete all old code)

Some items are absorbed by earlier tasks (marked). This list is the checklist — Phase 5 is done when every line is verifiably gone or deliberately kept with a written reason.

**Components**
- [ ] `panels/campaign-panel.tsx`, `panels/audience-panel.tsx`, `panels/landing-panel.tsx`, `panels/templates-panel.tsx` (P0.6)
- [ ] `canvas/fabric-ad-editor.tsx`, `canvas/browser-creative-renderer.ts`, `canvas/use-creative-history.ts` (P2.4)
- [ ] `promptedForFirstAd` stub effect; `templates` nav special-casing (P0.6); `window.confirm` regenerate (P2.5)
- [ ] Duplicate mobile/desktop double-mount of the editor (`ad-studio-workbench.tsx:1194,1262`) — single mount after P2.1

**Lib**
- [ ] `fal-image-provider.ts` (P1.1) — and `generateAdFromTemplate` / `generateMixedImageVariantsInParallel` after cascade absorption (P1.1)
- [ ] `bulk-cell.ts`, `style-profile.ts` (P1.2 — patterns absorbed; nothing else references them)
- [ ] `smart-crop.ts`, `fabric-image-load.ts`, `creative-svg.ts`, `creative-design-builder.ts`, `creative-design-json.ts` (P2.3/P2.4)
- [ ] `generator.ts`: `buildCustomCreative`, `buildTemplateCreative` layout math, `renderGeneratedCreativeSvg`, `metaCtaFromLabel` (P1.5/P2.3); Google copy-pack builders (`buildGoogleAssetPack`, google search/pmax/demand-gen sections) — product is Meta-only; stop generating and stop writing `google_*_json` (keep columns; archive note)
- [ ] `live-workflow.ts` — dissolve after P0.2 (persistence-status wrapper gone); keep brand-approval helper wherever it moves
- [ ] `copy-generation.ts` `pickProvider` legacy env fallback (P4.3)
- [ ] `templates.ts` legacy types + library stubs + `as unknown as` cast (P3.2)
- [ ] Duplicate `loadCampaignPack` in `campaigns/[id]/duplicate/route.ts:70-125` → use `loadAdStudioCampaignPack` from `persistence.ts`
- [ ] Manual delete-cascade in `campaigns/[id]/route.ts:102-137` → rely on FK `on delete cascade` (verify FKs first), keep only the campaign delete + auth check
- [ ] `1.91:1` dangling format (P2.4)

**Routes**
- [ ] `api/adstudio/template-photo-prep/` (410 tombstone) — delete route + the vestigial `photoPrep` object in the campaigns response + any client reads of it
- [ ] `api/adstudio/template-library/` — replace with direct import of `builtInAdStudioTemplates()` in the workbench (the route is a shim over statics; delete `loadTemplateLibrary` fetch + fallback) — or keep the GET if self-serve needs it cross-origin; **[DECISION — recommended: delete, import directly]**

**Database** (each: row-count check → archive to `legacy_archive` if non-empty → drop, as a tested migration)
- [ ] `adstudio_creative_objects` (never written)
- [ ] `adstudio_offer_templates` (offers live in `offers.ts`)
- [ ] `adstudio_performance_imports`, `adstudio_job_runs` (no writers) — verify no Hermes/VPS writer before dropping
- [ ] `adstudio_campaigns.legacy_campaign_id` FK (unused by the writer)
- [ ] `adstudio_creative_jobs` — **kept** (wired in P1.3)
- [ ] `google_*_json` copy columns — stop writing (above); archive-and-drop only after confirming no reads

**Scripts / docs**
- [ ] `scripts/generate-adstudio-samples.mjs` (P0.5)
- [ ] `template-brief.ts:4` stale comment → points at the real `scripts/adstudio/build-template.mjs` (P3.1)
- [ ] `SKILL.md` rewrite (P3.1); `AGENTS.md` AdStudio section updated for schema v2 (canonical-field rule + fabric-lockstep rule replaced by slim-schema + gate-v2 rules) — same PR as P3.2 so rules and gate change together
- [ ] Root-level stale artifacts already flagged in `UI-UX-REVIEW-AND-PLAN.md` T0.1 if still present

**Env**
- [ ] `FAL_KEY`, `BLOCKWISE_FAL_IMAGE_MODEL`, `BLOCKWISE_FAL_IMAGE_QUALITY` removed after P1.1

---

## Sequencing & estimates

```
P0.1 ──────────────┐                (everything shelters under CI e2e)
P0.2 P0.3 P0.4 P0.5 P0.6 P0.7      Phase 0: ~1 week, parallelizable after P0.1
        │
P1.1 → P1.2 → P1.3                 Phase 1: ~1–2 weeks (P1.4, P1.5 parallel after P1.2)
        │
P2.1 → P2.2 → P2.3 → P2.4 → P2.5   Phase 2: ~1–2 weeks
        │
P3.1 → P3.2 → P3.3                 Phase 3: ~1 week
        │
P4.1–P4.4                          Phase 4: ~3–4 days
        │
Phase 5 checklist sweep            (mostly absorbed; final audit ~1 day)
```

Total: roughly 5–7 weeks of focused work, shippable in slices — the product improves visibly at P0.3 (ads say what the user typed), P1.3 (no more timeouts), and P2.1 (in-place editing).

Standing risks to watch: image-model text fidelity on long/unusual copy (mitigated by QA reroll + `maxLength` clamps); region-box accuracy on dense layouts (mitigate: minimum hit-target size, fall back to a field list popover when boxes overlap); legacy campaign rendering after P2.3 (snapshot script is the guard — run it before deleting the renderer, verify counts).
