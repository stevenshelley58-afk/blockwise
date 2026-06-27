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
  through service-role code.

## AdStudio templates (the ad product)

AdStudio templates are the ads customers ship, and they have repeatedly regressed
into look-alike sets. Before creating, changing, or reviewing any template, read
and follow `hermes/skills/adstudio-template-builder/SKILL.md`. Non-negotiable:

- Diversity is the product, measured by what the ad DOES — the ad-radar
  classification (ad_type / primary_intent / focus), AI-extracted, never a hard
  visual-type list. Never reintroduce a fixed-role schema or a shared layout
  recipe/archetype/DSL. Templates declare their own slots; a no-headline ad, a
  multi-image collage, and a headshot ad are all valid.
- Every template derives from a real source ad in `meta_ad_candidates/` and
  records `sourceAd` provenance (one source ad -> at most one template).
- `node scripts/verify/adstudio-templates.mjs` (wired into `verify:hard-reset`)
  must pass, including the homogenization detector. Never weaken, bypass, lower a
  threshold, or special-case the gate to make work pass; strengthen it if it is
  genuinely wrong, with a test.
- Use canonical field names on `canvas.objects` (`size`/`weight`/`align`, never
  `fontSize`/`fontWeight`/`textAlign`), keep the Fabric mirror in lockstep, and
  make the gallery sample render as a real Meta ad. Photos fit slots via AI
  (vision + outpaint); `smart-crop.ts` rules are fallback only.

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
