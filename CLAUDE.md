# Blockwise Claude Instructions

Follow `AGENTS.md` as the source of truth for Blockwise engineering rules.

## VPS / Deploy access

To SSH into the production VPS or redeploy Hermes, follow
`docs/runbooks/vps-ssh.md`. The persistent SSH key lives at `.secrets/vps_key`
(gitignored); host is `root@76.13.209.160`. The sandbox is wiped each session,
so re-stage the key per the runbook — do not assume SSH is already configured.

## External Reference Repositories

Use these repositories as reference material when they are relevant to the
current task:

- https://github.com/affaan-m/ECC
- https://github.com/multica-ai/andrej-karpathy-skills
- https://github.com/safishamsi/graphify
- https://github.com/pbakaus/impeccable

Treat them as guidance only. Do not add dependencies, copy large blocks of
code, change provider behaviour, change auth behaviour, change public API
response shapes, or change database schema unless the user explicitly asks for
that work and it still satisfies `AGENTS.md`.
