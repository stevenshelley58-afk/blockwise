# Ad Studio Fix — Multi-Agent Build Plan

Audience: A Claude Code orchestrator spawning parallel Sonnet sub-agents.  
Goal: Fix 28 reviewed issues with maximum safe parallelism and zero stepping on each other, while obeying AGENTS.md.

## How to use this document

The orchestrator reads this file, then spawns one agent per stream below, each in its own git worktree (the repo already uses `.claude/worktrees/`).

Work happens in waves. A wave only starts when the previous wave's gate is green (`npm run check`).

Every agent obeys the Ground rules and validates against its acceptance criteria before opening a PR.

The orchestrator merges in the merge order given, runs the full gate, and triggers a Vercel Preview for QA.

---

## Ground rules (every agent, every wave) — derived from AGENTS.md

### Preflight (do this first, always)
- Check CodeGraph freshness: MCP `codegraph_context` or `codegraph status`; if stale, sync first. If a stale-file banner appears, read that file before editing.
- Read `AGENTS.md` before touching code.
- Confirm you are in your own worktree/branch, not main.

### PR mode (tag correctly)
- **Refactor PR (Wave 0):** pure cleanup. Net production LOC must decrease, behaviour preserved, no UI redesign. Report the Code-Reduction metrics block.
- **Simplification PR (Waves 1–3):** UI changes that remove user-facing complexity. Tag the PR `simplification` and state which user-facing complexity it removes. LOC may rise but must be justified.

### Hard rules (never break)
- ❌ No new dependencies (we have next 16, react 19, lucide-react, recharts, zod, @supabase/* — use only these).
- ❌ No DB schema changes.
- ❌ No changes to existing public API response shapes.
- ❌ No auth/provider behaviour changes.
- ❌ No new generic helpers/managers/factories/interfaces unless they collapse real duplication.
- ❌ Don't "replace one messy file with five messy files" — extractions must be cohesive, single-responsibility modules.

### Validation (per AGENTS.md)
- Gate locally with `npm run typecheck` and `npm run test` (Node's test runner).
- Touching the publish/research flows: also `npm run test:e2e`.
- Validate runtime behaviour on the Vercel Preview URL for your branch.

### Definition of done (per PR)
`npm run check` green · relevant e2e green · Vercel Preview manually verified · metrics block filled in · no forbidden changes · issue IDs referenced in the PR description.

---

## The coordination problem

~90% of the UI lives in one file: `src/components/adstudio/ad-studio-workbench.tsx` — 1,762 lines holding the top bar, all nine setup panels, the preview renderer, the inspector and a giant STYLES string.

**Strategy — extract once, then parallelize:**
- Wave 0  (1 agent, SEQUENTIAL)  → create clean file seams + delete dead code        [Refactor PR]
- Wave 1  (5 agents, PARALLEL)   → each owns separate files; wire UI ↔ existing APIs  [Simplification PRs]
- Wave 2  (1–2 agents)           → flow/IA across the composition root + new endpoint  [Simplification PRs]
- Wave 3  (1 agent)              → polish, full QA, Vercel Preview walkthrough

---

## Wave 0 — "Architect" agent (sequential, blocks everything)

**Mode:** Refactor PR (behaviour-preserving). **Branch:** `refactor/adstudio-modularize`.

### Mission
Carve the monolith into cohesive modules and feature-hooks so Wave-1 agents own disjoint files, and delete dead code so net LOC falls. No behaviour change, no visual change.

### Tasks

1. **Trust/config quick win first:** disable the Vercel Toolbar / Live feedback on production (issue C3). Check for a code/config path (`@vercel/toolbar` import, `vercel.json`, a layout-level mount); if it's purely a dashboard setting, document the exact toggle for the user and proceed. Remove the resulting zustand console warning (L6) if it originates in-repo.

2. **Extract `ad-studio-workbench.tsx`** into a thin composition root plus cohesive files:
   - `src/components/adstudio/topbar.tsx` (top bar + overflow menu)
   - `src/components/adstudio/panels/{campaign,brand,media,copy,audience,landing,publish,settings}-panel.tsx` (split the PanelContent switch)
   - `src/components/adstudio/preview.tsx` (PreviewControls, AdPreview, Segmented)
   - `src/components/adstudio/inspector.tsx` (Inspector, ReadinessCard, PublishPanel, VariantStrip, CopyFields)
   - `src/components/adstudio/styles.ts` (the STYLES constant)

3. **Feature hooks** so handler logic doesn't collide later:
   - `use-ad-studio.ts` (core: section/tab/pack/toast/save)
   - `use-brand-kit.ts` · `use-copy.ts` · `use-readiness.ts` · `use-media.ts`
   - Wave 0 defines their interfaces and moves the existing logic in unchanged.

4. **Delete dead code** while moving (counts toward the LOC decrease): unused `FORMAT_META.kind`/`imageClass` and the non-existent `*-frame` class names (L1), any unused imports, and clearly-dead stubs.

5. Keep STYLES intact (visual parity). Run `npm run check` — must stay green with identical behaviour.

### Acceptance
Behaviour + pixels unchanged; `npm run typecheck` + `npm run test` green; largest-file LOC down sharply; net production LOC down; metrics block reported. Merge before Wave 1 starts.

---

## Wave 1 — five parallel agents (all simplification PRs)

Each agent works in its own worktree, owns disjoint files, and may read (never edit) others.

### 🅰 Agent A — Brand pack  ·  fixes C1, M8

**Owns:** `panels/brand-panel.tsx`, `use-brand-kit.ts`  
**Reads:** `lib/adstudio/persistence.ts`, `lib/adstudio/types.ts`

**Do:** Make the brand fields editable (lift brandKit into use-brand-kit state). Add three actions:
- Re-scan website → `POST /api/adstudio/brand-kits/[id]/rescan`
- Save → `PATCH /api/adstudio/brand-kits/[id]`
- Approve kit → `POST /api/adstudio/brand-kits/[id]/approve`

Format the phone ((08) 9999 0000), give the preview card spacing, and source/label Agent distinctly from Agency (M8). Use existing request/response shapes only.

**Accept:** On the Preview URL you can edit a field, Save, see it persist on reload; Re-scan repopulates; Approve flips status; preview + readiness reflect changes.

---

### 🅱 Agent B — Copy & readiness  ·  fixes H1, H2, H3, H4, H5

**Owns:** `panels/copy-panel.tsx`, `copy-fields.tsx`, `use-copy.ts`, `use-readiness.ts`, `inspector/readiness-card.tsx`  
**Reads:** `lib/adstudio/platform-rules.ts` (Meta limits), `lib/adstudio/scoring.ts`

**Do:** Wire the Copy-panel assist row to `applyCopyAssist` (H1) and implement all six labels in `use-copy` — give Make sharper / Make more premium / Generate 5 hooks real behaviour instead of the ?-append fallback (H2). Compute the readiness score from the items so it can reach 100% (H3). Give "Ad copy" & "Call to action" a real done path (within limits / CTA chosen) instead of permanent warn (H4). In `copy-fields`, turn the counter red + warn when length > COPY_LIMITS[key], and surface that in readiness (H5).

**Accept:** All six chips change copy in both Copy panel and Inspector→Edit; score moves with real progress and hits 100% when complete; over-limit text is visibly flagged.

---

### 🅲 Agent C — Media & preview  ·  fixes H6, H8

**Owns:** `panels/media-panel.tsx`, `use-media.ts`, `preview.tsx`  
**Reads:** `use-ad-studio.ts` (core, for primaryImage)

**Do:** Make library tiles selectable → `setPrimaryImage(asset.src)` updates the active state and the preview (H6); optionally add "Generate image" → `POST /api/adstudio/generate-image`. Make Square a genuine 1:1 layout distinct from the 4:5 feed, or remove the redundant tab and keep three formats (H8). Export `AdPreview` cleanly so the Preview modal (Agent D) can reuse it.

**Accept:** Clicking any library tile changes the preview image; Feed and Square are visibly different (or Square is gone); no dead FORMAT_META fields remain.

---

### 🅳 Agent D — Top bar, menus & variant actions  ·  fixes C2, H7, H9, L2

**Owns:** `topbar.tsx`, `variant-strip.tsx`, `inspector.tsx` (tab shell + Variants/Edit tabs), `panels/landing-panel.tsx`, `panels/audience-panel.tsx`, `panels/settings-panel.tsx`  
**Reads:** `preview.tsx` (for the Preview modal), `use-ad-studio.ts`

**Do:**
- Add outside-click + Escape dismissal to the "…" menu (C2)
- Make Preview open a real full-size/device-frame modal reusing `AdPreview` — or remove it (H7)
- Wire the controls that already have endpoints (H9):
  - Duplicate campaign → `POST /campaigns/[id]/duplicate`
  - Archive → `PATCH /campaigns/[id]`
  - Variant Regenerate → `POST /campaigns/[id]/generate`
  - Add variant → generate +1
  - View all → switch inspector to Variants
  - Test landing page → open `destinationUrl` in a new tab
- Make the breadcrumb a real menu or drop its chevron (L2)
- (Delete / Share / Send-for-approval wait for Wave 2)

**Accept:** Menu closes on outside-click/Escape; every wired button performs its action against the Preview URL; no `<button>` in your files lacks an `onClick` (or is intentionally removed).

---

### 🅴 Agent E — Backend, data & config  ·  fixes C3, C4, L4 + new endpoint

**Owns:** `app/api/adstudio/campaigns/[id]/route.ts` (add DELETE), `app/(customer)/ad-studio/page.tsx`, `lib/adstudio/demo-data.ts`, Vercel/toolbar config  
**Reads:** `lib/adstudio/persistence.ts`, RLS policies in `supabase/`

**Do:**
- If Wave 0 didn't fully kill the Vercel Toolbar, finish it (C3)
- In `page.tsx`, branch on `liveBundle === null`: pass an `isSample` flag so the UI can badge demo data / route to onboarding instead of presenting it as real (C4)
- Rewrite the broken sample copy in `demo-data.ts` (L4)
- Add `DELETE /api/adstudio/campaigns/[id]` following the existing route's auth + RLS pattern (data delete only — no schema change, new shape, don't alter existing GET/PATCH responses)

**Accept:** Toolbar gone from Preview; new workspace shows a sample badge / first-run path, not a fake saved campaign; DELETE returns correctly and is RLS-guarded; `npm run test` (incl. adstudio-*) green.

---

## File-ownership matrix (guarantees non-overlap)

| File (post-Wave 0) | Owner | Wave |
|---|---|---|
| `topbar.tsx` | D | 1 |
| `variant-strip.tsx` | D | 1 |
| `inspector.tsx` (shell, Variants/Edit) | D | 1 |
| `panels/landing/audience/settings-panel.tsx` | D | 1 |
| `panels/brand-panel.tsx`, `use-brand-kit.ts` | A | 1 |
| `panels/copy-panel.tsx`, `copy-fields.tsx`, `use-copy.ts`, `use-readiness.ts`, `inspector/readiness-card.tsx` | B | 1 |
| `panels/media-panel.tsx`, `use-media.ts`, `preview.tsx` | C | 1 |
| `api/adstudio/campaigns/[id]/route.ts`, `page.tsx`, `demo-data.ts`, toolbar config | E | 1 |
| `ad-studio-workbench.tsx` (composition), `use-ad-studio.ts` (core), `panels/campaign-panel.tsx`, `inspector/publish-panel.tsx` | Integrator | 0 setup / 2 |
| `styles.ts` | Integrator (append-only `/* stream X */` blocks from others) | 0/2/3 |

**Shared-CSS rule:** Wave-1 agents needing a new class append it in a clearly-commented `/* A: brand */` block at the end of `styles.ts` or use an inline `style={}` for one-offs; the Integrator reconciles in Wave 2.

---

## Wave 2 — Integrator + flow/IA  ·  fixes M1–M7, H9 remainder, L3, L5

Starts after all Wave-1 branches merge and `npm run check` is green.

- **M1** — Rename manual action to Export everywhere; reserve Publish for the gated live flow. Surface the real readiness via `GET /api/adstudio/publish-readiness`.
- **M2** — Collapse the three Publish entry points and the redundant Generate triggers.
- **M3** — Remove the `setSection("angles")` side effect; keep the user where they are.
- **M4** — Map the Campaign-goal select to the generated goal/angle instead of the hard-coded `selectedAngleId`.
- **M5** — One source of truth for variant label and preview headline.
- **M6** — Per-section completion ticks on the rail, fed by B's `use-readiness`.
- **M7** — Empty/loading states across panels (uses E's `isSample`).
- **H9 remainder + Delete wiring:** Wire Delete campaign (with a confirm) and finish Edit campaign brief.
- **★ Build features (parallelizable F1–F3):** Share-for-review link, Send-for-approval flow, "View all recommendations" panel, onboarding/empty first-run.
- **Polish folded in:** inspector text truncation (L3), save-state feedback (L5), reconcile `styles.ts`.

**Accept:** Publish vs Export is unambiguous; Generate stays in place and respects the goal; rail shows progress; every remaining button works; `npm run check` + `npm run test:e2e` green; Preview verified.

---

## Wave 3 — QA & polish  ·  fixes C5, residual L-items

Full regression walkthrough on the Vercel Preview URL — re-run the original review checklist. Fix C5 (landing scroll→/login). Accessibility, responsive/mobile pass, final visual polish. Confirm each PR reported the AGENTS.md Code-Reduction metrics.

---

## Issue → owner → wave

| Issue | Owner | Wave | Issue | Owner | Wave |
|---|---|---|---|---|---|
| C1 brand read-only | A | 1 | H8 Feed=Square | C | 1 |
| C2 menu won't close | D | 1 | H9 dead buttons | D + Integrator | 1/2 |
| C3 Vercel toolbar | Architect/E | 0/1 | M1 Publish≠publish | Integrator | 2 |
| C4 fake new-user data | E | 1 | M2 dup entry points | Integrator | 2 |
| C5 scroll→/login | QA | 3 | M3 Generate teleports | Integrator | 2 |
| H1 copy chips dead | B | 1 | M4 goal ignored | Integrator | 2 |
| H2 assist half-built | B | 1 | M5 variant label/preview | Integrator | 2 |
| H3 fake score | B | 1 | M6 no nav progress | Integrator | 2 |
| H4 amber-forever items | B | 1 | M7 no empty states | E + Integrator | 1/2 |
| H5 over-limit no warn | B | 1 | M8 brand preview sloppy | A | 1 |
| H6 media not selectable | C | 1 | L1 dead config | Architect | 0 |
| H7 Preview misleads | D | 1 | L2 fake breadcrumb | D | 1 |
| — | — | — | L3 text truncation | Integrator | 2 |
| — | — | — | L4 broken sample copy | E | 1 |
| — | — | — | L5 weak save feedback | Integrator | 2 |
| — | — | — | L6 zustand warning | Architect | 0 |

---

## Integration protocol

- **Worktrees:** one per agent — `git worktree add ../bw-<stream> -b simplification/adstudio-<stream>`
- **Merge order:** Wave 0 merges first; everyone rebases onto it. Then A→B→C→D→E in any order (disjoint files ⇒ no conflicts); orchestrator runs `npm run check` after each. Then Integrator branches from updated main, lands Wave 2; then QA.
- **Conflict policy:** edit only files you own; `styles.ts` is append-only per the Shared-CSS rule.
- **Gates:** every PR → `npm run check` (+ test:e2e if touching publish/research) + a verified Vercel Preview.
- **PRs:** reference issue IDs; tag `simplification` for Waves 1–3; include the AGENTS.md metrics block. No deploys to production without the user's explicit approval.
