# AdStudio local subscription adapter design

## Objective

Prove that two AdStudio gallery samples can be created through Codex subscription
image generation while preserving the existing AdStudio template contract,
`buildCloneImageRequest`, source provenance, input ordering, hashes, visual QA,
and repository gates.

The pilot uses:

- Feed source: `meta_ad_candidates/01_feed_4x5_best/meta_002.png`
- Stories/Reels source: `meta_ad_candidates/02_stories_reels_9x16/meta_247.png`

Neither source is currently used by an approved template.

## Product invariants

The local adapter changes only the execution transport. It does not introduce a
second template contract, prompt builder, rendering recipe, layer model, or edit
path.

Each pilot template must still:

1. Start from one unique real source with a SHA-256 hash and AI classification.
2. Declare only the customer images and editable text visible in that source.
3. Use safe replacement assets and copy with no source advertiser identity.
4. Build the render request through `buildCloneImageRequest`.
5. Preserve contractual reference order: source first, then declared assets.
6. Produce one finished public sample whose hash differs from the source.
7. Pass exact-copy, asset replacement, identity leakage, visual defect, and
   repository verification gates.
8. Remain compatible with customer generation through the unchanged
   `buildCloneImageRequest` path.

## Architecture

The adapter has two local boundaries around the Codex-only image call.

### Request export

The existing template builder creates a locked request packet from
`buildCloneImageRequest`. The packet contains:

- template ID and source path
- exact prompt and negative prompt
- ordered reference paths and SHA-256 hashes
- exact safe copy
- aspect ratio and seed
- canonical request hash

The export step validates that all referenced files exist and every required
template input is supplied. It writes no approved template sample.

### Subscription execution

Codex reads the locked packet and submits its exact prompt and ordered local
references through the built-in image-generation tool. The prompt is not
rewritten. The resulting bitmap is copied into the packet's expected staging
path.

Because a ChatGPT/Codex subscription is not an API credential, this is the only
non-CLI step and requires an active Codex task.

### Result import

The builder verifies the request packet and staged output before accepting it:

- request and reference hashes still match
- dimensions and format are valid
- source and output hashes differ
- expected output path is inside the public AdStudio sample directory
- QA evidence exists and passes

Only then does it update the manifest sample hash and make the image eligible
for gallery import.

## Vision analysis

Codex inspects each local source image and extracts the same schema currently
required by `adstudio:create-template analyse`. The builder validates that
structured result through the existing `adStudioTemplateAnalysis` schema before
writing a draft manifest. The extracted contract is then visually checked
against the source before rendering.

No layout coordinates, fonts, layers, canvas objects, or rendering recipes are
recorded.

## Quality assurance

Each pilot output must pass all of the following:

1. **Contract review:** every visible replaceable image and editable text value
   is declared, with no invented input.
2. **Request integrity:** prompt, reference order, copy, seed, and input hashes
   match the exported packet.
3. **Deterministic checks:** dimensions, paths, hashes, uniqueness, manifest
   structure, and Meta housing configuration pass.
4. **Visual comparison:** source, replacements, and output are reviewed together
   for composition fidelity, mandatory asset replacement, exact safe copy,
   source identity removal, and obvious defects.
5. **Full-size inspection:** every output is inspected at native size. Thumbnail
   inspection alone is insufficient.
6. **Bounded correction:** one corrected regeneration is allowed. A second
   failure quarantines the source and produces no approved template.

The existing `adstudio-templates`, hard-reset, typecheck, and test gates remain
blocking and may not be weakened or special-cased for local output.

## Audit evidence

Each accepted sample retains a local evidence record containing the request
hash, input hashes, output hash, timestamps, execution transport, QA verdicts,
and correction count. This replaces API billing metadata only; it does not
replace source provenance or template evidence.

Evidence must not contain secrets, private provider tokens, or the private
source image itself.

## Failure handling

- Missing or changed input: reject before generation.
- Subscription generation unavailable: leave the packet pending; do not switch
  models or transports silently.
- Invalid output: reject and retain the failed attempt only until review ends.
- QA failure: perform at most one corrected regeneration.
- Persistent failure: quarantine the source without importing a template.
- Repository gate failure: fix the owning implementation; never add a
  template-specific exception.

## Pilot acceptance

The pilot succeeds only when both templates are approved, imported, visually
inspected, and pass:

- `node scripts/verify/adstudio-templates.mjs`
- `npm run verify:hard-reset`
- `npm run typecheck`
- `npm run test`

If either source is quarantined after its correction attempt, the pilot is not
complete and the failure is reported with its evidence.

## Out of scope

- Building the remaining 48 templates
- Changing customer campaign generation
- Changing the in-place editor
- Adding another image provider or fallback model
- Altering gallery UI, design tokens, or navigation
- Weakening or bypassing any existing verification gate
