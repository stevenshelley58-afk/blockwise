# Magic Layers — full editor plan

Date: 2026-07-27 · Scope: the AdStudio text/image editing path (`text-layers.ts`, `region-edit.ts`, `creatives/[id]/{edit,layers}`, the editor UI) · Status: proposed, not started

**Relationship to Stage 2.** `docs/CLAUDE-CODE-PROMPT-STAGE2.md` puts layers derivation explicitly out of scope ("consume, don't change") and tells Stage 2 Phase 3 to *connect to* Magic Layers as it stands. That is the right call for Stage 2 — but Magic Layers as it stands renders every typeface as Arial, Georgia or Rockwell. If Phase 3 ships against today's derivation, the approved mockup's Edit surface will show correct layout with wrong type. **This plan is Stage 2a and must land before Stage 2 Phase 3.** It changes only `src/lib/adstudio/*` + the two API routes + `text-patch.ts`; it touches no studio UI structure, so the two workstreams do not collide.

---

## 0. Blocker — the edit route does not currently build

`src/app/api/adstudio/creatives/[id]/edit/route.ts:12` imports `applyDeterministicTextEditQa` from `@/lib/adstudio/clone-qa`, and calls it at lines 332 and 405. **`src/lib/adstudio/clone-qa.ts` does not exist** — not on disk, not tracked in git, and no file anywhere in `src/` defines that symbol. `npm run typecheck` cannot pass and the route cannot build.

This is uncommitted working-tree state, not a regression on `main` — but the scope is narrow and worth stating precisely, because it tells you what is at risk. Of 176 files under `src/lib/adstudio/`, **175 are tracked**; the only untracked file there is `text-layers.ts`, plus `text-patch.ts` under `src/components/adstudio/canvas/`. `edit/route.ts` and `region-edit.ts` are both tracked and merely modified. So the two newest, most load-bearing files in this whole system exist only in the working tree, and the tracked route that consumes them imports a module nobody has written.

Nothing below is buildable until this is resolved: restore the module or inline the QA update, then commit `text-layers.ts` and `text-patch.ts`. **Phase 0, before anything else.**

---

## 1. What exists today (verified in code)

The foundation is genuinely good. Four things are already right and this plan keeps all of them.

**Nothing outside the region can ever change.** `region-edit.ts` crops a padded window (`padFraction` 0.15), edits only that, and composites back the `COMPOSITE_PADDING` 0.02 rect onto the original bytes. `derivePlateFromInpaint` applies the same discipline to the plate — it starts from the *original* and pastes in only the text rectangles from the model's inpaint, so inpaint drift cannot leak into the photography.

**The plate already exists.** `buildPlateInpaintRequest` — one full-render inpaint that removes all text and reconstructs the background behind it. Built lazily, once, per render.

**The fast path already exists.** `text-patch.ts` renders the copy on a browser canvas over the plate crop, and that same canvas output is *both* the optimistic overlay and the final pixels. `compositeTextPatch` clamps it server-side. `validFor[]` tracks staleness; `edit/route.ts` returns `409 layers_stale` and the client silently retries once through the model path.

**Export parity already holds, for free.** I flagged server-side fontconfig as a blocker last turn. It isn't. `export-render-storage.ts` downloads the *already-composited flat PNG* from Supabase and only resizes/encodes it — no text is ever drawn at export time, because the patch pixels were baked into the stored render at edit time. WYSIWYG is structural. No server font toolchain is needed anywhere.

### Where the quality actually leaks

| # | Defect | Location |
|---|---|---|
| 1 | **Typography is guessed into 7 buckets.** A vision model picks one of `sans/serif/slab/condensed/rounded/script/mono`; the browser maps that to `Arial` / `Georgia` / `Rockwell` / `Arial Narrow` / `Arial Rounded MT` / `Segoe Script` / `Courier New`. This is not matching, it is categorising. It is the whole fidelity gap. | `text-layers.ts:188`, `text-patch.ts:30-38` |
| 2 | **Shrink-to-fit runs to 10px.** The fit loop walks 220px → 10px in 1px steps and takes the first size that fits. Long copy silently produces microscopic type instead of refusing. | `text-patch.ts:129-140` |
| 3 | **Derivation is lazy and on the critical path.** The plate build starts when the editor *opens* (`in-place-ad-editor.tsx:181-197` → `POST /layers`, inline, `maxDuration=300`). One image-model call ≈ 10–25s. Every edit inside that window falls through to the model path — slower, costs a call, and repaints the glyphs. The user's first edit is the one most likely to be slow. | `layers/route.ts` |
| 4 | **No spec lock.** Nothing prevents case, line count or size drifting from the sample. | `text-patch.ts` |
| 5 | **`letterSpacing` is `"normal" \| "wide"`**, colour is a flat hex, and there is no line-height, no size, no measured baseline. The style type cannot express the sample. | `types.ts:244-253` |

Everything below fixes these five and nothing else.

---

## 2. The speed architecture — four tiers, work pushed as early as it can go

The governing rule: **the only work allowed to happen while the user waits is work that depends on something the user just did.** Everything else moves earlier.

### Tier 0 — Template build time (offline, zero runtime cost, run once ever)

This is the largest win, and it is available because of how the gallery already stores templates: there are **71 templates in `template-gallery/`**, and every one carries both a fixed public sample (`sample.imageSrc`) and its exact baked copy, per region key, in `inputs.text[].sample`. Matching type to pixels when you already know the string is not OCR — it is a search with a known answer.

`inputs.text[].sample` is the source of truth here and it covers all 71. The evidence files (`evidence/*.json`, `qa.copyChecks[].expected`) corroborate the same strings but exist for only 50 of the 71 — so the build script must read the template JSON, **not** the evidence, or it silently skips 21 templates. Where evidence exists, cross-check the two and fail loudly on disagreement; that mismatch would mean the sample PNG and the declared contract have drifted apart, which is worth knowing regardless.

`inputs.text[].maxLength` is a second gift in the same file: every text field already declares its character budget, measured against this exact layout. That is a far better overflow rule than anything derived at runtime — see §5.

A new build script (`scripts/build/adstudio-type-specs.mjs`) runs per template, offline, on a dev machine or CI:

1. Load the sample PNG and the template's declared copy contract.
2. For each text region: isolate the glyph mask, measure cap-height, x-height, baseline, stroke weight, stroke contrast, aspect ratio, serif presence, counter shape.
3. **Stage A — metric shortlist.** Score those measurements against precomputed metrics for the whole candidate corpus. Keep the top ~40 faces. Cheap, no rasterization.
4. **Stage B — pixel match.** Render the known string in each shortlisted face across a small size/tracking/weight grid; take the lowest normalised pixel residual against the sample crop.
5. Emit a `typeSpec` per region — family, weight, italic, size (as a fraction of box height), line-height, tracking, case transform, alignment, colour, plus `fitScore` (the residual) — into the template's gallery JSON alongside the existing evidence.

Cost at runtime: **zero.** These are version-controlled, reviewable, diffable facts about the template, which is exactly the shape the gallery already uses for hashes and QA verdicts.

What this buys per customer render: the runtime never searches 3,700 faces. It starts from a 1–3 face prior with expected weights and alignment, and only *confirms* against the actual clone. That is a ~100× reduction and it is why the whole thing can be fast.

### Tier 1 — Generation time (parallel, hidden behind a wait the user is already doing)

Today: `render → regions → [user opens editor] → plate`. The plate is behind a user action.

Proposed: `render → regions → plate`, all before the ad is presented as editable.

`generate-template-campaign.ts` already has most of the shape. Be precise about what it does, though: `feedRegionsPromise` (line 429) is created *after* `await feedGenPromise` (line 428) — region detection overlaps the **upload and persist**, not the render itself. The code comment says exactly that. So the existing concurrency is smaller than it first looks, and Phase 3 is adding real new overlap rather than copying an existing one.

```
t=0    ├─ feed clone render (image model)        ~20-40s
       └─ story clone render (parallel, exists)
t=~35  │  feed render resolves
       ├─ region detection (vision)              ~4s   ← exists, overlaps upload+persist
       ├─ upload + persist                       ~3s
       └─ type confirm (vision)                  ~3s   ← NEW, can start here or earlier
t=~39  │  regions land
       └─ plate inpaint (image model)            ~15s  ← NEW, needs boxes for the mask
t=~54  layers ready
```

Two structural facts set the floor. The mask genuinely requires region boxes — `layers/route.ts:105-107` maps `textRegions` to `textBoxes` and feeds them to `createRegionEditMaskForDimensions` — so plate-after-regions is irreducible. Region detection itself requires the finished render. That is a three-stage chain and no amount of restructuring collapses it.

What *can* move: type confirmation needs only region keys, and those come from the template's copy contract, known at t=0. Start it with the render.

Whether ~54s of derivation stays hidden depends on how long the user lingers on a freshly generated ad before typing. Reveal animation, reading the copy, checking the Story format — plausibly enough, often not. **Treat these numbers as unmeasured.** The honest position is that this makes the slow path much rarer, not that it eliminates it, and Phase 3's acceptance should be a measured hit-rate on Preview ("what fraction of first text edits found layers ready") rather than the assumption that it is always covered. The stale path must stay excellent because it will still fire.

Both formats derive in parallel; `persistStoryInBackground` already has the hook.

**Cost honesty.** This pays one extra image-model call per creative whether or not anyone edits it. Recommended split: **eager for the primary (feed) creative** — Stage 2's Edit opens the most recent ad by default, so that plate is nearly always used — and **lazy-but-prefetched for story**, kicked off when the format toggle is first hovered or focused. If cost still bites, gate eager derivation on the workspace having edited any previous ad.

### Tier 2 — Editor open (prefetch, before the first click)

By the time Edit mounts, layers are already `ready`. Remaining work is pure browser warm-up, all of it before the user clicks a region:

- Fetch and `decode()` the plate into `plateImagesRef` immediately on mount, not on first region click.
- Preload the matched `woff2` faces via `FontFace` + `await document.fonts.load(...)`. **This is load-bearing:** a canvas `fillText` with an unloaded face silently falls back to a system font and produces a wrong-but-plausible patch. Nothing may render until `document.fonts.ready` resolves for the faces in use.
- Precompute each region's padded rect and inner writable box.

### Tier 3 — Keystroke (the thing that has to feel instant)

Canvas text rendering is ~1–3ms. There is no reason to debounce it.

- Render on `requestAnimationFrame`, coalescing to one draw per frame. No debounce, no throttle.
- Draw at **display resolution** into the live preview while typing; produce the full-resolution PNG data URL only on commit. `toDataURL` at 1080×1350 is the only expensive step (~20–40ms) and it does not belong in the keystroke path.
- Replace the 220→10px 1-per-pixel shrink loop (up to 210 `measureText` passes) with a binary search over the clamped range — 4–5 passes.
- Commit posts the patch and the optimistic pixels stay on screen. The response is already identical to what is displayed, so there is nothing to swap in.

### Making it *feel* fast

Perceived speed here is mostly about never showing a spinner for something that is already done.

- **The optimistic patch is the final pixels.** Already true; the plan must not break it. No flash, no re-swap on response.
- **No spinner on a live edit.** Commit shows a quiet saved-state tick, springing in per `src/lib/motion.ts` `snappy`. The network round trip is invisible.
- **Live copy binding.** Stage 2 requires headline/primary/CTA bound live to the pixel-true Meta preview — same rAF path, so on-image text and preview text move together on the same frame.
- **Honest state, per Stage 2 line 47 and PRODUCT.md.** A quiet `Magic Layers · live` indicator when layers are valid. When they are stale and the model path runs, an explicit re-rendering state with real progress. **Never** imply an instant edit that is actually a full re-render.
- **No layer/plate/model vocabulary in the UI.** Stage 2 acceptance is explicit: users see "instant text editing".

---

## 3. Fonts — go as wide as possible, because width is free at runtime

Wide is the right instinct and it costs nothing where it matters, because **matching happens once offline and only the winner ships.**

**Corpus.** The full Google Fonts open library — ~1,900 families / ~3,700 static faces, all OFL or Apache, legally embeddable and self-hostable. Plus Inter and Manrope, already in the design system.

**Where it lives.** Corpus metrics and rasterization exist only in the build script and its dev dependencies. Runtime dependencies do not change — `sharp` stays the only image library in the serverless bundle. Matching needs `opentype.js` (pure JS, metrics + glyph outlines) plus a rasterizer; both are `devDependencies` used by a Node build script, never imported by a route.

**What ships.** Only faces that actually won a match, self-hosted as subset `woff2` under `public/fonts/adstudio/`. Across 50 templates the union will realistically be 15–30 faces at a few KB each after subsetting. A user loads only the 1–3 faces their template needs.

So the corpus size never touches bundle size, cold start, or request latency. There is no reason to be conservative.

**Two real limits, stated plainly:**

1. **Licensing caps the ceiling.** Real-estate ads lean on Proxima Nova, Gotham, Circular, Brandon, Futura. Those cannot be embedded. The open library gets close — Montserrat sits near Gotham — but never exact. "Match the sample" honestly means *nearest legally-embeddable face*, and `fitScore` decides whether that is close enough.
2. **A confident wrong match is worse than a decline.** The gate below exists for this.

---

## 4. Confidence gating — when the fast path is allowed

Per region, derived once, stored on the layer:

**`live`** — all of: `fitScore` under threshold; plate recoverable for that region (flat, gradient, or clean inpaint); text axis-aligned, not warped, not on a curve, not knocked out of its background; matched face loaded successfully in the browser.

**`rerender`** — anything else. The field still edits. Applying it is an explicit action stating it re-renders that part of the artwork, with before/after and one-click undo (`renderHistory` / `redoHistory` already support this). Never a silent fallback.

Judgement call worth stating: **a poor font match must gate to `rerender`, not ship approximate typography.** Re-typesetting a headline in nearly-the-right face is its own kind of slop, and it is the failure mode that erodes trust fastest because it looks fine until you compare.

---

## 5. Design guardrails — the layer is the designer's constraint, enforced

This is what keeps it from becoming Canva. It is a copy editor with a Canva-grade response time.

1. **The box is a hard boundary, and the template already says how big it is.** Every text input declares `maxLength` in its template JSON, measured against this exact layout — `headline_main` is 30 characters, `headline_sub` is 35. Enforce that as the primary budget with a live character counter, so the limit is visible *before* the user overruns it rather than as a rejection afterwards. Auto-fit then handles the remainder, shrinking to a floor of ~88% of the sample's measured size and no further; past that, *"about 6 characters too long for this space."* We refuse to overflow. Deletes the 10px-type failure mode outright.
2. **The spec is locked, not offered.** No font picker, no colour picker, no size slider, no alignment control. Users edit words; typography stays as designed. Exposing those controls is how design tools produce slop, and PRODUCT.md's anti-references ban it independently.
3. **Case and line count preserved.** All-caps stays all-caps; a two-line block stays two lines.
4. **No new layers, no free canvas, no repositioning.** The ad has what the template has.
5. **AI rewrite chips write into the same constrained field.** Punchier / Shorter / More local / Urgency propose *words*, never pixels — and a suggestion that does not fit is regenerated shorter, never shrunk to fit. This is the clean separation: AI touches copy, the image model touches artwork, and they never trade places.

---

## 6. Versioning

- **v1 is the clone and is immutable.**
- **Live text edits are a patch over it** — reversible, lossless, no version bump.
- **Only a model edit mints v2.** The mockup's `v1 → v2 · edited` chip then means something real: the artwork changed.

Already consistent with `edit/route.ts`'s revision CAS and `boxIntersectsTextRegions` invalidation logic.

---

## 7. Type changes

`AdStudioTextLayerStyle` cannot currently express a real typeface. Replace the 7-bucket `family` with a concrete spec:

```ts
type AdStudioTypeSpec = {
  fontId: string;            // "montserrat-800" — resolves to a self-hosted woff2
  fallbackFamily: FamilyBucket; // today's 7 buckets, kept as last-resort only
  weight: number;
  italic: boolean;
  case: "none" | "upper" | "lower";
  sizeRatio: number;         // measured size as a fraction of box height
  lineHeight: number;        // measured, not the hardcoded 1.16
  tracking: number;          // em, measured — replaces "normal" | "wide"
  align: "left" | "center" | "right";
  color: string;
  fitScore: number;
  mode: "live" | "rerender";
};
```

`fallbackFamily` keeps today's generic stack as a genuine last resort, so a font that fails to load degrades to current behaviour rather than to nothing — but it also forces `mode: "rerender"`, because a fallback render is not a faithful one.

---

## 8. Phases

| Phase | Work | Gate |
|---|---|---|
| **0** | Resolve the missing `clone-qa` module; commit `text-layers.ts` + `text-patch.ts`; `npm run typecheck` green | `npm run check` |
| **1** | Type-spec schema + build script; wide-corpus matcher (metric shortlist → pixel match); emit specs into **all 71** gallery JSONs from `inputs.text[].sample`; subset and commit the matched woff2 set | new fidelity gate, below |
| **2** | Runtime derivation: seed from the template prior, confirm against the clone, per-region `live`/`rerender` gating | unit tests on gating |
| **3** | Move derivation to generation time — `platePromise` in `generate-template-campaign.ts`, eager feed / prefetched story; keep the lazy `/layers` route as the repair path for stale layers | Preview: **measured** hit-rate on first text edit, not assumed |
| **4** | `text-patch.ts` rewrite: real fonts, `document.fonts.ready` guard, binary-search fit, 88% floor with overflow refusal, case/line-count lock, rAF display-res render, commit-time full-res encode | Preview, desktop + 390px |
| **5** | UI state surfacing — `Magic Layers · live`, honest re-render state, overflow message, no design-tool vocabulary. **`$impeccable` mandatory: `critique → craft → adapt → harden → polish`** | `$impeccable` report per AGENTS.md |

Phases 1–2 are pure library work with no UI surface, so they can run in parallel with Stage 2 Phase 1–2 (studio shell, Create). Phase 3–5 must precede Stage 2 Phase 3 (Edit).

---

## 9. Verification

Existing gates, never weakened or special-cased:

- `npm run check` (`check:nul` + `test` + `typecheck`)
- `node scripts/verify/adstudio-templates.mjs`
- `npm run verify:hard-reset`
- Runtime verification on **Vercel Preview only**, desktop and mobile — localhost is never acceptance

**One new gate, added to `adstudio-templates.mjs`:** for all 71 templates, re-render each region's `inputs.text[].sample` copy using the stored type spec and assert the pixel residual against the sample PNG stays under threshold. This turns typography fidelity into a regression test rather than a vibe, and it catches the dangerous case — a font subset or spec silently drifting — which no existing gate would notice. It should also assert **coverage**: every template has a spec for every declared text input, so a template added later cannot quietly ship with no typography at all.

**Manual check that matters most:** take one ad, make ten consecutive text edits, and diff the result against v1. Every pixel outside the edited boxes must be byte-identical. That is the claim this whole plan rests on, and it is cheap to verify.

---

## 10. Rule compliance

**AGENTS.md** — no conflict. Step 5 of the AdStudio template process already sanctions this verbatim: *"Text edits may instead composite deterministically from derived editing layers (a text-free inpainted plate plus detected type treatments, built in the background per finished render) — the browser re-typesets the exact copy over the plate crop and the server clamps the patch to the selected region. Layers are advisory and validity-tracked; when stale, text edits fall back to the image-model path."* This plan raises the fidelity of the derivation and moves when it runs; it does not add a creation path, an alternate generator, or a second pipeline. No clarifying edit to AGENTS.md is needed.

**PRODUCT.md** — Design Principle 4 ("clone first, edit second") is strengthened: more edits become deterministic patches anchored on the finished clone, fewer become model round trips. The anti-reference against exposing "design-tool complexity, layers, provider jargon, model controls" is honoured by §5's locked spec and §2's vocabulary rule.

**Stage 2** — this is the Stage 2a prerequisite described at the top. It changes only what Stage 2 declares out of scope, and none of what Stage 2 owns.
