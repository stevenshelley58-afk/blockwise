# AdStudio Template Flow — End-to-End Review

Date: 2026-07-01. Scope: the full template pipeline — template creation from source ads, the gallery, image/copy input, editing, generation, persistence, export — plus AI model choices.
Verification run for this review: `npm run typecheck` ✅, `npm test` 743/743 ✅, `node scripts/verify/adstudio-templates.mjs` ✅ (26 templates, 7 intents).

---

## Part 1 — Verdict

**Do not start again.** The foundations are genuinely good: a flexible template schema with a working anti-homogenization gate, a disciplined model-profile registry with cost caps and fallbacks, clean workspace-scoped persistence with RLS, and 26 gate-passing templates across 7 intents. A rebuild would throw that away and reintroduce the same class of bugs in new code.

**The product breaks repeatedly for two structural reasons, not because the code is rotten:**

1. **Three creative architectures are stitched together and only one of them is editable.** The deterministic canvas compositor (`generator.ts`), the generative image-options path (`creative-options.ts`), and the brand-new reference-clone path (`reference-clone.ts`, PR #148/#153) coexist. The clone path — now the flagship "generate my ad" flow — produces a single flat image with the copy **baked into pixels** (`generator.ts:1016-1060`: one `template_clone_image` object, `fabricJson: null`, zero text layers). The entire editing surface (copy panel sync, click-to-edit, inspector) works by finding canvas text layers with roles `headline`/`subheadline`/`cta_text`. **On the clone path, editing copy after generation does not change the visible ad.** The two halves of the product do not compose. (Resolution: commit fully to clone-first and rebuild the edit surface around regeneration — Part 4.)

2. **Nothing exercises the real flow before it ships.** CI (`.github/workflows/hard-reset-verification.yml`) runs static checks, unit tests, and build only. The real-loop Playwright spec (`e2e/adstudio-real-loop.spec.ts`) silently `describe.skip`s unless someone hand-supplies `PLAYWRIGHT_BASE_URL` + `ADSTUDIO_E2E_WORKSPACE_ID` + an auth fixture. So every runtime regression — gray gallery thumbnails, "undefined - undefined" cards, broken slot derivation (see the fix-commit history: `2cc4020`, `3bd0651`, `58d77c5`, `8e80fde`) — ships with green CI and is discovered by the user.

Fix those two things and the "keeps breaking" pattern stops. Everything else in this review is important but secondary.

---

## Part 2 — How the flow actually works today (connectivity map)

### 2.1 Template creation from a supplied sample: MANUAL

There is **no automated pipeline** from a source ad to a template. The process is an agent/human authoring workflow documented in `hermes/skills/adstudio-template-builder/SKILL.md`: pick a source ad (radar `creativeId` or `meta_ad_candidates/` file), vision-read it by hand, hand-write the JSON (canvas.objects + fabric mirror in lockstep), render a gallery sample, register in `template-gallery/index.ts`, run the gate. The only AI involvement is transcribing the ad-radar classifier's output (`hermes/tools/research-runtime/bin/ad-classifier.mjs`, OpenRouter, env-driven model).

- The gate (`scripts/verify/adstudio-templates.mjs`) enforces schema, canonical text fields, object↔fabric lockstep, provenance uniqueness, and the diversity detector (≥5 distinct intents, ≤50% share at N≥12). It currently passes at 26 templates.
- **Provenance is unverifiable in CI**: `meta_ad_candidates/` is gitignored, so the file-existence check is dead (`adstudio-templates.mjs:80`), and `creativeId` sources are never checked against `research.ad_creatives`.
- **The committed sample generator is a landmine**: `scripts/generate-adstudio-samples.mjs` still emits gray wireframes; the 26 real photo-composite SVGs in `public/adstudio-samples/meta/` were produced by uncommitted ad-hoc tooling (commits `bfcebc5`, `64afcbd`). Running the script would overwrite every real sample with wireframes.

### 2.2 Gallery: static images, one template system

- One template system: 26 static JSON files in `src/lib/adstudio/template-gallery/`, validated into `AD_STUDIO_TEMPLATES`. The `template-library` API route is a read-only shim over the same statics (PATCH returns 405). The old DB template library was deliberately deleted and is fenced off by `hard-reset-static.mjs:105-173`. Good — no dual source of truth here.
- Gallery previews are **static** `gallery.thumbnailSrc` images; `templatePreviewDataUrl` ignores its `brandKit` argument (`template-preview.ts:15-17`) and **throws** if a thumbnail is missing — an unhandled crash path in the card render.
- SKILL.md's core promise ("gallery card == generator output == editor view", `SKILL.md:130-133`) is currently **false**: gallery = ad-hoc static SVG, generator = `renderGeneratedCreativeSvg`, clone = gpt-image-2 output. Three renderings of "the same" template.

### 2.3 Images and copy in

- Uploads are solid: browser → downscale → Supabase Storage `workspace-artifacts` → asset-metadata POST → served via `/api/adstudio/media` with workspace-prefix auth (`media-upload.ts`, `api/adstudio/media/route.ts`).
- Slot derivation is decent (role-based with objectId fallback, `new-ad-dialog-slots.ts`), but role *classification* is regex-on-role-string — a template with an unrecognized role silently degrades.
- Copy: three modes (AI / brief / own) via `POST /api/adstudio/copy` → `structured_json` profile (gpt-5.5 → gpt-4.1 → gemini-flash cascade with fallback alerts). Meta char limits warn inline but **nothing blocks save/publish on over-limit copy**.
- Silent failure: images >9MB are silently dropped from AI grounding (`resolve-image-for-model.ts:30` returns `undefined`) — copy generation proceeds ungrounded with no warning.

### 2.4 Generation

- `POST /api/adstudio/campaigns` builds a **deterministic** pack (no AI) via `generator.ts`, then AI-enriches copy per variant + AI-scores (skipped for template mode to preserve curated copy).
- Template mode first calls `POST /api/adstudio/generate-clone` → `getTemplateBrief` → **fal.ai `openai/gpt-image-2/edit`** with the gallery sample as reference #1 and customer photos after it. Single provider, no fallback, no `recordAdStudioProviderRun` traceability, no compliance object, and `FAL_KEY` is not in `.env.example` — any env without it 502s.
- **Everything AI runs synchronously inside Vercel routes** (`maxDuration` 60–120s; fal poll timeout 110s deliberately tucked under the 120s budget). The async offload designed for this (`adstudio_creative_jobs` table, migration `20260614221051`) has **zero code references** — the queue was built and never wired.

### 2.5 Editing

- Fabric v6 editor (`canvas/fabric-ad-editor.tsx`) with undo/redo, click-to-edit, smart-crop, per-tile QA. Works — **for canvas-composited creatives only** (see Part 1 flaw #1).
- **Manual layout edits are silently discarded**: every draft save strips `fabricJson` to `null` (`use-campaign-actions.ts:520-529` `stripRenderState`). On reload the editor rebuilds the design from scratch; drag/resize/reposition work is lost. Copy text and image src survive only because they're separately synced into `canvas.objects`.
- Three parallel role vocabularies (`SelectedElement`, `CopyState` keys, canvas `role`/`editableKind`) are kept in sync by hand-written translation tables scattered through `fabric-ad-editor.tsx` and `ad-studio-workbench.tsx` — any template with a nonstandard role silently doesn't receive copy edits.
- **The exporter is a different renderer** (`canvas/browser-creative-renderer.ts`, hand-rolled 2D context, reimplements fonts/crop/radii) than the editor (Fabric) and the preview (SVG). "The export doesn't match what I saw" is a drift bug waiting to recur forever.

### 2.6 Persistence & state

- Tables are sane (jsonb-heavy, workspace-filtered, RLS on). But:
  - Multi-table persist is **non-atomic** with no rollback (`persistence.ts:75-195`); mid-sequence failure leaves partial campaigns.
  - **Persist failure still returns 201** with a buried `persistence: { status: "not_persisted" }` warning (`campaigns/route.ts:198-217`) — the user keeps editing a pack that was never saved.
  - Trial-credit refunds swallow errors (`generation-trial.ts:205-225`).
  - The in-flight dedup Map is per-lambda-instance only (`campaigns/route.ts:38`) — no cross-instance dedup of double-submits.
- Workbench state is a ~30-useState flat blob in `ad-studio-workbench.tsx` (1,414 lines) with prop drilling; autosave is a debounced effect + unreliable `beforeunload` async fetch (should be `sendBeacon`).

### 2.7 Dead and frozen surface (each of these confuses the next agent and breeds regressions)

- Dead panels never mounted: `campaign-panel.tsx`, `audience-panel.tsx`, `landing-panel.tsx`, `templates-panel.tsx`. Consequence: **`market`, `propertyType`, `destinationUrl` have no UI and are permanently frozen** at their initial values while still feeding generation, Google copy, and readiness.
- Dead library code: `generateAdFromTemplate`/`generateMixedImageVariantsInParallel` (the multi-provider clone path — better than what's live, and unused), `bulk-cell.ts`, `style-profile.ts`, `AdStudioLibraryTemplate` stubs, fixed-role remnants `AdStudioTemplateEditableImage.role` enum + mistyped `AdStudioTemplateSampleCopy` (`templates.ts:8-13, 53` — data only passes via `as unknown as` cast).
- Dead routes/contracts: `template-photo-prep` always 410 yet `campaigns` still returns a vestigial `photoPrep` object; Google Search/PMax/DemandGen copy packs generated and persisted though the product forces `platforms: ["meta"]`.
- Duplicated: `campaigns/[id]/duplicate` reimplements `loadAdStudioCampaignPack`; delete cascade is manual although FKs already cascade; legacy env-provider fallback duplicates the profile cascade.
- Swallowed errors: campaign-switcher fetch, starter-pack persistence, generated-image asset registration, publish-readiness polling — all `.catch(() => {})`-class.

---

## Part 3 — What is actually broken (ranked)

1. **Clone path is uneditable** — copy/canvas edits don't affect the generated image; the flagship path bypasses the whole editor (Part 1, flaw #1).
2. **No runtime verification in CI** — the real-loop e2e never runs; regressions ship green (Part 1, flaw #2).
3. **Layout edits silently lost** on every save (`stripRenderState`).
4. **Persist-failure returns success** (201 + buried warning); non-atomic writes; swallowed refunds.
5. **Frozen fields** (`market`/`propertyType`/`destinationUrl`) with no UI, still feeding generation and readiness.
6. **Clone route fragility**: single provider via fal middleman, no fallback, undocumented `FAL_KEY`, no provider-run record, no compliance gate — inconsistent with every other AI route.
7. **Three renderers** (Fabric editor / SVG preview / hand-rolled 2D exporter) guaranteed to drift.
8. **Silent degradation**: >9MB grounding drop, thumbnail-less template crash, over-limit copy publishable, `.catch(() => {})` everywhere.
9. **Template factory is manual** with unverifiable provenance and a stale wireframe script that would destroy the real gallery samples if run.
10. **Sync AI in request/response** under Vercel timeouts; the built async queue (`adstudio_creative_jobs`) unwired.

---

## Part 4 — Recommended architecture (the one decision that matters)

**Commit fully to clone-first.** Product history settles this: rules-extraction + canvas recomposition was tried repeatedly and regressed into generic, obviously-templated output (see the June fix-commit trail on gallery rendering — `bfcebc5`, `64afcbd`, `2cc4020`, `58d77c5`). A real ad's typography is integrated into the design (scrims, lighting, texture, perspective); flat text layers over a photo read as "made with a template tool." The sample image carries all of that for free, and reference-based image editing ("clone this design with these assets") is what current image-edit models are genuinely good at. The clone bet is right.

**The breakage is not the bet — it's the half-commitment.** Clone *generation* shipped (PR #148/#153) while the canvas *editing* UX from the old architecture stayed mounted: a Fabric editor, a copy panel syncing to text layers that don't exist on clone creatives, click-to-edit affordances that silently do nothing. Committing fully means:

1. **Editing = regeneration, made to feel live.** For template ads, replace the Fabric editor with a copy-fields + preview surface. On copy change, re-clone with the **fast image tier** (Gemini flash-image class — already the OpenRouter default — seconds, cents) as the working preview; run the **quality tier** (gpt-image-2 high, ~$0.21) once on "Finalize." Regenerate-on-edit only felt unviable because the clone route is locked to a single 60–110s provider today.
2. **Vision-QA reroll loop — the make-or-break piece.** Baked-in text means the model can typo the user's headline, suburb, or phone number, and today nothing checks. The machinery already exists and is dead code: `creative-qa.ts` vision QA + the `bulk-cell.ts` pattern (generate up to N rolls, keep the first that passes QA). Wire it around every clone: verify the exact copy strings rendered, auto-reroll on failure. This converts clone-first's biggest weakness into a solved problem.
3. **Consistency on re-edits.** Pass the previously accepted output as an extra reference alongside the template sample ("keep everything identical, change only the headline") so an edit doesn't reshuffle the whole design.
4. **Provider cascade instead of fal-only.** Consolidate on the direct OpenAI `images/edits` adapter (`ai-providers.ts`) with the OpenRouter Gemini image fallback — the multi-provider runner (`generateMixedImageVariantsInParallel`) is already written and dead. Add provider-run logging and compliance-gate parity with `generate-options`. Retire the fal indirection (or keep it as one cascade candidate with documented env).
5. **The template schema shrinks.** Clone-first needs only the brief — slots, copy fields, sample image, provenance, classification — which `template-brief.ts` already derives. The canvas.objects + fabricJson lockstep mirror existed to serve the editor; retire that machinery for template ads once the editor goes. The gate (diversity, provenance, one-source-one-template) stays — it protects the product regardless of rendering architecture.

Accepted tradeoffs, stated plainly: brand fonts are "close, carried by the sample," not pixel-guaranteed; copy edits cost seconds (fast tier) instead of milliseconds; no manual pixel-nudging. Given the slop failure mode of the alternative, these are the right trades.

The deterministic compositor (`generator.ts`) remains only where there is no sample to clone (blank/custom mode) — or blank mode is cut entirely in favor of "always start from a template," which is the simpler product.

---

## Part 5 — Model choices (quality #1, then speed/cost)

Current inventory (registry defaults; operator overrides can diverge — see note below):

| Task | Today | Assessment |
|---|---|---|
| Template creation (vision-reading source ads) | Manual human/agent; classifier via env-driven OpenRouter model | Wrong bottleneck — automate it (below) |
| Ad copy | `structured_json`: gpt-5.5 → gpt-4.1 → gemini-2.0-flash, with fallback alerts | Right shape; keep |
| Image options ("more options") | `image_generative`: gpt-image-2 → gpt-image-1.5 (+hardcoded OpenAI fallback), high quality, ≤4/req, 8/hr | Reasonable |
| Template clone (flagship) | fal `openai/gpt-image-2/edit`, single provider, no fallback | Fragile; consolidate per Part 4 |
| Vision QA | gpt-5.5, no fallback | Fine |

Recommendations:

1. **Template creation — use the best vision model available, cost is irrelevant.** This is an offline, low-frequency task (26 templates so far). Build a semi-automated template factory: top-tier vision model (gpt-5.5 tier, or Gemini 3 Pro / Claude via the OpenRouter plumbing you already have) reads the source ad → drafts template JSON → the existing gate validates → a human approves the rendered sample. The gate is the quality floor; the human eyeball is the taste check. This turns "add 20 templates" from a week of hand-authoring into an afternoon, which matters because **template variety is the product**.
2. **Copy — don't chase a cheaper model; chase better grounding.** Ad copy is a few hundred tokens: gpt-5.5 at $5/$30 per M costs well under a cent per generation. The quality lever is context (brand voice, suburb/market data, the template's intent, the photo grounding that's currently silently dropped >9MB), not the model ID. Keep gpt-5.5 for full generations; route the one-tap assists (Sharper, More local) to the flash-tier fallback where latency is the UX.
3. **Customer ad image — two-tier by purpose.** Edit-loop previews and rerolls: the fast/cheap image tier (Gemini flash image class — already your OpenRouter default; seconds, cents). Finalize: gpt-image-2 class at high quality, once per accepted ad. Under clone-first the quality tier runs rarely (finalize + QA-failed rerolls), so quality stays #1 while the per-ad cost stays in cents-to-a-dollar territory.
4. **Fix the config drift** so model choices are real: registry defaults (`model-registry.ts`), the operator catalog (`model-control-config.ts` — a completely different model list for the same profile keys), and `.env.example` disagree with each other today. One catalog, one source of truth, and add `FAL_KEY` to `.env.example` or remove fal.

(Note: specific vendor-model rankings shift monthly; the durable decision is the *routing shape* above — top tier where output is customer-visible pixels/copy, flash tier for iteration, everything behind the profile registry so swaps are config, not code.)

---

## Part 6 — Execution plan

### Phase 0 — Stop the bleeding (days)
- **T0.1** Wire the real-loop e2e into CI against Vercel Preview (provision the dedicated workspace + auth fixture as repo secrets). Until this exists, every other fix can silently regress. *Accept:* PR CI fails when the create→edit→save→reload→export loop breaks.
- **T0.2** Stop the editor lying: given clone-first (Part 4), don't invest in `fabricJson` persistence — remove drag/resize affordances (or the Fabric editor entirely) for clone creatives now, ahead of the T1.3 rebuild. If the compositor editor stays for blank mode in the interim, either persist its `fabricJson` or remove its layout tools too. *Accept:* the user cannot produce edit state that won't survive reload.
- **T0.3** Make persistence failures fail: `campaigns` POST returns 5xx when `persistAdStudioCampaignPack` errors (client retries), and wrap the multi-table persist in a transaction (RPC) or write the pack as one jsonb document first, fan out after. *Accept:* no 201 with `not_persisted`.
- **T0.4** Fix or clearly gate the clone-path editing lie: until Part 4 lands, show "AI-generated — regenerate to change text" on clone creatives and hide the dead copy-sync affordances. *Accept:* no silent no-op edits.
- **T0.5** Delete `scripts/generate-adstudio-samples.mjs` (or rewrite it to produce the real composites) before it destroys the gallery. Add `FAL_KEY` to `.env.example` while it's still load-bearing.
- **T0.6** Unfreeze or remove `market`/`propertyType`/`destinationUrl`: either mount a minimal settings surface or stop feeding frozen values into generation/readiness. Delete the four dead panels.

### Phase 1 — One architecture (1–2 weeks)
- **T1.1** Clone provider cascade (Part 4 §4): direct OpenAI `images/edits` primary + OpenRouter Gemini image fallback via the existing (dead) `generateMixedImageVariantsInParallel`, provider-run logging, compliance-gate parity with `generate-options`. Two tiers behind the profile registry: fast tier for edit previews, quality tier for finalize.
- **T1.2** Vision-QA reroll loop around every clone (Part 4 §2): verify the exact copy strings rendered (headline, suburb, phone, CTA), auto-reroll up to N using the `bulk-cell.ts` roll pattern + `creative-qa.ts` vision QA. *Accept:* a fixture clone with a deliberately hard headline never ships with mangled text.
- **T1.3** Rebuild the edit surface for template ads (Part 4 §1): copy fields + preview + "Finalize"; fast-tier re-clone on copy change, prior output passed as consistency reference (§3). Retire the Fabric editor and the role-translation tables for clone creatives; `browser-creative-renderer.ts` goes with it (export = the finalized image itself).
- **T1.4** Move clone generation async: wire `adstudio_creative_jobs` (or a trigger.dev task); the route enqueues, the client polls/streams progress. Kills the 120s ceiling, enables multi-variant clones and QA rerolls without timeout pressure.
- **T1.5** Slim the template contract (Part 4 §5): template = brief (slots, copy fields, sample, provenance, classification) + gallery assets. Fix the `templates.ts` legacy types (`sampleCopy` free-form, delete the fixed-role `editableImage` enum and library stubs) so the `as unknown as` cast goes away; drop the fabric-mirror lockstep requirement once no editor consumes it (update the gate deliberately, with a test — not by weakening).

### Phase 2 — Template factory (the growth lever)
- **T2.1** Semi-automated template builder: vision-model extraction → template JSON draft → gate → human approve, run as a Hermes skill upgrade. Record verifiable provenance (store the source-ad snapshot hash so the gate can check it in CI).
- **T2.2** Gallery samples rendered by the real renderer per template (kills the ad-hoc SVG tooling and makes SKILL.md's equivalence claim true).
- **T2.3** Brand-aware gallery previews (recolor/refont the sample per brand kit at render time) — the hook already exists (`templatePreviewDataUrl(template, brandKit)`) and ignores its brandKit argument today.

### Phase 3 — Hardening
- Block publish on over-limit copy; surface the >9MB grounding drop; replace `.catch(() => {})` with toasts; `sendBeacon` for unload flush; busy states on Save/Delete; cross-instance dedup via the deterministic campaignId (upsert-if-absent); remove Google copy-pack generation until Google ships; delete `template-photo-prep`, `bulk-cell`, `style-profile` or wire them deliberately.

---

## Appendix — Key file map

Generation: `src/lib/adstudio/generator.ts` (clone creative `:1016-1060`), `reference-clone.ts` (dead multi-provider path `:186-193`), `creative-options.ts`, `campaign-copy-enrichment.ts`, `copy-generation.ts`.
Routes: `src/app/api/adstudio/campaigns/route.ts` (partial-persist 201 `:198-217`), `generate-clone/route.ts`, `generate-options/route.ts`, `copy/route.ts`, `media/route.ts`.
Frontend: `src/components/adstudio/ad-studio-workbench.tsx`, `new-ad-dialog.tsx` (+`-slots.ts`), `use-campaign-actions.ts` (`stripRenderState` `:520-529`), `canvas/fabric-ad-editor.tsx`, `canvas/browser-creative-renderer.ts`; dead panels `panels/{campaign,audience,landing,templates}-panel.tsx`.
Templates: `src/lib/adstudio/template-gallery/`, `templates.ts` (legacy types `:8-13,:53`), `template-brief.ts`, `template-preview.ts`; gate `scripts/verify/adstudio-templates.mjs`; skill `hermes/skills/adstudio-template-builder/SKILL.md`; stale generator `scripts/generate-adstudio-samples.mjs`.
Models: `src/lib/ai/model-registry.ts`, `model-control-config.ts`, `src/lib/adstudio/ai-providers.ts`, `fal-image-provider.ts`, `resolve-image-for-model.ts` (9MB drop `:14,:30`).
Persistence: `src/lib/adstudio/persistence.ts`, `supabase/migrations/202605270003_adstudio.sql`, dead queue `20260614221051_adstudio_creative_jobs.sql`.
CI/e2e: `.github/workflows/hard-reset-verification.yml`, `e2e/adstudio-real-loop.spec.ts`.
