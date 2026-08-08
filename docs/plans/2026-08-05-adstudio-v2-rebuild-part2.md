(Continuation of `2026-08-05-adstudio-v2-rebuild.md` — §4 onward)

## 4. The renderer — one deterministic function, two backends

**New dir: `src/lib/adstudio/v2/render/`**

```
render-doc.ts     renderAdDoc(ctx: Canvas2DLike, template, instance, assets): void
                  — pure draw sequence: plate → slots (cover-crop w/ focal+zoom+mask)
                    → overlay patches → text layers (per-line measured path first,
                    block-wrap fallback, shrink-to-fit floor autoFitMinRatio; refuse
                    → throw RenderFitError, never microtype). Ports the proven logic
                    from src/components/adstudio/canvas/text-patch.ts (measured-line
                    mapping, scaledTextWidth, glyph-ink height) to full-frame.
fonts.ts          browser: FontFace/document.fonts loader (port of loadPatchFonts);
                  node: GlobalFonts.registerFromPath over public/fonts/adstudio/*.woff2.
assets.ts         loads plate/patches/customer images → ImageBitmap (browser) /
                  Image (node) with sha256 verification for template assets.
server.ts         renderAdDocToPng(template, instance, values): Buffer — @napi-rs/canvas
                  backend at exact 1080×1350 / 1080×1920. THE canonical pixel producer.
cover-crop.ts     shared math: focal+zoom cover placement (extract from smart-crop.ts
                  focalCoverPlacement; keep computeFocalPointFromLuma for defaults).
truncate.ts       (used by meta-frame, lives here for reuse) — see §8.
```

- `@napi-rs/canvas` moves from devDependencies to **dependencies** (prebuilt linux-x64 binary works on Vercel Node runtime — verify in the first deploy; fallback is rendering on the VPS worker via a `render.addoc` job, the wiring for which already exists in `worker/index.ts` style).
- **Canonical render = server render.** Client editor never uploads pixels; it posts doc mutations, server re-renders (~100–200 ms), returns media paths. This kills the client-trust problem and the 4 MB patch plumbing entirely.
- **Parity harness:** `tests/render-parity/` — 3 fixture templates (1 simple, 1 with overlay patches + effects, 1 story) rendered (a) in node via `server.ts`, (b) in Chromium via a Playwright-driven harness page (`/dev/render-harness`, dev-only route) running `render-doc.ts` on a browser canvas. Assert: pixels outside text boxes **byte-identical** (plates/patches/slots are drawImage — must match exactly); text-box regions SSIM ≥ 0.97 (AA differences only). This is a hard CI gate; it is what makes "editor preview == published pixels" a tested fact instead of a hope.

## 5. Template ingestion + Template Studio

### 5.1 CLI — `scripts/adstudio/v2/ingest.mjs` (subcommands; Node, runs locally/CI/VPS — build-time only)

| Command | What it does |
|---|---|
| `analyse --source <path> --id <id>` | Unchanged v1 vision extraction of the input contract (reuse `scripts/adstudio/create-template.mjs` analyse internals; model `gpt-4.1` default). Also records `sourceValues` (the source's own on-image text per key) into `template-gallery-v2/<id>/evidence.json` for the fidelity gate. |
| `decompose --id <id>` | **On the SOURCE ad (D5):** (a) OCR regions via `scripts/build/font-corpus/detect-regions.mjs`; (b) font match via corpus Stage A/B; (c) build text-inpaint mask, call gpt-image-2 `/images/edits` once, then `derivePlateFromInpaint`-style composite so **pixels outside masks come from the source bytes** (port from `src/lib/adstudio/layer-derivation.ts` + `clone-generation.ts` mask/composite helpers into `scripts/adstudio/v2/lib/`); (d) slot boxes from analyse; slot mask heuristic (corner-radius probe on plate edges; default `rect`); (e) emit `template.json` draft with `exactness.status: "draft"` + residual report. There is **no full-image generation step anywhere** — the v1 `render`/safe-sample-clone command does not carry over. |
| `restyle --id <id>` | Applies the Studio-recorded `restyle` block headlessly (palette remap on text/effects + optional plate hue remap via deterministic sharp recolour, generic slot assets, safe copy) and renders the **public sample** via `render/server.ts`, back-filling `sample.contentHash`. Fails if the result's hash equals the source hash or restyle evidence is trivial. |
| `story-draft --id <id>` | Auto-draft 9:16: place feed content via `outpaint-layout.ts` math; extend plate to 1920 by (i) sampled-edge blur-extend (deterministic default) or (ii) one-time generative outpaint of the margin bands only (flagged `--ai-extend`, build-time only); reposition layers into safe zones. Marks layout `draft`. |
| `check --id <id>` | **The fidelity gate** (§10.2). Renders the doc with `sourceValues` + source photos via `render/server.ts`, compares vs the SOURCE ad. Also runs the **stress renders** (worst-case inputs) and asserts they don't throw. Writes `exactness.residuals`. |
| `migrate-v1 --id <id>\|--all [--from source\|sample]` | Builds a v2 draft from an existing v1 template: reuse `typography` (100% coverage incl. `measuredLines`), `deterministicEditing.imageBoxes`, `meta` block; decompose from the original source in `meta_ad_candidates/` (`--from source`, the default for the launch set) or, for the long tail initially, from the already-inspected v1 clone sample (`--from sample`, rebased to source opportunistically later). |
| `emit-fonts` | Extends `scripts/build/font-corpus/build-runtime-fonts.mjs` to also cover v2 docs (same manifest, same license gating). |

Python deps for ingestion only (OpenCV, tesseract, `rembg` for overlay-patch background removal) run wherever the operator runs the CLI (dev machine / Hermes VPS) — **never on Vercel**. Same posture as today's font-corpus scripts.

### 5.2 Template Studio (operator UI)

Routes: `src/app/(operator)/operator/template-studio/page.tsx` (queue: all templates × status draft/qa/ready, residual summary, intent coverage meter) and `.../template-studio/[id]/page.tsx`.

The `[id]` screen **mounts the same editor component** (§7) in `mode: "studio"`:
- centre: Konva canvas with format tabs (Feed / Story) + **diff view** (toggle original SOURCE ad at 50% opacity or side-by-side; per-region residual badges).
- left: layer list; per-layer panels — text: font picker seeded from the corpus shortlist (top-10 candidates with live re-render on select), size/tracking/line-height nudge, colour picker seeded from detection, "mark baked" button; slot: box nudge, mask kind/radius, default focal, min-res override; overlay patch: draw box → auto background-removal → accept/redraw.
- **Restyle tab (mandatory before ready, D5):** palette remap picker (detected source colours → safe palette; applies to text/effects and optionally plate elements), generic-asset assignment per slot, safe-copy fields — records the `restyle` block and renders the public sample.
- **Stress preview (mandatory before ready):** one click renders the adversarial matrix — longest legal copy per field, 1-char copy, worst-aspect + minimum-resolution photos, all-slots-portrait, all-slots-landscape — as a strip. A template that renders ugly here gets fixed (tighter maxLength, bigger box, baked region) or doesn't ship.
- right: fidelity report (per-region residual vs threshold), input contract editor, publish-defaults editor (§9 block), safe-zone overlay toggle on story, advisory AI critique (reuse `hermes/skills/blockwise-image-reviewer` as a non-blocking pre-screen), and the **Approve** button → server re-runs `check` + stress renders, requires restyle evidence + story present + all residuals ≤ threshold, then a required confirmation checkbox — **"Inspected at 100% zoom; a designer would ship this"** — stamps `qaBy/qaAt`, sets `ready`. The human holds the button; the AI critic never approves.
- API: `src/app/api/operator/template-studio/[id]/route.ts` (GET doc, PATCH doc, POST check, POST approve). Template JSON writes go through a PR-less commit path? **No** — Studio edits write to the working tree via a local-dev-only file API guarded to `NODE_ENV !== "production"` (same posture as the existing `/operator/template-trace` tooling), because template docs are repo-versioned. Production Studio is read-only + review.

### 5.3 Anti-slop / diversity gates (carried forward and strengthened)
- One source ad → at most one template; sample hash ≠ source hash; restyle evidence non-trivial (D5); no source advertiser identity (name/phone/URL/logo) in the public sample — vision spot-check in `check`, human-verified at approval.
- **Source curation bar (quality ceiling):** only proven, designer-grade ads enter `meta_ad_candidates/` — intake requires the ad-radar classification plus an explicit "designer-grade" curation flag recorded in evidence; the gallery can never look better than its sources, so rejection at intake is the cheapest quality control. Performance loop: templates with sustained poor campaign performance (existing read models) get flagged for retirement — curation is continuous, not one-time.
- Diversity: ≥ 5 distinct non-`other` `primary_intent`; no intent > 50% of gallery (unchanged).
- **New:** layout-skeleton diversity check — the gate compares each template's normalized layer-box signature (sorted boxes, quantized to a 12×12 grid) and fails if > 3 templates share an identical signature. This is the concrete guard for "templates don't end up all looking the same".

## 6. Customer generation — deterministic

Modify `src/app/api/adstudio/campaigns/route.ts` + new `src/lib/adstudio/v2/generate.ts`:

1. Template resolved via new `src/lib/adstudio/v2/template-resolver.ts` (`resolveReadyTemplateV2`; only `exactness.status === "ready"` templates are customer-visible).
2. Copy step unchanged (customer-provided copy verbatim; else `generateAdStudioTemplateCopy` — text AI, allowed).
3. Build `AdDocInstance` per format (feed always, story if template has it): customer images → slots (default focal from `computeFocalPointFromLuma`; enforce `minSourcePx` — < 1.0× slot size returns a warning in the response, < 0.5× is a 400 with a "photo too small for this design" message), copy → text values (validated against `maxLength`, required-ness — reuse `resolveCloneCopy` semantics without the truncate-silently behaviour: over-limit is a 400, not a truncation).
4. `renderAdDocToPng` both formats inline (< 1 s total) → `persistCloneRender`-equivalent upload (`src/lib/adstudio/v2/media.ts`, same `workspace-artifacts` paths, `${workspaceId}/adstudio/renders/...`).
5. Persist pack via the existing `adstudio_persist_campaign_pack` RPC — `canvas_json` = instance doc + `renders`; `render_status: "rendered"`.
6. Credits: reserve/settle **0 render credits** for v2 generation (renders are ~free); AI copy assist still meters as today. (Pricing revisit is a product decision, out of scope; wiring stays.)
7. Delete-on-cutover: the delayed VPS recovery job for generation becomes unnecessary (< 2 s inline) — keep the enqueue for one release as a belt, then remove.
8. The old `prepareCloneCreativeTextLayers` background task, plate derivation, `assertDeterministicFeedEditingReady`, story-after-feed orchestration: **all gone** on the v2 path.

Editing endpoint: **new** `src/app/api/adstudio/creatives/[id]/doc/route.ts` — POST `{ mutationId, expectedRevisionId, instance }`: validates instance against template (locked layers, guided-mode override whitelist, brand-palette colour set), re-renders server-side, appends a revision via the existing `adstudio_append_creative_revision` CAS RPC, returns `{ revisionId, renders }`. Undo/redo = existing revision walk (`action: "undo"|"redo"` reuse from the current edit route's history pattern, minus image-model paths). 409 semantics (`ADSTUDIO_STALE_REVISION` etc.) unchanged.
---

## 7. The editor — "simple Polotno" on Konva

**Deps to add:** `konva` (^10.3), `react-konva` (^19.2), `react-konva-utils` (^2), `use-image` (^1.1). All MIT. No Polotno, no Fabric, no cloned "open-Polotno" code (the flagship clone repo is DMCA'd — do not reference it).

**New dir: `src/components/adstudio/editor/`** — all styling via shadcn/Tailwind (`.tw` scope). **Zero additions to `src/components/adstudio/styles.ts`.**

```
editor-root.tsx          props: { template, instance, mode: "guided"|"advanced"|"studio",
                           onChange(instance), onSave(), placement, brandKit }
                         Owns local doc state + undo/redo stack (in-memory, coalesced
                         per gesture) + dirty/autosave (debounced onSave → /doc route).
editor-canvas.tsx        react-konva Stage sized to fit container (device-pixel-ratio
                           aware). Layers bottom→top: plate Image, image slots (Group:
                           clipped cover-crop image; drag = pan focal in guided),
                           overlay patches, text nodes (Konva.Text w/ letterSpacing,
                           lineHeight, stroke/shadow/gradient from typo.effects).
                         Selection: click/tap; Transformer only in advanced/studio,
                           with keepRatio + bound constraints; guided shows a static
                           selection outline + 44px hit targets (a11y parity with the
                           current editor's ::after pattern).
                         Snapping (advanced/studio): centre/edge guides, 4px threshold
                           (Konva Objects_Snapping pattern).
text-edit-overlay.tsx    Double-click/Enter opens a DOM <textarea> via react-konva-utils
                           <Html>, position/style-matched (Editable_Text pattern), live
                           char counter vs maxLength, Esc/Cmd+Enter semantics preserved
                           from the current editor.
panels/text-panel.tsx    content, counter, AI-rewrite chips (reuse existing copy assist);
                           advanced: size step ±, align; studio: full typo controls.
panels/image-panel.tsx   replace (media library / upload via existing media-upload.ts),
                           zoom slider (1–3×), reset focal; drag-to-pan hint; low-res
                           warning when the photo is under the slot's minSourcePx.
panels/brand-panel.tsx   guided colour swap: eligible text layers recolour to brand
                           palette entries only (brandKit.colours.*).
toolbar.tsx              undo/redo/zoom(1–3×, dbl-click zoom, drag-pan — port behaviours
                           from in-place-ad-editor)/format switch/Advanced toggle
                           (persist per user in localStorage)/Save state chip.
state/use-editor-doc.ts  reducer over AdDocInstance; guided-mode guard rails (rejects
                           overrides not in the whitelist); selectors.
```

Accessibility & mobile: keep the current editor's contract — 44 px targets, arrow-key region walking, Escape, mobile sheet for panels (`Sheet` from `src/components/ui/`), zoom/reflow at 320 px. The existing tests `tests/adstudio-inplace-editor.test.ts` define the bar; their replacements (§12) assert the same behaviours on the new components.

**Workbench integration:** `src/components/adstudio/ad-studio-workbench.tsx` Edit section swaps `MetaChromePreview→InPlaceAdEditor` for `MetaFrame→EditorRoot` behind the v2 flag. Nav, sections, autosave chrome unchanged (per `docs/CLAUDE-CODE-PROMPT-STAGE2.md`: consume the shell, don't redesign it).

**Fonts:** editor preloads exactly the template's `fonts[]` via `render/fonts.ts` before first paint (prevents wrong-face flash — the Tier-2 lesson from `docs/plans/2026-07-27-adstudio-magic-layers-editor.md` stands).

## 8. Meta placement frames — "exactly what it will look like in Meta"

**New dir: `src/components/adstudio/meta-frame/`** replacing `MetaChromePreview`/`AdPreview` in `src/components/adstudio/preview.tsx`.

```
meta-frame.tsx        <MetaFrame placement={...}> wraps any child (editor canvas or a
                        finished render <img>). Placement picker = shadcn Tabs.
placements/
  fb-feed-mobile.tsx  iPhone-width feed post: 40px avatar, page name, "Sponsored ·",
                        ellipsis; primary text w/ real truncation; media; link area
                        (grey bar: domain — from resolveAdvertiserDomain — headline,
                        description, CTA button w/ real enum label); Like/Comment/Share row.
  fb-feed-desktop.tsx 500px card variant (the current .studio-metachrome-card values —
                        #050505/#65676b/#dadde1/#f0f2f5 — are already correct; port them
                        to Tailwind tokens scoped to the frame).
  ig-feed.tsx         IG header (avatar, username, Sponsored), full-bleed media, blue
                        CTA bar ("Learn more ›"), action row, caption w/ "… more".
  ig-story.tsx        progress bars, avatar+name+Sponsored top; CTA pill bottom-centre;
                        gradient scrims; safe-zone-correct chrome insets.
  fb-story.tsx / ig-reels.tsx  Reels: right-side engagement rail, bottom caption + CTA,
                        672px bottom clearance visualized.
safe-zone-overlay.tsx dashed top-250/bottom-340 (stories) & Reels bands — toggle,
                        shown by default in Studio, on-demand for customers.
truncate.ts           (lives in src/lib/adstudio/v2/render/truncate.ts) — constants:
                        FB_FEED_PRIMARY_SEE_MORE = 125 chars / 3 lines,
                        HEADLINE_VISIBLE ≈ 27 chars ellipsis, DESC_FB_ONLY = true,
                        IG_CAPTION_MORE = 125, STORY_PRIMARY_OVERLAY ≈ 40.
                        (Best-known 2026 values; marked approximate in code comments —
                        Meta doesn't publish hard numbers. §15 keeps them re-checkable.)
```

Fidelity contract: each placement frame is built from Meta's current visual layout and our requirements register (Appendix A). Live copy binding: clicking primary text/headline/description/CTA in the frame focuses the matching field (preserve the existing `onSelectText` wiring from `MetaChromePreview`). Character-truncation behaviour renders exactly as Meta would (with "See more" interaction).

**Ground-truthing:** the publish review step gains a **"Check against Meta's preview"** action → `GET /act_{id}/generatepreviews` with the actual creative spec (works pre-publish), rendering Meta's own iframe next to ours for: `MOBILE_FEED_STANDARD`, `DESKTOP_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `FACEBOOK_STORY_MOBILE`, `INSTAGRAM_REELS`, `RIGHT_COLUMN_STANDARD`. Iframes expire in 24 h and are rate-limited under standard `ads_management` BUC — fetch on demand only, never automatically. This keeps our hand-built chrome honest forever (and is the acceptance tool for the frame-fidelity tasks).

## 9. Publish — every field, self-contained, v26

### 9.1 Template publish block (part of `AdTemplateDocV2`)

```ts
export type TemplatePublishDefaults = {
  platform: "meta";
  objective: "OUTCOME_LEADS";
  specialAdCategory: "housing";                       // unchanged, hard law
  apiVersionMin: "v26.0";
  copy: { primaryText: string[]; headlines: string[]; descriptions: string[] };  // ≤5 each
  cta: MetaLeadCta;                                    // see 9.3
  leadForm: { headline: string; questions: string[];   // CUSTOM questions
              thankYou: { title: string; body: string } };
  placements: { publisherPlatforms: ("facebook"|"instagram")[];
                facebookPositions: string[]; instagramPositions: string[] };
  /** Which of our formats serves which placement (drives asset_feed_spec rules). */
  formatRouting: { feed: "4:5"; story: "9:16" | null };
  /** Explicit Advantage+ creative feature enrollment — default all OPT_OUT. */
  creativeFeatures: Record<string, "OPT_IN" | "OPT_OUT">;
  previewFormats: string[];                            // generatepreviews ad_format QA list
};
```

### 9.2 Changes in `src/lib/providers/` (the only publish files that change)

1. **`meta-graph-version.ts`**: default `"v23.0"` → **`"v26.0"`** (env override preserved). v23.0 expired 2026-06-09 — today's calls are silently riding version fallback; pin properly. Verify with the probe (below) before merge.
2. **`meta-execution.ts` creative build** (`buildCreativePlans` + the POST at ~line 787):
   - `MetaPublishCreativePlan` gains `formatAssets: { feed: {storagePath|imageHash, width, height}, story?: {...} }` and `creativeFeatures`.
   - **Two-image path (story present + `META_ASSET_FEED_ENABLED=true`):** upload both via `/adimages` (existing `resolveCreativeImageHash` flow, extended to two), then creative payload = `object_story_spec { page_id, instagram_user_id?, link_data { message, name, description, link: "@url:https://fb.me/", call_to_action { type, value { lead_gen_form_id } } } }` **plus** `asset_feed_spec { images: [{hash, adlabels:[{name:"feed_image"}]}, {hash, adlabels:[{name:"story_image"}]}], ad_formats: ["SINGLE_IMAGE"], optimization_type: "PLACEMENT", asset_customization_rules: [ {customization_spec:{publisher_platforms:["facebook","instagram"], facebook_positions:["feed","marketplace","video_feeds","search"], instagram_positions:["stream","explore","explore_home","profile_feed","ig_search"]}, image_label:{name:"feed_image"}, priority:1}, {customization_spec:{publisher_platforms:["facebook","instagram"], facebook_positions:["story"], instagram_positions:["story"]}, image_label:{name:"story_image"}, priority:2} ] }`. Ad set targeting positions must cover every rule position (extend `buildTargeting`); `is_dynamic_creative` stays false.
   - **Fallback path (flag off / story absent):** current single-image `link_data` payload, unchanged.
   - **The combined lead-ads + asset_feed_spec shape is UNVERIFIED in Meta docs** (flagged by research). Hence the flag + probe: it must pass `generatepreviews` AND one real PAUSED create on the dev ad account before default-on. If Meta rejects it, documented fallback: publish two creatives/ads in the ad set with placement-split via `asset_customization_rules` alternative → if that also fails, feed-image-everywhere (today's behaviour) remains.
   - **`degrees_of_freedom_spec`:** always sent: `{ creative_features_spec: { image_touchups:{enroll_status:"OPT_OUT"}, image_templates:{...OPT_OUT}, text_optimizations, inline_comment, enhance_cta, image_animation, image_background_gen, adapt_to_placement, media_type_automation, product_extensions: OPT_OUT } }` (from template `creativeFeatures`; unknown-key errors → drop that key, log, continue — Meta renames these periodically; the probe catches it). This is what makes "preview = what Meta renders" true; today nothing is sent and Meta's defaults can rewrite creatives.
3. **`meta-cta.ts`**: `META_CTA_VALUES` → `["LEARN_MORE","SIGN_UP","GET_QUOTE","APPLY_NOW","DOWNLOAD","SUBSCRIBE"]` (the documented lead-ads subset). `CONTACT_US` (currently in the list) is **not** in Meta's documented lead-ad CTA list — remap legacy packs `CONTACT_US → LEARN_MORE` at payload build with a logged warning, and retarget the `toMetaCta` keyword table (book/contact/appraisal → `GET_QUOTE`). Extend `labelForMetaCta`.
4. **Probe script:** `scripts/verify/meta-publish-probe.mjs` — env-gated (`META_PROBE_AD_ACCOUNT_ID`, dev token): (a) `generatepreviews` with the full v2 creative spec for every `previewFormats` entry; (b) optional `--create` = real PAUSED campaign/adset/form/creative/ad on the dev account, then delete. Run before enabling `META_ASSET_FEED_ENABLED` and after any Meta version bump. **Never weakened, never in CI** (needs live creds).

### 9.3 Publish panel (UI)

`src/components/adstudio/panels/publish-panel.tsx` keeps its 6-step structure. Changes: Creatives step shows **both placements inside their real frames** (`MetaFrame` with the rendered PNGs); Lead form + copy steps **prefill from `template.publish`** (customer still edits; existing char limits 125/40/90 enforced); Review step adds a "What will be sent" expandable listing the exact payload fields (name, message, image hashes, CTA, form, placements, enhancements: all OPT_OUT) and the "Check against Meta's preview" action (§8). Everything still lands PAUSED; kill switch `BLOCKWISE_ENABLE_PROVIDER_WRITES` untouched.
---

## 10. Gates (the new hard-reset law)

### 10.1 `scripts/verify/adstudio-templates-v2.mjs` (replaces the v1 gate at cutover; both run during transition)

Hard failures:
1. Schema: every `template-gallery-v2/*/template.json` parses `templateDocV2Schema`; `id` == dirname; no duplicate ids; no duplicate `sourceAd` across v1+v2 combined.
2. Assets: plate/patch/sample files exist; sha256 matches doc; plate dims == layout dims; sample hash ≠ source hash; no file under `public/adstudio-templates/` orphaned or unreferenced.
3. Fonts: every `fonts[]` entry exists in `public/fonts/adstudio/manifest.json` with matching sha256 + license.
4. Contract: input keys unique; every non-baked text input has a text layer in every format; every image input has a slot in every format; guided `editPolicy` sane.
5. Story safe zones: no text/slot content in top 250 px / bottom 340 px of story layouts (hard); Reels 672 px bottom = warning.
6. `ready` templates: `qaBy/qaAt` present; residuals recorded and ≤ thresholds (10.2); story layout present; **restyle evidence non-trivial + sample hash ≠ source hash (D5)**; every slot has an effective `minSourcePx`.
7. Publish block: CTA ∈ lead subset; copy arrays ≤5 entries, each within 125/40/90; lead-form questions non-empty; placements cover `formatRouting`; `creativeFeatures` covers the full known feature list (no silent omissions).
8. Diversity: ≥5 distinct non-`other` intents; ≤50% per intent; **layout-skeleton signature collision ≤ 3** (§5.3).
9. Renderer smoke: render every `ready` template's sample values at both formats via `render/server.ts`; must not throw; output dims exact. **Stress matrix** (longest legal copy, min-res photos, worst aspects) renders without throwing for every `ready` template.

### 10.2 Fidelity thresholds (the anti-slop number)

`check` renders the doc with the **source's own values** (`sourceValues` from evidence + the source's photo crops) and compares against the **original source ad** — i.e. we prove the template can reproduce the designer's actual ad before we let it reproduce anyone else's (D5):
- **Outside text boxes and restyled plate regions: byte-identical** (plate + patches + untouched slot pixels are drawImage of source bytes — any diff is a pipeline bug; hard fail). Restyle recolours are excluded from this comparison by the recorded `paletteMap` regions.
- **Per text region:** grayscale RMSE over the padded box ≤ **0.14** AND stroke-profile distance (reuse `match-font.mjs` Stage-B metric) within its existing live-gate bounds. A region over threshold cannot ship editable — Studio must fix font/spec or mark it baked.
- Store per-region values in `exactness.residuals`; the gate re-verifies (no self-reported passes).

### 10.3 `npm run` wiring

`verify:hard-reset` = old chain **+ `adstudio-templates-v2.mjs`** (Phase 0 adds; cutover phase removes the v1 gate together with the v1 gallery). New: `test:render-parity` (Playwright harness, §4) added to `check` in CI. AGENTS.md acceptance (typecheck + test + preview-URL verification) unchanged and applies to every track below.

## 11. Data, flags, env

- **No new tables.** Instance docs live in `adstudio_creatives.canvas_json` (jsonb, shape-tagged by `schema`); revisions/mutations RPCs reused as-is. `rowToCreative` gains v2-shape passthrough (`normalizeCloneQa` only runs on v1 shapes).
- **Migration `2026xxxx_adstudio_v2_render_status.sql`:** none required — statuses reuse existing enums. (If an agent believes it needs DDL, it is wrong; stop and re-read.)
- **Flags/env (add to `.env.example` + `scripts/verify-env.mjs`):**
  - `ADSTUDIO_TEMPLATES_V2` (server, default `false`) — gallery serves v2 `ready` templates; generation/edit routes accept v2.
  - `META_ASSET_FEED_ENABLED` (server, default `false`) — two-image asset_feed creative path.
  - `META_PROBE_AD_ACCOUNT_ID` (dev only, probe script).
  - Env flags are the whole mechanism — test with flags on in a Vercel Preview deploy (Preview has its own env). Do NOT invent a per-workspace flag system; if one is genuinely needed later, follow `src/lib/features/route-availability.ts` conventions.
- **Rollback:** flags off → v1 path fully intact until the Cleanup phase runs. After cleanup, rollback = `git revert` of the cleanup PR (v1 data was never mutated; v2 writes are additive).

---

## 12. Execution plan — parallel agent tracks

**Ground rules for every agent (paste into each brief):**
- Branch from `origin/main`. One worktree per track (`git worktree add`). Never touch `codex/atlantic-design-system`.
- Obey `AGENTS.md` as rewritten in Phase 0 (§16). Acceptance for every PR: `npm run typecheck`, `npm run test`, `npm run verify:hard-reset` green; UI tracks additionally follow the Mandatory UI workflow — explicitly invoke `$impeccable`, name commands used (`critique -> craft -> adapt -> harden -> polish` minimum), verify on a Vercel Preview URL at 1440/768/390/320 px, and report routes+viewports checked.
- No new global CSS; customer UI = shadcn + Tailwind on the `--ui-*` bridge only. No additions to `src/components/adstudio/styles.ts`.
- New env vars must land in `.env.example` + `scripts/verify-env.mjs` in the same PR. No TODO comments. No `../../../` deep imports. No new deps beyond those named in this plan without owner sign-off.
- Interfaces you consume are defined in §3 (`template-doc.ts`) — if the type you need is missing, stop and flag; do not invent a parallel type.
- Finish with `hermes/skills/blockwise-agent-cleanup/SKILL.md`.

### Phase 0 — Law + Foundation (serial, 1 agent, ~1 day) — everything depends on this
**Agent F0.** Deliverables:
1. Rewrite the registers (§16 has the exact replacement text): `AGENTS.md` AdStudio section, `PRODUCT.md` principles 3–4, retire `hermes/skills/adstudio-template-builder/SKILL.md` → new `hermes/skills/adstudio-template-builder-v2/SKILL.md`, update root `CLAUDE.md` pointer. Commit this FIRST so no later agent trips on the old law.
2. `src/lib/adstudio/v2/template-doc.ts` (types + zod, §3) with unit tests (`tests/adstudio-v2/template-doc.test.ts`: valid fixture parses; each rule in §3 has a failing fixture).
3. `src/lib/adstudio/v2/render/` complete (§4) + `render/fonts.ts` + `cover-crop.ts` + 3 fixture templates under `tests/fixtures/adstudio-v2/` + `tests/adstudio-v2/render-doc.test.ts` (fit/refusal, cover math, effects) + the Playwright parity harness + `test:render-parity` script.
4. `@napi-rs/canvas` → dependencies; Vercel build verified on a Preview deploy (render a fixture in a dev-only route).
5. Flags/env plumbing (§11) + `scripts/verify/adstudio-templates-v2.mjs` skeleton (schema+assets+fonts checks; exactness checks land with Track C).
**Acceptance:** parity gate green in CI; `verify:hard-reset` (old + new skeleton) green; registers merged.

### Phase 1 — four tracks in parallel (after F0 merges; ~3–5 days)

**Track A — Editor (UI agent).** §7 scope. Consumes `template-doc.ts` + `render/`. Builds `editor/` components, guided/advanced/studio modes, text overlay, panels, toolbar, state; mounts in workbench behind `ADSTUDIO_TEMPLATES_V2`; new route `api/adstudio/creatives/[id]/doc` (with CAS reuse). Tests: `tests/adstudio-v2/editor-*.test.ts` re-asserting the behaviour bar from `tests/adstudio-inplace-editor.test.ts` (44px targets, keyboard walk, undo/redo always succeed, mobile sheet, zoom/pan) + guided-guard tests (override whitelist). MUST NOT touch: publish panel, meta-execution, ingestion.
**Track B — Meta frames (UI agent).** §8 scope. `meta-frame/` placements, `truncate.ts`, safe-zone overlays, publish-review integration point (component only; panel wiring lands in Phase 2), generatepreviews comparison action (API route `api/adstudio/meta-preview` proxying `/act_{id}/generatepreviews` with the workspace's connection). Fidelity acceptance: side-by-side screenshots vs Meta's own preview for the 7 formats attached to the PR. Replaces `MetaChromePreview` usage in workbench (flagged). MUST NOT touch: editor internals, meta-execution write paths.
**Track C — Ingestion + Studio (pipeline agent).** §5 scope. `scripts/adstudio/v2/ingest.mjs` (+`lib/` ports of mask/inpaint-composite/outpaint/story-draft), exactness `check` (§10.2) wired into the v2 verify gate, `migrate-v1` command, Template Studio routes/UI in studio mode (depends on Track A's `editor-canvas` — build CLI first, Studio UI once A's canvas merges; coordinate via the shared branch). Runs `migrate-v1 --all` producing 71 drafts + residual report artifact. MUST NOT touch: customer generation route, publish.
**Track D — Publish (backend agent).** §9 scope. Version bump to v26.0, `meta-cta.ts` subset, `formatAssets` plumbing, asset_feed path + DOF spec behind `META_ASSET_FEED_ENABLED`, probe script, targeting-position coverage, request-log redaction for two images. Tests: payload snapshot tests per fixture template (exact JSON sent for: flag off, flag on, story absent, legacy CONTACT_US pack); worker unchanged-behaviour tests. Runs the probe against the dev ad account and attaches output to the PR. MUST NOT touch: editor, frames, ingestion.

### Phase 2 — two tracks in parallel (~2–3 days)

**Track E — Customer path cutover (backend agent).** §6 scope: v2 generation in `campaigns/route.ts`, `v2/generate.ts`, `v2/template-resolver.ts`, gallery serving v2 `ready` templates (NewAdDialog template cards work unchanged off the doc's sample), credits change, publish panel prefill from `template.publish` + both-placement frame previews + "what will be sent" (with Track B's components). E2E happy path behind flags on a Preview deploy.
**Track F — Template QA sprint (operator + agent assist).** Using the Studio: bring ~24 templates (intent-diverse; pick by residual ranking from Track C's report; `migrate-v1 --from source` for all of these) to `ready` — including the restyle pass and stress-preview sign-off per template (~15–25 min each with D5). Agent assists (font shortlist re-runs, batch re-checks, restyle drafts); human approves each. Output: 24 `ready` templates, gate green, gallery diversity check green.

### Phase 3 — cutover, cleanup, E2E (~2–3 days, serial-ish)

**Track G — Cutover.** Flip `ADSTUDIO_TEMPLATES_V2=true` on Preview → full manual pass (create → edit → publish dry-run) → production flag on. `META_ASSET_FEED_ENABLED` on only after probe evidence. One-week bake with v1 code dormant but present.
**Track H — Cleanup (the deletion PR; §13 inventory is the checklist).** Also rewrites/deletes tests per §14, removes the v1 gate + gallery + samples, prunes deps, updates docs. Gate: `npm run check` + `verify:hard-reset` (now v2-only) + full Playwright suite green on Preview; `docs-truth-sweep.test.ts` updated.
**Track I — E2E hardening.** §14 new specs green against Preview; `PERFORMANCE_PLAN.md` quick wins that this rebuild makes free (delete the 3 s pack-refetch QA poll — no longer needed; job polling only for copy AI) — do them here, not before.

Merge order: F0 → (A,B,C,D any order) → E (needs A,B,D) → F (needs C) → G → H → I. Total: **~2 weeks calendar with 4 agents in parallel**, plus operator QA time in Phase 2/ongoing (~24 × 10–20 min for launch set, remaining 47 templates over the following days).
---

## 13. Cleanup inventory (Track H checklist — delete means delete)

**Delete immediately in Phase 0 (verified zero importers today):**
`src/components/adstudio/brand-studio-styles.ts`, `brand-color-swatch.tsx`, `brand-voice-card.tsx`, `brand-details-cards.tsx`, `brand-preview.tsx`, `confirm-delete-dialog.tsx`; `src/lib/adstudio/creative/` (whole dir); `src/lib/adstudio/style-profile.ts` (+ its test); the dead `AdPreview` function in `src/components/adstudio/preview.tsx`; dead CSS classes `.studio-template-avatar`/`.studio-template-dots` in `new-ad-dialog.tsx`; dead `"media"` member of `StudioSection` in `use-ad-studio.ts`.

**Delete at Track H (v1 pipeline, after bake):**

| Path | Fate |
|---|---|
| `src/lib/adstudio/reference-clone.ts` | **Deleted entirely** (D5 removed the safe-sample clone — no full-ad generation survives anywhere). |
| `src/lib/adstudio/clone-generation.ts` | Delete cascade/masks/composites. Keep upload helper → rename `src/lib/adstudio/v2/media.ts`. |
| `src/lib/adstudio/generate-template-campaign.ts` (757 L) | Deleted; replaced by `v2/generate.ts`. |
| `src/lib/adstudio/layer-derivation.ts`, `text-layers.ts`, `text-layer-state.ts`, `clone-regions.ts`, `region-edit.ts`, `magic-layers-config.mjs` (+`.d.mts`) | Deleted (plate now build-time; typesetting lives in `v2/render/`). Thresholds move to `scripts/adstudio/v2/lib/config.mjs`. |
| `src/lib/adstudio/rasterize-reference.ts` | Delete (samples pre-rastered; SVG-logo rasterizing lives in `resolve-image-for-model.ts`, which stays for slot image resolution). |
| `src/lib/adstudio/template-preview.ts`, `creative-preview.ts` | Delete; `isCloneCreative` replaced by `isV2Creative` in `v2/instance.ts`. |
| `src/lib/adstudio/outpaint-layout.ts`, `smart-crop.ts` | **Kept** — relocated under `v2/` (story draft math; focal defaults). |
| `src/components/adstudio/canvas/` (in-place editor, text-patch, edit client) | Deleted; replaced by `editor/`. |
| `src/components/adstudio/preview.tsx` | Deleted; replaced by `meta-frame/` (port `formatMetaPrimaryText` behaviour into `truncate.ts` first). |
| `src/app/api/adstudio/creatives/[id]/edit/` + `/layers/` | Deleted; replaced by `/doc`. |
| `src/lib/adstudio/templates.ts` v1 contract + `template-gallery/` (71 JSON + evidence) + `public/adstudio-samples/`, `public/adstudio-thumbnails/` | Deleted once all 71 are migrated (samples/thumbnails regenerated under `public/adstudio-templates/`). `scripts/verify/adstudio-templates.mjs` (v1) deleted with them; `scripts/adstudio/create-template.mjs` folded into `ingest.mjs`. |
| `src/lib/providers/publishing-adapters.ts` | Delete the dead validate-only preview path (superseded by the probe + generatepreviews route). |
| Deps | Remove `opentype.js` (imported nowhere). Keep `google-font-metadata` (corpus), `sharp` (uploads/downscale). |
| Root/docs | Move `HANDOVER-VPS.md`, `HANDOVER-mobile-dashboards.md`, `LANDING-CRAFT-REVIEW.md`, `UI-UX-REVIEW-AND-PLAN.md`, `.claude-task-prompt.md` → `docs/archive/` (fix the 2 inbound links). `stitch/` → delete (second DESIGN.md = drift hazard; also deleted by the Atlantic branch). `mockups/qwen-adstudio-full-process-20260722/` → delete (20 MB run dump); keep `mockups/adstudio-mockup.html`. `meta_ad_candidates/` stays (it is the legal provenance archive the gate hashes against). |

**Tests** (delete/replace mapping in §14). Anything not listed here is out of scope for deletion — when in doubt, keep and flag.

## 14. Test plan

**Unit/integration (node:test, `tests/adstudio-v2/`):** template-doc schema (each §3 rule); render-doc (fit, refusal, cover-crop math incl. focal/zoom edges, effects, story safe-zone render); instance validation (guided override whitelist; locked layers; over-limit copy → 400); publish payload snapshots (4 cases, §12-D); truncate constants behaviour; ingest geometry (mask build, outpaint placement, migrate-v1 idempotence — run twice, identical output); exactness metric (fixture with known residual); editor state reducer (undo/redo coalescing, guided guards).
**Ports of the behaviour bar:** re-express the intent of `adstudio-inplace-editor.test.ts` (a11y/44px/keyboard/undo), `adstudio-meta-chrome.test.ts` (frame wraps editor, placement ratio enforced, no internal scrollbar at desktop), `adstudio-new-ad-dialog-validation.test.ts` (gallery unchanged), against the new components — then delete the old files with their subjects.
**Delete with their subjects:** `adstudio-text-layers.test.ts`, `adstudio-text-patch.test.ts`, `adstudio-clone-regions.test.ts`, `adstudio-reference-clone.test.ts` (assertions about sample-builder move to `tests/adstudio-v2/ingest-sample.test.mjs`), `adstudio-outpaint-layout.test.ts`/`adstudio-smart-crop.test.ts` (move under v2 names), `adstudio-template-020.test.ts`, `adstudio-template-edit-readiness*`, `adstudio-style-profile.test.ts`, generation tests → rewritten for `v2/generate.ts`. `adstudio-contract-guards.test.ts` + `tests/hard-reset/*` rewritten to assert the NEW single-path law: one template contract (v2), one renderer, no image model reachable from any customer route (grep-gate: `ai-providers` imports forbidden outside `copy-generation`, `brand-extraction`, `scripts/`).
**Parity:** `test:render-parity` (§4) in CI.
**Playwright (`e2e/`):** replace `adstudio-real-loop.spec.ts` with `adstudio-v2-loop.spec.ts` — template pick → inputs → generation completes **< 10 s** (assert no image-model request fired: intercept and fail on `api.openai.com|generativelanguage`) → editor: text edit + image swap + undo → save → publish panel: both frames render, readiness green, dry-run plan builds → export. Keep viewport matrix incl. 320 px. New `template-studio.spec.ts` (operator: open draft, change font, run check, approve). New `meta-frames.spec.ts` (visual snapshots of 7 placements at fixed DPR; update-on-purpose policy). Fix the stale 2-column gallery assertion while touching the file. `platform.spec.ts` smoke updated.
**Probe (manual, gated):** `meta-publish-probe.mjs` evidence attached to Track D and Track G PRs.

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Combined lead-ad + asset_feed_spec payload rejected by Meta (UNVERIFIED in docs) | Flag + probe + documented fallbacks (§9.2). Feed-image-everywhere remains as the floor — never blocks cutover. |
| napi-rs/canvas text metrics differ from browser | Parity gate (§4) with SSIM floor; same woff2 files registered both sides; canonical pixels always come from ONE side (server), so customers never see a mismatch — the gate only bounds preview drift. |
| A template's fonts can't match (hand-lettering) | Baked-text escape hatch; residual gate refuses "approximately right"; Studio makes it a 1-click decision. |
| D5 originality posture: public templates share the source ad's background artwork (restyled) | Owner-accepted 2026-08-05 with mandatory restyle distance (palette + assets + copy) and identity scrub; recommend counsel review of the restyle-distance policy before launch. Not legal advice. |
| Templates look fine with sample copy but ugly with real customer input | Mandatory Studio stress matrix before `ready` (longest legal copy, min-res/worst-aspect photos); slot `minSourcePx` warnings + hard floor at runtime; refusal-to-render beats silent degradation. |
| Overlay patches with soft shadows over slots look cut-out | Studio diff view exposes it; operator widens patch or bakes the slot edge; worst case template ships without that slot editable. |
| Repo size growth from plates | Lossless WebP; budget check in gate; Supabase-storage fallback documented (§3). |
| v26 bump breaks an existing read call | Version bump PR runs the probe + the existing reporting smoke against dev account; env override allows instant pin-back. |
| Old law (AGENTS.md/SKILL/gates) blocks agents mid-build | Phase 0 rewrites law first; v1 gate keeps running until Track H so nothing regresses during transition. |
| Truncation/safe-zone numbers drift (Meta doesn't publish exact values) | Constants live in one file with source comments + the generatepreviews side-by-side makes drift visible in one click. |

## 16. Register rewrites (Phase 0 pastes these)

**`AGENTS.md` — replace the whole "AdStudio templates (the ad product)" section with:**

> ## AdStudio templates (the ad product)
> A template is a **layered document decomposed directly from one real source ad**: a background plate of the designer's original pixels, image slots, overlay patches, and measured text layers, plus the complete Meta publish block (`src/lib/adstudio/v2/template-doc.ts` is the contract). Follow `hermes/skills/adstudio-template-builder-v2/SKILL.md` before creating or changing any template.
> The public gallery sample is a **deterministic render of the restyled template** (mandatory Studio restyle: safe palette, generic assets, safe copy; recorded in `restyle`; sample hash must differ from the source hash; no source advertiser identity may survive). No image model may paint a whole ad anywhere, at build time or runtime — models are permitted only on masked regions during build-time ingestion (text-region inpaint; optional story margin extend). Customer ads are a **deterministic render** with declared customer inputs; pixels the customer does not replace are the source designer's pixels; replaced text must pass the fidelity gate or be baked.
> `ready` additionally requires the stress-preview matrix and a human sign-off at 100% zoom — the AI critic advises, a person approves.
> There is one template contract, one renderer (`src/lib/adstudio/v2/render/`), and one editor. Diversity is enforced by ad-radar classification AND the layout-skeleton gate. `node scripts/verify/adstudio-templates-v2.mjs` and `npm run verify:hard-reset` must pass; never weaken or special-case either gate.

**`PRODUCT.md` — replace Design Principles 3–4 with:**

> 3. Preserve diversity and craft from real ads. Vision extracts each source ad's customer inputs; the template's layers are decomposed directly from that ad — never from a shared layout recipe — so every pixel the customer doesn't replace is the original hand-made design.
> 4. Decompose once, render deterministically. Creation and editing are instant, exact renders of the layered template with the customer's assets and copy. No generative model touches a customer's ad pixels.

**New `hermes/skills/adstudio-template-builder-v2/SKILL.md`:** written by F0 from §5 + §10 of this plan (process: source → analyse → sample → decompose → story-draft → check → Studio QA → ready; definition of done = gate list §10.1; files list = §5 paths). The v1 skill file is deleted in the same commit.

## 17. What I did NOT include (deliberately)

- Carousel/video ads, non-Meta platforms (Google packs exist in the copy layer and are untouched).
- Customer-facing template creation ("bring your own sample"). The ingestion pipeline is built to support it later (it's the same `ingest.mjs` + Studio), but v1 keeps template authoring operator-side — quality/legal review stays human. Revisit after cutover.
- Editor "add new layers / free canvas" — architecture supports it (Advanced is a whitelist away), product decision deferred.
- Pricing/credits changes beyond "renders cost 0" (product decision).

---

## Appendix A — Meta requirements register (verified 2026-08-04, sources = developers.facebook.com unless noted)

**Version:** pin `v26.0` (released 2026-07-29). v23.0 — the current code default — expired 2026-06-09. v24.0 dies 2026-10-06.
**Creative (single-image lead ad):** `object_story_spec.page_id` + optional `instagram_user_id` (NOT `instagram_actor_id` — deprecated v22) + `link_data { message, link:"@url:https://fb.me/", name, description, image_hash, call_to_action { type, value { lead_gen_form_id } } }`. `photo_data` cannot carry lead forms. `description` and `caption` never render on Instagram.
**Placement customization:** `asset_feed_spec` — limits: images ≤10, bodies/titles/descriptions/CTAs/links ≤5, 30 assets total; `ad_formats:["SINGLE_IMAGE"]`; `optimization_type:"PLACEMENT"`; ≥2 `asset_customization_rules`, each `customization_spec` with `publisher_platforms` + per-platform positions (`facebook_positions`: feed, right_hand_column, marketplace, video_feeds, search, story, notification; `instagram_positions`: stream, story, explore, explore_home, profile_feed, ig_search); adset `is_dynamic_creative:false`; adset placements ⊇ rule positions. **UNVERIFIED: combined with lead_gen_form_id — probe required.**
**Advantage+ enhancements:** `degrees_of_freedom_spec.creative_features_spec.<feature>.enroll_status` per feature; `STANDARD_ENHANCEMENTS` bundle dead since v22. Feature keys: adapt_to_placement (default OPT_IN — explicitly OPT_OUT), image_touchups, image_templates, inline_comment, enhance_cta, text_optimizations, image_animation, image_background_gen, video_auto_crop, translate_voiceover, text_translation, media_type_automation, product_extensions. Preview a feature via `/{ad}/previews?creative_feature=`.
**CTA enum (lead ads documented subset):** APPLY_NOW, DOWNLOAD, GET_QUOTE, LEARN_MORE, SIGN_UP, SUBSCRIBE. (Full enum ~119 values on AdCreativeLinkDataCallToAction; not all valid for lead ads. CONTACT_US undocumented for lead ads.)
**Image specs:** FB/IG feed 1:1 1080×1080 or 4:5 1080×1350 (min 600w; ratio range 1.91:1–4:5); Stories/Reels 9:16 1080×1920; ≤30 MB JPG/PNG. Safe zones 9:16: top ~250 px, bottom ~340 px (Stories) / ~672 px + 6% sides (Reels) — secondary-sourced, treat as design guidance.
**Truncation (best-known, not contractual):** FB mobile feed primary ~125 chars/3 lines → "See more"; headline ~27 chars; description FB-only, space-permitting; IG caption ~125 → "more"; Story overlay ~40.
**Preview API:** `GET /act_{id}/generatepreviews?creative={spec}&ad_format=...` (pre-creation OK); returns 24 h iframe; formats incl. MOBILE_FEED_STANDARD, DESKTOP_FEED_STANDARD, INSTAGRAM_STANDARD, INSTAGRAM_STORY, INSTAGRAM_REELS, FACEBOOK_STORY_MOBILE, RIGHT_COLUMN_STANDARD. Standard BUC rate limits.
**adimages:** POST `/act_{id}/adimages` `{bytes: base64}`; response `images.<name>.hash`; hash is account-scoped and reusable across creatives; `copy_from` for cross-account.
**Lead forms:** POST `/{page_id}/leadgen_forms` with Page token; `questions[]` typed (FIRST_NAME, LAST_NAME, EMAIL, PHONE, CUSTOM, ZIP, CITY, ...), `privacy_policy{url, link_text≤70}`, `thank_you_page`, `follow_up_action_url`, `is_optimized_for_quality`, `locale`, `block_display_for_non_targeted_viewer`. Page must have accepted Lead Ads ToS (UI action). Prohibited question categories (all lead ads): account numbers, criminal history, financial, government IDs, health, insurance, political affiliation, race/ethnicity, religion, sexual orientation, union membership, credentials.
**Campaign/adset (lead gen):** campaign `{objective:"OUTCOME_LEADS", special_ad_categories:["HOUSING"], special_ad_category_country:["AU"], status:"PAUSED"}`; adset `{optimization_goal:"LEAD_GENERATION", billing_event:"IMPRESSIONS", destination_type:"ON_AD", promoted_object:{page_id}, is_dynamic_creative:false}`. HOUSING: age locked 18–65+, all genders, no location exclusion, radius ≥ 25 km (code already enforces `META_HOUSING_MIN_RADIUS_KM = 25`), no zip targeting, no lookalikes. HOUSING does **not** restrict creative fields, previews, or lead-form question types beyond the global policy.

## Appendix B — current-state facts the plan builds on (verified in-repo 2026-08-04)

71 v1 templates (48 feed / 23 story) in `src/lib/adstudio/template-gallery/`; typography measured for 410/410 text inputs, 91 live-grade, 1 template fully `ready` (`meta-feed-018`). Clone models: `gemini-3.1-flash-image` primary / `gpt-image-2` fallback (`src/lib/ai/model-registry.ts`); plate inpainting uses gpt-image-2. Fonts: 108 committed woff2 + manifest under `public/fonts/adstudio/`. Publish: `src/lib/providers/meta-execution.ts` (v23.0 default, `object_story_spec.link_data` single image, HOUSING hardcoded, everything PAUSED, VPS `job_queue` worker, CAS idempotency) — reused. Editor today: `src/components/adstudio/canvas/in-place-ad-editor.tsx` region editor inside `MetaChromePreview` (`src/components/adstudio/preview.tsx`). Revisions: `adstudio_creative_revisions` + claim/append RPCs — reused. E2E auth: storage-state (`e2e/.auth/`), CI-fails-on-skip pattern — reused.
