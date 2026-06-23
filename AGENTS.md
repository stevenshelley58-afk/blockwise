# Blockwise Engineering Rules

## Principles

- Delete > simplify > abstract. No speculative abstraction, no future-proofing.
- Reduce user-facing complexity first, code complexity second.
- Proper fixes only. Fix the root cause in the owning system; do not ship
  shortcuts, temporary patches, workarounds, band-aids, bypasses, one-off
  overlays, or data edits as the final solution. Delete and rebuild the broken
  path when that is the cleanest fix.
- When production data is wrong, quantify the blast radius, repair affected
  data, and add the system guard or regression coverage that prevents the same
  class of corruption from returning.
- Fix forward. Quarantine genuinely ambiguous failures and note them in the
  report instead of stalling.
- Do not replace one messy file with five new messy files.
- User-facing product language must remove complexity. Do not use "ad packs" or
  campaign/campaigns language in marketing or product copy unless an external
  platform term absolutely requires it; prefer plain words like ads, draft ads,
  live ads, approvals, and results.
- Product positioning: Blockwise prepares real estate ads for agents. The goal
  is more leads and listings, not helping agents "sell houses" or implying
  Blockwise sells property for them.
- Public marketing design rule: less is more. Keep the first viewport focused
  on one message, one primary action, and one restrained proof visual. Avoid
  dashboard collages, dense panels, excessive cards, and feature pile-ups that
  make the page feel complex.

## Safety rules (always hold)

- No secrets, `.env*` files (except `.env.example`), databases, or build
  output in version control.
- Workspace isolation must hold: every workspace-scoped query filters by
  `workspace_id`, and RLS policies stay enabled on workspace-scoped tables.
- Schema changes ship as tested migrations. Destructive changes (drops,
  merges) require a row-count check first; archive non-empty tables to
  `legacy_archive` instead of hard-dropping.
- Hermes runs only on the VPS (`docs/runbooks/vps-ssh.md`). Vercel code never
  executes Apify or research scraping; it only reads research state from
  Supabase.
- Provider tokens live in `private.provider_token_vault` and are only touched
  through service-role code.

## Acceptance (every PR)

- `npm run typecheck` and `npm run test` pass; update or delete stale tests
  deliberately, never skip them.
- Runtime verification happens on Vercel Preview or Production URLs only.
  Localhost is never acceptance.
- If trigger.dev tasks or Supabase migrations changed, deploy/apply them and
  confirm they register before merge.

## Completion hygiene

- Before reporting a task done, handing off, or opening a PR, use
  `hermes/skills/blockwise-agent-cleanup/SKILL.md`.
- Clean only artifacts the agent created or can prove are disposable; never
  revert, delete, or hide unrelated user work.
- Agent-created source changes must be committed/pushed/PR'd, deleted, or
  explicitly blocked. Do not leave them as anonymous dirty-worktree residue.
- Final reports must state what cleanup ran, what verification passed, and what
  intentionally remains dirty or blocked.

## Tooling

- Use the official CLI/MCP/plugin for GitHub, Vercel, and Supabase. Start the
  normal login flow when auth is missing instead of avoiding the work.
- Check CodeGraph freshness (`codegraph_status`) at the start of code work;
  `codegraph sync` if stale.
- Production deploys must run committed source from git plus the normal deploy
  path. Do not leave direct VPS file edits, copied files, or local overlays as
  the running production state.

## Git scope

- The repository owner pre-authorizes staging, committing, pushing, merging
  once green, and Vercel deployment for release work. Log decisions in the
  commit/PR description.
