# adstudio-template-builder-v2

## Purpose

Mandatory process for creating, changing, or reviewing an AdStudio template.
AdStudio has one template contract (`src/lib/adstudio/v2/template-doc.ts`), one
renderer (`src/lib/adstudio/v2/render/`), and one editor.

## Product law

1. A template is a **layered document decomposed directly from one real source
   ad** in `meta_ad_candidates/` or one Ad Radar creative: a background plate of
   the designer's original pixels, image slots, overlay patches, and measured
   text layers, plus the complete Meta publish block. Record
   `provenance.sourceAd.file` or `.creativeId`, its SHA-256 `contentHash`, and
   the AI ad-radar `classification`.
2. Vision extracts the customer input contract from the source: each distinct
   image the customer must provide and each visible text value they can replace.
   It does not extract a rendering recipe. Do not declare inputs the source does
   not use.
3. **No image model may paint a whole ad anywhere, at build time or runtime.**
   Models are permitted only on masked regions during build-time ingestion
   (text-region inpaint for the plate; optional story margin extend). Pixels
   outside a mask always come from the source bytes.
4. The public gallery sample is a **deterministic render of the restyled
   template**. The Studio restyle pass is mandatory: safe palette, generic slot
   assets, safe copy — recorded in the doc's `restyle` block. The sample hash
   must differ from the source hash and no source advertiser identity (name,
   phone, URL, address, price, logo) may survive.
5. Customer ads are a **deterministic render** of the template doc with the
   customer's declared inputs. Pixels the customer does not replace are the
   source designer's pixels. Replaced text is re-typeset and must pass the
   fidelity gate (§ Fidelity) or be marked **baked** — its original pixels stay
   in the plate and that text is simply not editable. Never ship a region
   "approximately right".
6. One source ad produces at most one template **unless the job brief requests
   a multi-variant pack** (e.g. "exactly 5 templates"): the pipeline then
   emits exactly N declared variants of that source. Every variant declares
   `provenance.packId` (shared) and `provenance.packVariantIndex` (1..N,
   unique, contiguous). The gates treat declared pack variants as one
   authorised pack — never as accidental duplicates — and still enforce that
   every variant has a DISTINCT layout skeleton. Two independent templates
   from one source remain forbidden.

7. The subject-invariance QA corpus is a durable, versioned dependency of the
   builder: the real-photo fixture is committed at
   `public/adstudio-samples/photos/int-bedroom.png` and pinned in
   `scripts/adstudio/v2/subject-invariance.mjs` (`FIXTURE_CORPUS_VERSION` +
   byte/pixel hashes). Candidate builds must COPY the corpus into the
   candidate root as regular files — never symlink it — so the gate runs at
   full strength on clean checkouts. Repin the corpus only by changing the
   committed artifact and bumping the corpus version; never weaken a check.

## Image-substitution law

The likeness target is the reusable ad, never the replaceable subject inside a
declared image slot.

### Excluded from customer-result likeness

- the property, house, person, product, landscape, pool, sky, or other subject
  inside a declared customer image
- the source image's architecture, scene composition, inherent lighting,
  colours, sharpness, weather, or photographic style
- semantic or pixel similarity between a source image and its customer
  replacement

Do not generate, outpaint, relight, restage, recolour, soften, or otherwise
change a customer image merely to resemble the source image. Technical
normalisation (safe decoding, EXIF orientation, ICC/colour-space conversion,
lossless format conversion) and the template's declared deterministic
crop/pan/zoom/focal behaviour are allowed. A generative customer-image edit
must be an explicit customer-facing product feature; it must not receive the
source ad/photo, is not template QA, and does not improve the likeness score.

### Included in customer-result likeness

- canvas, card, frame, border, corner geometry, background, hierarchy, and
  whitespace
- image-slot position, dimensions, aspect contract, fit/focal behaviour,
  clipping, and masks
- every transferable effect applied to or around the image: fades, feathers,
  alpha fields, gradients, overlays, shadows, colour transforms, blur, glow,
  duotone, reflection, blend behaviour, and overlap with type or other regions
- typography geometry, copy regions, logo footprint and anchor, and complete
  source-identity cleanup

An effect that depends on image pixels must transform the **current customer
image**. Never bake source-photo pixels, source reflections, or source-scene
fragments into a plate or overlay patch. Patches may contain neutral colours,
opacity fields, borders, panels, badges, and other non-replaceable design
pixels. A patch intersecting an image slot must be analytic/neutral or have
recorded proof that it is source-image-independent. A full-canvas source-derived
patch containing photo or reflection pixels is an automatic fail. If the
renderer cannot reproduce an image-dependent effect on an arbitrary replacement
image, the template stays `qa`; source-photo leakage is not an acceptable
substitute.

"Photo composition" or "photo mass" in QA means the slot, mask, fit, and crop
behaviour — never the subject's silhouette, size, architecture, or viewpoint
inside the image. Intrinsic customer-image colour, sharpness, lighting, and
style are excluded; template-applied colour, blur, fade, and reflection effects
are included.

### Two scores, never one blended score

- **Ad-system likeness** measures only the included reusable structure and
  effects. This owns the likeness threshold.
- **Result quality** measures whether the finished ad looks excellent with the
  supplied customer image. It is independent of source-image similarity.

Never improve either score by making the customer image look more like the
source image.

Use one fixed, pre-registered fixture corpus chosen independently of the source
and template. Record fixture hashes and reuse the exact corpus across every
template. Do not create a bespoke or model-generated QA fixture after seeing a
source ad.

## Process

`source → analyse → decompose → restyle → story-draft → check → Studio QA → ready`

All commands are `node scripts/adstudio/v2/ingest.mjs <subcommand>`. They are
**build-time only** and run on a dev machine or the Hermes VPS — never on
Vercel (the OpenCV/tesseract/rembg dependencies do not exist there).

| Step | Command | What it produces |
|---|---|---|
| 1. analyse | `analyse --source <path> --id <id>` | Vision input contract + `sourceValues` (the source's own on-image text per key) into `template-gallery-v2/<id>/evidence.json`. |
| 2. decompose | `decompose --id <id>` | OCR text regions, corpus font match, text-inpaint mask → **plate**, slot boxes + mask kind, operator-marked overlay patches. Removes replaceable source-image pixels from the plate and every patch across the complete slot/effect footprint. Emits `template.json` with `exactness.status: "draft"` + a residual report. |
| 2b. variant-pack | `node scripts/adstudio/v2/variant-pack.mjs --contract <analysis.json> --repo <candidateRoot>` | **Only when the job brief requests a pack of N>1 templates.** Deterministically derives exactly N complete layered variants from the one analysed source. Each variant: `provenance.packId` + `packVariantIndex` (1..N), own source-free plates, native 4:5 feed + 9:16 story, editable inputs, full Meta publish block, evidence, deterministic sample. Copies the committed QA corpus into the candidate root (regular files, never symlinks) and verifies it before writing any variant. |
| 3. restyle | `restyle --id <id>` | Applies the Studio-recorded `restyle` block headlessly (palette remap, generic slot assets, safe copy), renders the **public sample** via `render/server.ts`, back-fills `provenance.sample.contentHash`. Fails if the sample hash equals the source hash or the restyle evidence is trivial. |
| 4. story-draft | `story-draft --id <id>` | 9:16 draft: plate extended to 1920 (sampled-edge blur-extend by default; `--ai-extend` outpaints the margin bands only), layers repositioned into Meta safe zones. |
| 5. check | `check --id <id>` | **The source-replay integrity gate.** Renders the doc with `sourceValues` + the source photos and compares against the source ad to verify decomposition. This is not a customer-result likeness score. Runs the stress matrix and writes `exactness.residuals`. |
| 6. subject-invariance | `node scripts/adstudio/v2/subject-invariance.mjs --id <id>` | Renders the fixed hashed grey, grid/gradient, and unrelated-photo corpus through the canonical renderer; rejects source pixels in static assets, non-deterministic renders, and changes outside declared image/effect dependencies. Produces the immutable visual-review contact sheet and rubric. |
| 7. Studio QA | `/operator/template-studio/<id>` | Human confirms fonts, nudges boxes, marks overlay patches, completes the restyle tab, signs off the stress preview, and approves. |
| — | `migrate-v1 --id <id>\|--all [--from source\|sample]` | Builds a v2 draft from an existing v1 template (reuses `typography`, `deterministicEditing.imageBoxes`, `meta`). |
| — | `emit-fonts` | Extends the runtime font manifest to cover v2 docs (same manifest, same license gating). |

### Studio QA (the last 10%)

The pipeline auto-decomposes; a person signs off. In the Template Studio
`[id]` screen:

- Confirm every text layer's font against the diff view (source at 50% opacity
  or side-by-side) with per-region residual badges. Fix the spec, pick a font
  from the corpus shortlist, or **mark baked**. Hand-lettering and script logos
  are always baked.
- Nudge slot boxes, set mask kind/radius, default focal, and `minSourcePx`.
- Mark overlay patches (original RGBA pixels that sit above slots — panels,
  borders, badges) and accept the auto background-removal. Reject any patch
  containing pixels from a replaceable source image, including reflections.
- Complete the **Restyle tab** (mandatory): palette remap, generic assets per
  slot, safe copy. This records `restyle` and renders the public sample.
- Run the **Subject-invariant image probes** (mandatory): mid-grey field,
  high-contrast grid/gradient, and unrelated real holdout photos from the fixed
  fixture corpus. The flat field exposes slot bounds, masks, overlays, borders,
  and cleanup. The grid exposes crop, warp, fade, reflection, blur, blend, and
  overlap behaviour. Holdout photos prove the effect remains clean without
  judging their subject, lighting, colour, or composition against the source
  image.
- Run the **Stress preview** (mandatory): longest legal copy per field, 1-char
  copy, worst-aspect + minimum-resolution photos, all-slots-portrait,
  all-slots-landscape. A template that renders ugly here gets fixed (tighter
  `maxLength`, bigger box, baked region) or does not ship.
- Approve: the server re-runs `check` + the stress renders, requires restyle
  evidence + a story layout + all residuals within threshold, then a required
  confirmation checkbox — *"Inspected at 100% zoom; a designer would ship
  this"* — stamps `qaBy`/`qaAt` and sets `ready`. The AI critic advises; it
  never approves.

Studio writes go through a local-dev-only file API (`NODE_ENV !== "production"`)
because template docs are repo-versioned. Production Studio is read-only.

## Fidelity thresholds (the anti-slop number)

Template fidelity has two distinct gates that must not be conflated:

1. **Source replay** renders the doc with the source's own values and source
   images. This verifies that the decomposition and renderer can reproduce the
   designer's ad. It is an implementation-integrity gate, not evidence that a
   customer image should resemble the source image.
2. **Substitution fidelity** is mandatory Studio QA evidence: run
   `scripts/adstudio/v2/subject-invariance.mjs` to render the fixed mid-grey,
   grid/gradient, and unrelated customer images. It measures the reusable ad
   system and image effects while explicitly excluding image-subject
   similarity. Attach the generated renders, measurements, and immutable
   candidate hashes to the template evidence; keep the template in `qa` when
   they are missing or stale.

Source replay thresholds:

- **Outside text boxes, declared image/effect regions, and restyled plate
  regions: byte-identical.** The composite may reproduce source-image bytes
  only by drawing the source through its live image slot and declared dynamic
  effects. Plates and patches must remain source-image-free. Any other diff is
  a pipeline bug and a hard fail. Restyle recolours are excluded by the
  recorded `paletteMap` regions.
- **Per text region:** grayscale RMSE over the padded box ≤ **0.14** AND
  stroke-profile distance (the `match-font.mjs` Stage-B metric) within its
  existing live-gate bounds. A region over threshold cannot ship editable.
- Residuals are stored in `exactness.residuals` and **re-verified** by the
  gate. Self-reported passes do not count.

Substitution-fidelity evidence records slot geometry, mask residuals, effect
alignment/strength, and cleanup residuals for every probe. Image-model critic
prompts must state the excluded image-content rule verbatim. Objective geometry
owns geometry decisions; critics advise only on transferable effects and
finish. If a critic rewards or penalises subject, architecture, viewpoint,
intrinsic lighting/colour/sharpness/style, or source/customer pixel similarity,
invalidate that score and rerun. Exploratory variants do not count: freeze the
chosen candidate, then independently rescore that exact immutable render with
the fixed fixtures and rubric. Store source, candidate, and fixture hashes plus
the rubric/prompt version and included/excluded rationale.

## Definition of done

`node scripts/verify/adstudio-templates-v2.mjs` must pass automated checks 1–9
below, plus `npm run typecheck`, `npm run test`, `npm run verify:hard-reset`,
and `npm run test:render-parity`. Manual evidence checks 10–11 also block
`ready`; keep the template in `qa` until they are recorded. Never weaken a gate
or add a template-specific bypass.

1. **Schema** — every `template-gallery-v2/*/template.json` parses
   `templateDocV2Schema`; `id` == dirname; no duplicate ids; no duplicate
   `sourceAd` across v1 + v2 combined.
2. **Assets** — plate/patch/sample files exist; sha256 matches the doc; plate
   dims == layout dims; sample hash ≠ source hash; nothing under
   `public/adstudio-templates/` is orphaned or unreferenced.
3. **Fonts** — every `fonts[]` entry exists in
   `public/fonts/adstudio/manifest.json` with matching sha256 + license.
4. **Contract** — input keys unique; every non-baked text input has a text layer
   in every format; every image input has a slot in every format; the guided
   `editPolicy` is sane.
5. **Story safe zones** — no text or slot content in the top 250 px / bottom
   340 px of a story layout (hard fail); Reels 672 px bottom clearance is a
   warning.
6. **`ready` templates** — `qaBy`/`qaAt` present; residuals recorded and within
   threshold; story layout present; restyle evidence non-trivial and sample
   hash ≠ source hash; every slot has an effective `minSourcePx`.
7. **Publish block** — CTA ∈ the documented lead-ads subset; copy arrays ≤ 5
   entries, each within 125/40/90; lead-form questions non-empty; placements
   cover `formatRouting`; `creativeFeatures` covers the full known feature list
   with no silent omissions.
8. **Diversity** — ≥ 5 distinct non-`other` `primary_intent`; no intent > 50% of
   the gallery; layout-skeleton signature collision ≤ 3 (normalized layer-box
   signature quantized to a 12×12 grid).
9. **Renderer smoke** — every `ready` template renders at both formats via
   `render/server.ts` without throwing, at exact output dims, and the stress
   matrix renders without throwing.
10. **Source-image isolation** — plates and patches contain no replaceable
    source-image pixels or reflections. Image-dependent effects operate on the
    current slot image; any source-derived image leakage is an automatic fail,
    and unsupported effects keep the template in `qa`.
11. **Subject invariance** — mid-grey, grid/gradient, and unrelated-photo
    evidence from the fixed hashed corpus proves that slot geometry and image
    effects survive arbitrary customer images. Reports store ad-system likeness
    and result quality as separate scores, record the rubric/prompt version,
    invalidate critics that score image content, and never score
    source/customer image-content similarity. Source-identity cleanup is a
    separate hard gate and cannot be averaged into likeness.

Source curation is the cheapest quality control: only proven, designer-grade
ads enter `meta_ad_candidates/`, recorded as an explicit curation flag in
evidence. The gallery can never look better than its sources.

## Final result contract (candidate stage)

After `studio-qa` previews are prepared, stop before release for human
approval and return ONE compact JSON object with EXACTLY these semantics
(the Tool framework validates them verbatim — gateway/tool_run_api.py
`_prepare_candidate_output`):

- `template_id` — the pack id.
- `candidate_ref` — a `.json` FILE (e.g. the variant-pack manifest) beneath
  this run's `tool_assets/.../runs/<run_id>` or `tool_checkpoints/<run_id>`
  roots. Never a directory; never a path outside the private run roots.
- `preview_refs` — non-empty array of image files (`png/jpg/webp`) under
  `tool_assets/.../runs/<run_id>/previews/`; copy per-variant portrait +
  story previews there (candidate/public paths are rejected).
- `evidence_refs` — analysis, check, manifest, template docs, subject-
  invariance evidence, contact sheets.
- `qa_summary` with the EXACT literals: `source_verified: true`,
  `deterministic_check: "passed"`, `subject_invariance_gate: true`,
  `release_status: "blocked_pending_human_approval"` (exact string).
- `cost` and `attention`.

The framework hard-fails the run if any value differs. Never mark a gate
passed when it did not pass; if a gate fails, report it and stop.

After the 100% zoom approval, the finalize stage reruns every release gate
and issues ONE immutable, sanitized, signed TemplatePack beneath
`$HERMES_HOME/tool_releases/ad-template-generator` via
`scripts/adstudio/v2/pack-release.mjs`, returning `release_id`,
`template_pack_ref`, `template_pack_path`, `sha256`, `signature`,
`compatibility`, `qa`, `trace_ref`. The artifact's bytes must hash to
`sha256` and its `integrity.signature` must equal the returned `signature`.

## Finalize / hard-reset recipe (after human approval)

Re-open the approved checkpointed workspace and rerun EVERY release-blocking
check from the committed state, WITHOUT writing into the read-only authority
checkouts (/opt/ad-template-builder, any Git checkout — read-only by
contract):

1. `node scripts/verify/adstudio-templates-v2.mjs` (fast mode) against the
   candidate dirs — schema/contract/publish/diversity + tofu gate.
2. Subject-invariance gate per variant (fresh outDir) — source-free proof.
3. `npm run typecheck` — the canonical typecheck is NON-WRITING
   (`tsc --noEmit --incremental false`); it must pass from the read-only
   checkout and never write build-info files.
4. `node scripts/verify/hard-reset-static.mjs` — static clean-rebuild
   verification (the fixture corpus path is a committed dependency, not
   legacy).

Only when every check passes, issue the immutable signed TemplatePack via
`pack-release.mjs` and return the release JSON (release_id,
template_pack_ref, template_pack_path, sha256, signature, compatibility, qa,
trace_ref). If a check is stale or fails, return `failed=true` with the
error — never weaken or skip a gate.

## Visual-output gate (tofu / missing glyphs)

The verify gate (scripts/verify/adstudio-templates-v2.mjs, section 8.5) scans
every 4:5 and 9:16 sample and fails the check if any rendered text layer
shows tofu (.notdef boxes) or a declared face lacks the codepoints the doc
renders. The font corpus (public/fonts/adstudio, pinned in manifest.json) is
a VERSIONED dependency: never ship or re-encode faces; a damaged face is
repaired through the corpus process (Google Fonts face, Latin coverage
verified incl. '@' '>' and digits, manifest sha256 repinned) — the gate is
never weakened. Every variant ships both placement samples
(provenance.sample + provenance.storySample).

## Files

- Doc contract + zod: `src/lib/adstudio/v2/template-doc.ts`
- Renderer: `src/lib/adstudio/v2/render/` (`render-doc.ts`, `server.ts`,
  `fonts.ts`, `assets.ts`, `cover-crop.ts`, `truncate.ts`)
- Ingestion CLI: `scripts/adstudio/v2/ingest.mjs` (+ `scripts/adstudio/v2/lib/`)
- Template docs: `src/lib/adstudio/template-gallery-v2/<id>/template.json`
  (+ `evidence.json`, `history/`)
- Template assets: `public/adstudio-templates/<id>/plate-feed.webp`,
  `plate-story.webp`, `patch-<layerId>.webp`, `sample.png`
- Fonts: `public/fonts/adstudio/` + `manifest.json`
- Template Studio: `src/app/(operator)/operator/template-studio/`
- Editor: `src/components/adstudio/editor/`
- Gate: `scripts/verify/adstudio-templates-v2.mjs`
- Flags: `src/lib/adstudio/v2/flags.ts` (`ADSTUDIO_TEMPLATES_V2`)

Finish with `hermes/skills/blockwise-agent-cleanup/SKILL.md`.
