# adstudio-template-builder

## Purpose

Mandatory process for creating, changing, or reviewing ANY AdStudio ad template.
Read this before you touch anything under `src/lib/adstudio/template-gallery/`,
the template types/validator in `src/lib/adstudio/templates.ts`, the creative
renderers, the template gate, or template sample assets.

AdStudio templates ARE the product: they are the ads customers ship. The bar is
non-negotiable — every template must look like a real, professional Meta ad, and
the set as a whole must be visibly, structurally diverse.

## The law (read this first — it is why this skill exists)

This system has been rebuilt many times and keeps collapsing into "every template
looks the same." There is ONE root cause: a rigid schema that forced every
template into the same skeleton (one image + headline + subheadline + CTA). Never
again. The following are non-negotiable.

1. **Diversity is the product, measured by what the ad DOES.** Use the ad-radar
   classification (`ad_type` / `primary_intent` / `property_or_agent_focus` —
   appraisal, listing, open_home, just_sold, property_management, agency_brand,
   market_update; property / agent / agency / suburb focus), extracted by the AI
   classifier — never enforce visual "types." The set must cover that intent range
   and not be dominated by one intent. Visual variety follows from mirroring real ads.
2. **Never force a role set.** There is no required headline, no required CTA, no
   required single image. A template declares whatever slots its source ad
   actually has — including zero headlines or three images.
3. **Every template mirrors a real source ad and carries its classification.**
   Each template records `sourceAd` (a radar `creativeId` from
   `research.ad_creatives`, or a `meta_ad_candidates/` file) and copies that ad's
   `classification` (`ad_type` / `primary_intent` / `property_or_agent_focus`).
   Derived from proven ads, never invented to a uniform mould. One source ad maps
   to at most one template.
4. **The gate is law.** `scripts/verify/adstudio-templates.mjs` must pass. You may
   change templates to satisfy the gate. You may NEVER weaken the gate, lower a
   threshold, delete a check, comment one out, or add a per-template exception to
   make work pass. Editing the gate to permit homogenization is the one
   unforgivable move. If the gate is genuinely wrong, raise it with Steven and fix
   it deliberately with a test — do not quietly soften it.
5. **No bandaids.** Fix the owning system. If the renderer cannot express a
   layout, extend the renderer once, cleanly. Do not hand-fudge a template around
   a missing capability, and do not ship illustration stand-ins for real ads.

## Architecture: shared neutral renderer, self-describing templates

Sharing code is allowed and expected for non-visual plumbing (routing,
persistence, auth, gallery loading) AND for the neutral renderer/editor that draws
whatever a template declares. What is forbidden is shared *layout* logic that
decides structure: recipes, archetypes, a fixed-role schema, or a layout DSL that
constrains which slots may exist. Homogenization comes from shared structure, not
from a shared renderer.

- A **template is data** that fully describes its own layout: `canvas.objects`
  plus a Fabric mirror (`canvas.fabricJson`), with arbitrary roles and any count
  of image / text / shape slots.
- The **renderer** (`renderGeneratedCreativeSvg`, `renderCreativeSvg`) is a
  neutral interpreter: it draws objects exactly as declared and must never inject
  default structure or assume a role exists.
- The **editor** loads `canvas.fabricJson`. The objects array and the fabric
  mirror must stay in lockstep — same `objectId`, `role`, geometry, and copy in
  both.

## The manifest (per template)

A template is one JSON file in `src/lib/adstudio/template-gallery/`, imported by
`index.ts`, validated at load by `validateGalleryTemplate`, and gated by the
verifier. Required shape:

- Identity: `id`, `templateKey` (== `id`), `name`, `goal`, `offerId`, `category`,
  `audienceIntent`, `tags`, `promptHint`, `source: "builtin"`, `status: "approved"`.
- **Provenance (required):** `sourceAd: { creativeId }` (a radar
  `research.ad_creatives` id) or `sourceAd: { file }` (a `meta_ad_candidates/`
  path). One source ad per template.
- **Classification (required):** `classification: { ad_type, primary_intent,
  property_or_agent_focus }` copied from the ad-radar classifier output for that
  source ad. The gate measures diversity on these; it does not re-derive them.
- Placement: `placement` + `format` + `dimensions`. (Today the app supports
  `4:5`/1080x1350 and `9:16`/1080x1920; these pixel sizes are an inherited app
  limit, not a rule about what ads can be — widen them in the app when needed.)
- `sampleCopy`: representative copy for ONLY the text slots this template has.
- `canvas: { width, height, backgroundAssetId: null, objects: [...], fabricJson: {...} }`.
- `gallery: { sampleImageSrc, thumbnailSrc, alt }` — the rendered sample (see
  below). `meta`: the Meta lead-ad config.

### Slot model (the flexible part)

Slots ARE the `canvas.objects`. There is no fixed role list. Each object declares:

- `objectId` (stable, unique within the template), `role` (free-form, descriptive
  — e.g. `headline`, `agent_headshot`, `property_photo_2`, `stat_value`,
  `price_badge`), `type` (`text` | `image` | `logo` | `shape`).
- Geometry: `x`, `y`, `width`, `height` in canvas pixels, inside the canvas.
- **Text field contract (critical):** use `size`, `weight`, `align`, `font` /
  `fontFamily`, `lineHeight`, `fill`. Do NOT use `fontSize`, `fontWeight`, or
  `textAlign` — those are Fabric-only names; the SVG renderer ignores them and
  silently falls back to 32px/left, which is the classic "looks broken" bug.
- Image slots: `role`, `imageAnchor`, `clip`, and a real placeholder so the slot
  reads as a photo region. Multiple image slots are encouraged where the source
  ad has them.
- The Fabric mirror (`fabricJson.objects[]`) carries the same objects with
  Fabric-native names (`fontSize`/`fontWeight`/`textAlign`) plus a `blockwise`
  block (`objectId`, `role`, `type`, `locked`, `editableKind`). `fabricJson.version`
  must be `"blockwise-fabric-v1"`.

## Image slots, multi-image, and AI image-fit

- The upload flow must enumerate a template's image slots by role and request one
  image per slot — upload OR pick from the customer's library (listing images,
  office images, brand-kit headshots). A 3-photo collage asks for 3 photos; a
  headshot ad asks for the headshot.
- When a supplied photo does not fit a slot (aspect, subject position, headroom),
  fit it with **AI, not rules**: a vision pass assesses the photo against the slot,
  then `gpt-image-2` edits / outpaint (`outpaint-layout.ts`) crop / zoom / extend
  so it looks intentional. `smart-crop.ts` (saliency rules) is FALLBACK ONLY, used
  when AI is unavailable.

## Build workflow

1. **Pick a source ad** (radar `research.ad_creatives` or `meta_ad_candidates/`)
   that adds an intent/angle the set is light on — check the gate's intent mix
   first. Record its `sourceAd` and copy its `classification`.
2. **Read its real structure** (vision): how many images, is there a headline,
   headshot, badges, stat/chart, CTA, the type scale, the palette. Reproduce THAT
   — do not normalise it toward other templates.
3. **Author the JSON**: objects with correct field names + the fabric mirror in
   lockstep. Keep text inside its frame and legible (>= 18px). Size everything to
   match the source ad — there is no fixed headline size.
4. **Render the sample**: generate `gallery.sampleImageSrc` by running the real
   renderer over the template with `sampleCopy` and a representative photo, so the
   gallery card == what the generator produces == what the editor shows. The
   sample must look like a finished Meta ad, never a bare illustration.
5. **Wire it**: add the import to `template-gallery/index.ts`.
6. **Verify** (see Definition of done). Fix the template until green. Never touch
   the gate to pass.

## Definition of done

- `node scripts/verify/adstudio-templates.mjs` passes, including the
  homogenization detector.
- `npm run verify:hard-reset`, `npm run typecheck`, `npm run test` pass.
- The template renders headless to a valid, in-bounds ad and text fits its frame.
  (Text over a photo is fine and common — do not avoid it.)
- The gallery sample looks like a real Meta ad and matches the editor.
- The set still spans the ad-radar intent range and no single intent dominates
  (the gate enforces this).

## Constraints

- Never reintroduce a fixed-role schema, a shared layout recipe/archetype/DSL, or
  any "every template must have X" rule. Diversity over uniformity, always.
- Never weaken, bypass, or special-case the gate to pass. Strengthen it if it is
  wrong.
- Never ship an illustration as a substitute for a real-ad-quality sample.
- Never use `fontSize`/`fontWeight`/`textAlign` on `canvas.objects` (Fabric mirror
  only).
- One source ad -> at most one template. Record provenance.
- Finish with `hermes/skills/blockwise-agent-cleanup/SKILL.md`.

## Files / commands

- Templates: `src/lib/adstudio/template-gallery/*.json` (+ `index.ts`)
- Types/validator: `src/lib/adstudio/templates.ts`
- Renderers: `src/lib/adstudio/generator.ts`, `src/lib/adstudio/creative-svg.ts`
- Image fit: `src/lib/adstudio/ai-providers.ts`, `outpaint-layout.ts`,
  `smart-crop.ts` (fallback)
- Source ads: `meta_ad_candidates/` (+ `_meta_ad_candidates.csv`)
- Gate: `node scripts/verify/adstudio-templates.mjs`
- `npm run verify:hard-reset` · `npm run typecheck` · `npm run test`
