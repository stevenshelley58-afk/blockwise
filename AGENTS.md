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

## AdStudio templates (the ad product)

Before creating, changing, or reviewing a template, follow
`hermes/skills/adstudio-template-builder/SKILL.md`. There is one process:

1. Start with one real source ad and record its file or creative ID, SHA-256
   hash, and AI ad-radar classification.
2. Use vision to extract only the customer inputs visible in that ad: each
   required image and each editable text value.
3. Create a safe public gallery sample by sending the private source, generic
   replacement assets, and safe sample copy through `buildCloneImageRequest`.
   The public sample must have a different hash from the source.
4. Customer generation sends that public sample, the customer's declared image
   inputs, and their exact text through the same `buildCloneImageRequest`.
5. The result is one finished image. Only after QA passes may the Stitch-style
   editor target a text or image region; every edit uses the latest finished ad
   as reference image 1 and preserves the rest.

There is no alternate template version, layout recipe, layer-based creation
path, or second full-ad generator. Diversity is measured by the AI ad-radar
classification. `node scripts/verify/adstudio-templates.mjs` and
`npm run verify:hard-reset` must pass; never weaken or special-case either gate.

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
