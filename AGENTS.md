# Blockwise Engineering Rules

## Product law (source of truth)

Blockwise is the customer product. Customers pick Frank-built template packs,
edit ads, Save PNGs, Publish to Meta, and manage campaigns and billing.
Blockwise does not scrape ads, write blogs, or generate templates — those are
Frank's tools. Ignore older rules in this repo that say otherwise.

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
  through service-role code via the `public.provider_token_vault_*` RPCs — the
  `private` schema is not exposed through PostgREST, so never query it with
  `.schema("private")`.

## AdStudio (current state)

AdStudio is the customer editor over Frank-built template packs; Frank owns
template generation and layered packs. The legacy flat-clone system was
deleted (Phase 1). Do not reference `buildCloneImageRequest`,
`template-gallery/`, `reference-clone.ts`, or
`scripts/verify/adstudio-templates.mjs` — none exist. See
`docs/plans/PRODUCT-REBUILD.md` for the leftover inventory.

## Component system (shadcn/ui canonical)

- The customer (self-serve) surface is built on shadcn/ui + Tailwind v4. New
  customer-facing UI must reuse the primitives in `src/components/ui/` and
  Tailwind utilities wired to the Blockwise token bridge (`src/app/tailwind.css`,
  the `--ui-*` variables). Do not add new global CSS classes for customer UI.
- Operator and monitor surfaces remain on the existing CSS shell (`globals.css`)
  until their own migration. Do not mix the two systems within one route.
- Install components with the shadcn CLI (`npx shadcn add <name>`) instead of
  hand-rolling parallel primitives (button, dialog, sheet, table, select, etc.).
- The `.tw` scope and the no-preflight Tailwind setup are load-bearing for
  coexistence with `globals.css`. Do not enable Tailwind preflight or remove
  the scope.

## Mandatory UI workflow

For every task affecting UI, UX, styling, layout, typography, responsive
behaviour, accessibility, animation, or interaction:

1. Explicitly invoke `$impeccable`.
2. Select and state the relevant Impeccable commands before editing.
3. Inspect the current interface in the browser before changing it.
4. Reuse existing Blockwise design tokens, components, and visual patterns.
5. Do not create a parallel design system or introduce a new visual language.
6. Verify the final result in Chrome at desktop and mobile viewport sizes.
7. Report:
   - skills loaded
   - Impeccable commands used
   - routes inspected
   - viewport sizes checked
   - remaining visual or interaction issues

For significant UI work, the minimum workflow is:
`critique -> craft -> adapt -> harden -> polish`.

For redesigns, use:
`critique -> distill -> craft -> layout -> typeset -> adapt -> polish`.

For visual audits, use `audit`, `critique`, `harden`, and `optimize`. Do not
modify code until the audit is complete.

For small UI improvements, use at least `polish` and `adapt`.

Automatic skill selection is acceptable for routine work, but every meaningful
UI or UX task must explicitly invoke `$impeccable` and name the commands used.

## Acceptance (every PR)

- `npm run typecheck` and `npm run test` pass; update or delete stale tests
  deliberately, never skip them.
- Runtime verification happens on the controlled self-hosted VPS/Caddy staging
  or production target defined by the
  [production-readiness](docs/runbooks/production-readiness.md),
  [OSS product migration](docs/runbooks/oss-product-migration.md), and
  [rollback](docs/runbooks/rollback.md) runbooks. Localhost and Vercel Preview
  are not acceptance targets.
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
