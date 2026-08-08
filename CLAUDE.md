# Blockwise Claude Instructions

Follow `AGENTS.md` as the source of truth for Blockwise engineering rules.

## VPS / Deploy access

To SSH into the production VPS or redeploy Hermes, follow
`docs/runbooks/vps-ssh.md`. The persistent SSH key lives at `.secrets/vps_key`
(gitignored); host is `root@76.13.209.160`. The sandbox is wiped each session,
so re-stage the key per the runbook — do not assume SSH is already configured.

## AdStudio templates

Before touching `src/lib/adstudio/template-gallery-v2/`, the renderer, or the
template pipeline, follow `hermes/skills/adstudio-template-builder-v2/SKILL.md`.
A template is a layered document decomposed directly from one real source ad
(plate + image slots + overlay patches + measured text layers), contracted by
`src/lib/adstudio/v2/template-doc.ts`. Gallery samples and customer ads are both
deterministic renders of that doc — no image model paints a whole ad anywhere.
Keep `node scripts/verify/adstudio-templates-v2.mjs` green (the v1 gate
`scripts/verify/adstudio-templates.mjs` keeps running until the v1 gallery is
retired).

## External Reference Repositories

Use these repositories as reference material when they are relevant to the
current task — guidance only, do not copy large blocks of code:

- https://github.com/affaan-m/ECC
- https://github.com/multica-ai/andrej-karpathy-skills
- https://github.com/safishamsi/graphify
- https://github.com/pbakaus/impeccable
