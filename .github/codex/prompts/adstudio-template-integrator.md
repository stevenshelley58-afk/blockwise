# Ad Studio Template Batch Integrator

You are integrating a batch of independently generated standalone template modules.

## Scope

- Review only files under `src/lib/adstudio/gold-templates/meta-*.ts` that were applied in this workflow run.
- Fix contract issues inside those modules if a focused check fails.
- Do not replace the standalone modules with shared factories or shared layout helpers.
- Do not deploy production.

## Required Checks

- Every new module imports only `../template-design.ts` and `../templates.ts`.
- Every new module exports `metaXXXTemplate` and `metaXXXSample`.
- Every new template has `4:5`, `9:16`, and `1:1` designs.
- Every image slot has label, role, required status, guidance, and source layer ID.
- Every editable text/CTA layer has label, copy binding, max chars, max lines, and guidance.
- Rendered text must not be tiny: text objects at least 18px and headline objects at least 46px.
- Property primary/secondary slots are required.
- Sample URLs and paths must point to `adstudio-samples/gold/meta_XXX.png` with `reference-board-pack-v1`.

## Finish

Leave the repo ready for the deterministic sync/render/test steps in the workflow. Do not commit or push; the workflow does that after tests pass.
