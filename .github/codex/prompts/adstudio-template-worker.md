# Ad Studio Standalone Template Worker

You are creating exactly one Blockwise Ad Studio template module in this isolated cloud job.

## Scope

- Candidate ID is provided in the workflow prompt, for example `meta_094`.
- Edit exactly one source file: `src/lib/adstudio/gold-templates/meta-XXX.ts`.
- Do not edit `src/lib/adstudio/gold-adstudio-templates.ts`, tests, sample card PNGs, generated descriptor files, package metadata, or unrelated code.
- Do not stage, commit, push, deploy, or open a PR.

## Context To Use

- `src/lib/adstudio/extracted-meta-templates.generated.ts` is committed with all 330 candidate descriptors. Use the matching descriptor as factual source data.
- The raw `meta_ad_candidates/` source folder is intentionally ignored and may not exist in cloud jobs. Do not depend on it being present.
- Inspect existing files under `src/lib/adstudio/gold-templates/` only as examples of the expected contract. Do not import from them.

## Required Output Contract

Create a complete, self-contained TypeScript module that exports:

- `metaXXXTemplate`
- `metaXXXSample`

The template must define:

- Metadata: `id`, `templateKey`, `name`, `goal`, `offerId`, `promptHint`, `source: "operator"`, `status: "approved"`, `sampleCopy`, `sampleStyle`, `winnerRationale`, and `complianceNote`.
- `sampleStyle.sampleState: "WA"`.
- `sampleStyle.sampleCardImagePath: "adstudio-samples/gold/meta_XXX.png"`.
- `sampleCardImageUrl: "/adstudio-samples/gold/meta_XXX.png?v=reference-board-pack-v1"`.
- Hand-laid `designs` for `4:5`, `9:16`, and `1:1`. Do not stretch one format mechanically.
- Image slots with stable source layer IDs, editor labels, roles, required booleans, guidance, and sensible geometry.
- At minimum, non-market templates need `primary_photo`; property `primary` and `secondary` slots are required. `agent_headshot` is required only when no brand-kit/default headshot behavior is appropriate.
- Text slots with `editorLabel`, `copyField`, `maxChars`, `maxLines`, `guidance`, and frame geometry.
- CTA button with `copyField: "cta"`, `maxChars`, `maxLines: 1`, `editorLabel`, and `guidance`.
- Local helper functions only. If you use helpers, define them inside this module.

## Hard Rules

- The module may only import shared platform types from `../template-design.ts` and `../templates.ts`.
- Do not import another template module, shared layout factory, recipe, archetype, primitive, or template engine.
- Do not use non-ASCII characters.
- Keep rendered text professional: no text object below 18px, headline objects should render at 46px or larger.
- Text must fit its intended frame. Prefer tighter copy limits over auto-shrinking.
- Add clipping/safe framing where needed so text cannot run across image slots.
- Sample media filenames must come from existing generated AU sample assets:
  - `au-brick-family-home.jpg`
  - `au-character-cottage.jpg`
  - `au-coastal-luxury.jpg`
  - `au-family-rendered.png`
  - `au-federation-bungalow.png`
  - `au-limestone-coastal.png`
  - `au-modern-coastal.png`
  - `au-riverside-townhouse.jpg`
  - `au-urban-townhouse.png`

## Verification In This Job

Run a focused import/schema check for your new module. If it fails, fix the module before finishing.

Final response should list the file created and the checks run.
