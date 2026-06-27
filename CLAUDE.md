# Blockwise Claude Instructions

Follow `AGENTS.md` as the source of truth for Blockwise engineering rules.

## VPS / Deploy access

To SSH into the production VPS or redeploy Hermes, follow
`docs/runbooks/vps-ssh.md`. The persistent SSH key lives at `.secrets/vps_key`
(gitignored); host is `root@76.13.209.160`. The sandbox is wiped each session,
so re-stage the key per the runbook — do not assume SSH is already configured.

## AdStudio templates

Templates are the ad product and have repeatedly regressed into look-alike sets.
Before touching anything under `src/lib/adstudio/template-gallery/` or the
template pipeline, follow `hermes/skills/adstudio-template-builder/SKILL.md` and
keep `node scripts/verify/adstudio-templates.mjs` green. Never reintroduce a
fixed-role schema; never weaken the gate to pass.

## External Reference Repositories

Use these repositories as reference material when they are relevant to the
current task — guidance only, do not copy large blocks of code:

- https://github.com/affaan-m/ECC
- https://github.com/multica-ai/andrej-karpathy-skills
- https://github.com/safishamsi/graphify
- https://github.com/pbakaus/impeccable
