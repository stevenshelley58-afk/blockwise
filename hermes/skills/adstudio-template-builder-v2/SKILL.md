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
6. One source ad produces at most one template.

## Process

`source → analyse → decompose → restyle → story-draft → check → Studio QA → ready`

All commands are `node scripts/adstudio/v2/ingest.mjs <subcommand>`. They are
**build-time only** and run on a dev machine or the Hermes VPS — never on
Vercel (the OpenCV/tesseract/rembg dependencies do not exist there).

| Step | Command | What it produces |
|---|---|---|
| 1. analyse | `analyse --source <path> --id <id>` | Vision input contract + `sourceValues` (the source's own on-image text per key) into `template-gallery-v2/<id>/evidence.json`. |
| 2. decompose | `decompose --id <id>` | OCR text regions, corpus font match, text-inpaint mask → **plate**, slot boxes + mask kind, operator-marked overlay patches. Emits `template.json` with `exactness.status: "draft"` + a residual report. |
| 3. restyle | `restyle --id <id>` | Applies the Studio-recorded `restyle` block headlessly (palette remap, generic slot assets, safe copy), renders the **public sample** via `render/server.ts`, back-fills `provenance.sample.contentHash`. Fails if the sample hash equals the source hash or the restyle evidence is trivial. |
| 4. story-draft | `story-draft --id <id>` | 9:16 draft: plate extended to 1920 (sampled-edge blur-extend by default; `--ai-extend` outpaints the margin bands only), layers repositioned into Meta safe zones. |
| 5. check | `check --id <id>` | **The fidelity gate.** Renders the doc with `sourceValues` + the source photos and compares against the source ad. Runs the stress matrix and asserts it does not throw. Writes `exactness.residuals`. |
| 6. Studio QA | `/operator/template-studio/<id>` | Human confirms fonts, nudges boxes, marks overlay patches, completes the restyle tab, signs off the stress preview, and approves. |
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
  borders, badges) and accept the auto background-removal.
- Complete the **Restyle tab** (mandatory): palette remap, generic assets per
  slot, safe copy. This records `restyle` and renders the public sample.
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

`check` renders the doc with the **source's own values** and compares against
the **original source ad** — the template must reproduce the designer's actual
ad before it is allowed to reproduce anyone else's:

- **Outside text boxes and restyled plate regions: byte-identical.** Plates,
  patches, and untouched slot pixels are a `drawImage` of source bytes; any
  diff is a pipeline bug and a hard fail. Restyle recolours are excluded by the
  recorded `paletteMap` regions.
- **Per text region:** grayscale RMSE over the padded box ≤ **0.14** AND
  stroke-profile distance (the `match-font.mjs` Stage-B metric) within its
  existing live-gate bounds. A region over threshold cannot ship editable.
- Residuals are stored in `exactness.residuals` and **re-verified** by the
  gate. Self-reported passes do not count.

## Definition of done

`node scripts/verify/adstudio-templates-v2.mjs` must pass every check below,
plus `npm run typecheck`, `npm run test`, `npm run verify:hard-reset`, and
`npm run test:render-parity`. Never weaken a gate or add a template-specific
bypass.

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

Source curation is the cheapest quality control: only proven, designer-grade
ads enter `meta_ad_candidates/`, recorded as an explicit curation flag in
evidence. The gallery can never look better than its sources.

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
