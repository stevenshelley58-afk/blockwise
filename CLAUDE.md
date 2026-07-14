# Blockwise Claude Instructions

Follow `AGENTS.md` as the source of truth for Blockwise engineering rules.

## VPS / Deploy access

To SSH into the production VPS or redeploy Hermes, follow
`docs/runbooks/vps-ssh.md`. The persistent SSH key lives at `.secrets/vps_key`
(gitignored); host is `root@76.13.209.160`. The sandbox is wiped each session,
so re-stage the key per the runbook — do not assume SSH is already configured.

## AdStudio templates

Before touching `src/lib/adstudio/template-gallery/` or the template pipeline,
follow `hermes/skills/adstudio-template-builder/SKILL.md`. A template is one safe
sample image plus its declared customer image/text inputs. Gallery samples and
customer ads must both use `buildCloneImageRequest`; editing begins only after a
finished clone exists. Keep `node scripts/verify/adstudio-templates.mjs` green.

## External Reference Repositories

Use these repositories as reference material when they are relevant to the
current task — guidance only, do not copy large blocks of code:

- https://github.com/affaan-m/ECC
- https://github.com/multica-ai/andrej-karpathy-skills
- https://github.com/safishamsi/graphify
- https://github.com/pbakaus/impeccable
