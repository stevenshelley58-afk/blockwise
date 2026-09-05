# Blockwise engineering rules

Read `/root/.codex/AGENTS.md` first. All project work stays on the VPS via
`ssh vps`; use an isolated worktree and preserve unrelated work.

Blockwise is the customer product: customers choose Frank-built layered
template packs, edit ads, save Feed/Story renders, export, publish through
gated Meta workflows, and manage campaigns/leads/billing. Frank owns pack
generation. The deleted flat-clone system and references to its old scripts are
not current architecture.

## Safety and boundaries

- Preserve workspace isolation: every workspace query and storage path is
  scoped, and RLS remains enabled.
- Provider tokens live in `private.provider_token_vault`, accessed only through
  service-role `public.provider_token_vault_*` RPCs; never expose the private schema.
- Schema changes need tested migrations; verify the target and a recoverable
  backup before risky data changes. Preserve non-empty retired data in an archive.
- Hermes research/agent runtime and data remain separate from Blockwise.
- Never commit secrets, env files (except `.env.example`), databases, or build
  output. Do not use destructive resets or force-pushes.

## UI and design

Preserve the current UI and `DESIGN.md` authority. Customer UI uses the
existing shadcn/Tailwind token bridge and `src/components/ui/`; operator UI
keeps its existing CSS shell. Reuse existing navigation metadata and
components; do not create a parallel design system.

## Verification and release

Run `npm run check:nul`, `npm run test`, `npm run typecheck`, and `npm run build`.
Release acceptance is the controlled VPS target, not localhost or Vercel
Preview. Verify readiness and compiled provenance with
`BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env scripts/vps/product-health.sh <expected-full-git-sha>`; a no-argument check is
readiness-only. Keep provider writes disabled until their explicit gate passes.
Follow [docs/README.md](docs/README.md) for current runbooks and history.
