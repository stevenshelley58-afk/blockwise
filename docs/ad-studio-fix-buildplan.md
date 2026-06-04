# Ad Studio Fix — Multi-Agent Build Plan (for Claude Code / Sonnet)

**Companion to:** `docs/ad-studio-ux-review.md` (the findings) and `docs/ad-studio-ux-review.html`.
**Audience:** A Claude Code orchestrator spawning parallel Sonnet sub-agents.
**Goal:** Fix the 28 reviewed issues with **maximum safe parallelism** and **zero stepping on each other**, while obeying `AGENTS.md`.

---

## How to use this document

1. The **orchestrator** reads this file, then spawns one agent per *stream* below, each in **its own git worktree** (the repo already uses `.claude/worktrees/`).
2. Work happens in **waves**. A wave only starts when the previous wave's gate is green (`npm run check`).
3. Every agent obeys the **Ground rules** and validates against its **acceptance criteria** before opening a PR.
4. The orchestrator merges in the **merge order** given, runs the full gate, and triggers a Vercel Preview for QA.

Ready-to-paste kickoff prompts for each agent are in the final section.

---

## Ground rules (every agent, every wave) — derived from `AGENTS.md`

**Preflight (do this first, always)**
- Check CodeGraph freshness: MCP `codegraph_status` (or `codegraph status`); if missing `codegraph init -i`; if stale `codegraph sync`. If a stale-file banner appears, read that file before editing.
- Read `AGENTS.md`, `CONTEXT.md` (if present) and `docs/adr/` before touching code.
- Confirm you are in **your own worktree/branch**, not `main`.

**PR mode (tag correctly)**
- **Refactor PR** (Wave 0): pure cleanup. **Net production LOC must decrease**, behaviour preserved, **no UI redesign**. Report the Code-Reduction metrics block.
- **Simplification PR** (Waves 1–3): UI changes that remove user-facing complexity. Tag the PR **`simplification`** and state which user-facing complexity it removes. LOC may rise but must be justified.

**Hard rules (never break)**
- ❌ No new dependencies (we have `next 16`, `react 19`, `lucide-react`, `recharts`, `zod`, `@supabase/*` — use only these).
- ❌ No DB schema changes. ❌ No changes to existing public API **response shapes**. ❌ No auth/provider behaviour changes.
- ❌ No new generic helpers/managers/factories/interfaces unless they collapse real duplication.
- ❌ Don't "replace one messy file with five messy files" — extractions must be **cohesive, single-responsibility** modules (see Wave 0).

**Validation (per `AGENTS.md` "Deployment and Testing")**
- Gate locally with `npm run typecheck` and `npm run test` (Node's test runner). Touching the publish/research flows: also `npm run test:e2e`.
- **Do not run local deployments and do not use localhost as acceptance.** Validate runtime behaviour on the **Vercel Preview URL** for your branch (use the Vercel MCP/CLI to find it; drive it with the browser tools).
- Prefer the GitHub/Vercel/Supabase **MCP or CLI** over scraping/ad-hoc calls.

**Definition of done (per PR)**
- `npm run check` green · relevant e2e green · Vercel Preview manually verified · metrics block filled in · no forbidden changes · issue IDs referenced in the PR description.

---

## The coordination problem (read this before splitting work)

**~90% of the UI lives in one file:** `src/components/adstudio/ad-studio-workbench.tsx` — **1,762 lines** holding the top bar, all nine setup panels, the preview renderer, the inspector and a giant `STYLES` string. If five agents edit it at once, every PR collides.

**Strategy — extract once, then parallelize:**

```
Wave 0  (1 agent, SEQUENTIAL)  → create clean file seams + delete dead code        [Refactor PR]
Wave 1  (5 agents, PARALLEL)   → each owns separate files; wire UI ↔ existing APIs  [Simplification PRs]
Wave 2  (1–2 agents)           → flow/IA across the composition root + new endpoint [Simplification PRs]
Wave 3  (1 agent)              → polish, full QA, Vercel Preview walkthrough
```

The extraction in Wave 0 is **explicitly allowed** by `AGENTS.md` ("Preferred Refactor Order #4: simplify oversized files", and the tracked "largest file" metric) **as long as the modules are cohesive** — not a messy sprawl. We pair it with dead-code deletion (#1) so net LOC drops, keeping it a valid Refactor PR.

> **Low-refactor fallback** (if you'd rather not extract yet): keep the monolith and give it a **single owner** who works two sequential sub-waves, while Wave-1 Agent E (backend/config/page) and the new-feature builds proceed fully in parallel. You lose UI parallelism but avoid the refactor. The rest of this plan assumes the recommended extract-first path.

---

## Wave 0 — "Architect" agent (sequential, blocks everything)

**Mode:** Refactor PR (behaviour-preserving). **Branch:** `refactor/adstudio-modularize`.

**Mission:** Carve the monolith into cohesive modules and feature-hooks so Wave-1 agents own disjoint files, and delete dead code so net LOC falls. **No behaviour change, no visual change.**

**Tasks**
1. **Trust/config quick win first** (so Preview QA is clean for everyone): disable the **Vercel Toolbar / Live feedback** on production (issue C3). Check for a code/config path (`@vercel/toolbar` import, `vercel.json`, a layout-level mount); if it's purely a dashboard setting, document the exact toggle for the user and proceed. Remove the resulting `zustand` console warning (L6) if it originates in-repo.
2. **Extract** `ad-studio-workbench.tsx` into a thin composition root plus cohesive files:
   - `src/components/adstudio/topbar.tsx` (top bar + overflow menu)
   - `src/components/adstudio/panels/{campaign,brand,media,copy,audience,landing,publish,settings}-panel.tsx` (split the `PanelContent` switch)
   - `src/components/adstudio/preview.tsx` (`PreviewControls`, `AdPreview`, `Segmented`)
   - `src/components/adstudio/inspector.tsx` (`Inspector`, `ReadinessCard`, `PublishPanel`, `VariantStrip`, `CopyFields`)
   - `src/components/adstudio/styles.ts` (the `STYLES` constant)
   - **Feature hooks** so handler logic doesn't collide later:
     `use-ad-studio.ts` (core: section/tab/pack/toast/save) · `use-brand-kit.ts` · `use-copy.ts` · `use-readiness.ts` · `use-media.ts`. Wave 0 defines their **interfaces** and moves the *existing* logic in unchanged.
3. **Delete dead code** while moving (counts toward the LOC decrease): unused `FORMAT_META.kind`/`imageClass` and the non-existent `*-frame` class names (L1), any unused imports, and clearly-dead stubs.
4. Keep `STYLES` intact (visual parity). Run `npm run check` — must stay green with identical behaviour.

**Acceptance:** behaviour + pixels unchanged; `npm run typecheck` + `npm run test` green; largest-file LOC down sharply; net production LOC down; metrics block reported. **Merge before Wave 1 starts.**

**Why this unblocks parallelism:** after this, each Wave-1 agent edits its **own** panel/hook file; the only shared file (`ad-studio-workbench.tsx` composition root + `use-ad-studio.ts` core) is owned by the Integrator.

---

## Wave 1 — five parallel agents (all `simplification` PRs)

Each agent works in its own worktree, owns disjoint files, and may **read** (never edit) others. Branch names: `simplification/adstudio-<stream>`.

### 🅰 Agent A — Brand pack  ·  fixes **C1, M8**
- **Owns:** `panels/brand-panel.tsx`, `use-brand-kit.ts`
- **Reads:** `lib/adstudio/persistence.ts`, `lib/adstudio/types.ts`
- **Do:** Make the brand fields **editable** (lift `brandKit` into `use-brand-kit` state). Add three actions: **Re-scan website** → `POST /api/adstudio/brand-kits/[id]/rescan`; **Save** → `PATCH /api/adstudio/brand-kits/[id]`; **Approve kit** → `POST /api/adstudio/brand-kits/[id]/approve`. Format the phone (`(08) 9999 0000`), give the preview card spacing, and source/label **Agent** distinctly from **Agency** (M8). Use existing request/response shapes only.
- **Accept:** On the Preview URL you can edit a field, Save, see it persist on reload; Re-scan repopulates; Approve flips status; preview + readiness reflect changes.

### 🅱 Agent B — Copy & readiness  ·  fixes **H1, H2, H3, H4, H5**
- **Owns:** `panels/copy-panel.tsx`, `copy-fields.tsx`, `use-copy.ts`, `use-readiness.ts`, `inspector/readiness-card.tsx`
- **Reads:** `lib/adstudio/platform-rules.ts` (Meta limits), `lib/adstudio/scoring.ts`
- **Do:** Wire the Copy-panel assist row to `applyCopyAssist` (H1) and **implement all six labels** in `use-copy` — give *Make sharper / Make more premium / Generate 5 hooks* real behaviour instead of the `?`-append fallback (H2). Compute the readiness **score from the items** so it can reach 100% (H3). Give "Ad copy" & "Call to action" a real **`done`** path (within limits / CTA chosen) instead of permanent `warn` (H4). In `copy-fields`, turn the counter **red + warn** when `length > COPY_LIMITS[key]`, and surface that in readiness (H5).
- **Accept:** All six chips change copy in both Copy panel and Inspector→Edit; score moves with real progress and hits 100% when complete; over-limit text is visibly flagged.

### 🅲 Agent C — Media & preview  ·  fixes **H6, H8** (and consumes L1 from Wave 0)
- **Owns:** `panels/media-panel.tsx`, `use-media.ts`, `preview.tsx`
- **Reads:** `use-ad-studio.ts` (core, for `primaryImage`)
- **Do:** Make library tiles **selectable** → `setPrimaryImage(asset.src)` updates the active state and the preview (H6); optionally add "Generate image" → `POST /api/adstudio/generate-image`. Make **Square** a genuine 1:1 layout distinct from the 4:5 feed, **or** remove the redundant tab and keep three formats (H8). Export `AdPreview` cleanly so the Preview modal (Agent D) can reuse it.
- **Accept:** Clicking any library tile changes the preview image; Feed and Square are visibly different (or Square is gone); no dead `FORMAT_META` fields remain.

### 🅳 Agent D — Top bar, menus & variant actions  ·  fixes **C2, H7, H9 (existing-endpoint subset), L2**
- **Owns:** `topbar.tsx`, `variant-strip.tsx`, `inspector.tsx` (tab shell + Variants/Edit tabs), `panels/landing-panel.tsx`, `panels/audience-panel.tsx`, `panels/settings-panel.tsx`
- **Reads:** `preview.tsx` (for the Preview modal), `use-ad-studio.ts`
- **Do:** Add outside-click + Escape dismissal to the "…" menu (C2). Make **Preview** open a real full-size/device-frame modal reusing `AdPreview` — or remove it (H7). Wire the controls that already have endpoints (H9): **Duplicate campaign** → `POST /campaigns/[id]/duplicate`; **Archive** → `PATCH /campaigns/[id]`; variant **Regenerate** → `POST /campaigns/[id]/generate`; **Add variant** → generate +1; **View all** → switch inspector to Variants; **Test landing page** → open `destinationUrl` in a new tab. Make the breadcrumb a real menu or drop its chevron (L2). *(Delete / Share / Send-for-approval wait for Wave 2 — see below.)*
- **Accept:** Menu closes on outside-click/Escape; every wired button performs its action against the Preview URL; no `<button>` in your files lacks an `onClick` (or is intentionally removed).

### 🅴 Agent E — Backend, data & config  ·  fixes **C3, C4, L4** + new endpoint
- **Owns:** `app/api/adstudio/campaigns/[id]/route.ts` (add `DELETE`), `app/(customer)/ad-studio/page.tsx`, `lib/adstudio/demo-data.ts`, Vercel/toolbar config
- **Reads:** `lib/adstudio/persistence.ts`, RLS policies in `supabase/`
- **Do:** If Wave 0 didn't fully kill the Vercel Toolbar, finish it (C3). In `page.tsx`, branch on `liveBundle === null`: pass an `isSample` flag so the UI can badge demo data / route to onboarding instead of presenting it as real (C4). Rewrite the broken sample copy in `demo-data.ts` (L4). Add **`DELETE /api/adstudio/campaigns/[id]`** following the existing route's auth + RLS pattern (data delete only — **no schema change**, **new** shape, don't alter existing GET/PATCH responses).
- **Accept:** Toolbar gone from Preview; new workspace shows a sample badge / first-run path, not a fake saved campaign; `DELETE` returns correctly and is RLS-guarded; `npm run test` (incl. `adstudio-*`) green.

> **Note on M7 (empty states):** E supplies the `isSample`/empty signal; the per-panel "nothing here yet" rendering is folded into Wave 2 so it lands in one coherent pass rather than three half-versions.

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
| `ad-studio-workbench.tsx` (composition), `use-ad-studio.ts` (core), `panels/campaign-panel.tsx`, `inspector/publish-panel.tsx` | **Integrator** | 0 setup / 2 |
| `styles.ts` | **Integrator** (append-only `/* stream X */` blocks from others) | 0/2/3 |

**Shared-CSS rule:** the app uses one `STYLES` string, not Tailwind. Wave-1 agents needing a new class append it in a clearly-commented `/* A: brand */` block at the end of `styles.ts` **or** use an inline `style={}` for one-offs; the Integrator reconciles in Wave 2. This keeps `styles.ts` conflict-free.

---

## Wave 2 — Integrator + flow/IA  ·  fixes **M1–M7, H9 remainder, L3, L5**

Starts after **all** Wave-1 branches merge and `npm run check` is green. The Integrator owns the composition root and core hook; the new-feature builds (★) can run as **parallel sub-agents** (F1–F3) because they're separate components.

- **M1 — Publish ≠ Export.** Rename the manual action to **Export** everywhere; reserve **Publish** for the gated live flow. Surface the real readiness via `GET /api/adstudio/publish-readiness` (show "Connect a Meta ad account", "Enable live publishing"…), and wire live publish to `POST /api/adstudio/export-packages/[id]/publish` (kept gated). `publish-panel.tsx`, `topbar.tsx`(button label via prop).
- **M2 — One trigger per action.** Collapse the three Publish entry points and the redundant Generate triggers; rail navigates, top bar acts, inspector inspects.
- **M3 — Don't teleport on Generate.** Remove the `setSection("angles")` side effect; keep the user where they are. (`use-ad-studio.ts`)
- **M4 — Goal drives generation.** Map the Campaign-goal select to the generated goal/angle instead of the hard-coded `selectedAngleId`. (`campaign-panel.tsx` + core)
- **M5 — Sync variant labels & preview.** One source of truth for variant label and preview headline. (`use-ad-studio.ts` variants memo)
- **M6 — Nav progress.** Per-section completion ticks on the rail, fed by B's `use-readiness`. Optionally present the core path as ordered steps.
- **M7 — Empty/loading states** across panels (uses E's `isSample`).
- **H9 remainder + Delete wiring:** now that E's `DELETE /campaigns/[id]` exists, wire **Delete campaign** (with a confirm) and finish **Edit campaign brief** (`campaign-panel.tsx`).
- **★ Build features (parallelizable F1–F3):** Share-for-review link, Send-for-approval flow (reuse `variants/[id]/approve`), "View all recommendations" panel, and the **onboarding/empty first-run** (the `(customer)/onboarding` route already exists). New components → low conflict.
- **Polish folded in:** inspector text truncation (L3), save-state feedback (L5), reconcile `styles.ts`.

**Accept:** Publish vs Export is unambiguous and the real readiness checklist shows; Generate stays in place and respects the goal; rail shows progress; every remaining button works; `npm run check` + `npm run test:e2e` green; Preview verified.

## Wave 3 — QA & polish (1 agent)  ·  fixes **C5, residual L-items**

- Full **regression walkthrough on the Vercel Preview URL** using the browser tools — re-run the original review checklist: menu dismiss, readiness moves & hits 100%, brand edit→save→reload, media select, copy limit warning, Publish vs Export, every former dead button.
- **C5 — landing scroll→`/login`:** reproduce **logged-out**, find root cause (suspect: a focused sign-in link activated by Space/PageDown, or a scroll handler), fix, verify.
- Accessibility (focus rings, `aria` on icon buttons), responsive/mobile pass, final visual polish.
- Confirm each PR reported the `AGENTS.md` Code-Reduction metrics and the largest file shrank.

---

## Issue → owner → wave (nothing dropped)

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

## Dependency / wave graph

```mermaid
flowchart LR
  W0["Wave 0 · Architect\nextract + delete dead code + toolbar\n(Refactor PR)"]
  A["A · Brand\nC1 M8"]; B["B · Copy+Readiness\nH1-H5"]; C["C · Media+Preview\nH6 H8"]; D["D · Topbar+Actions\nC2 H7 H9 L2"]; E["E · Backend+Data+Config\nC3 C4 L4 +DELETE"]
  I["Wave 2 · Integrator + F1-F3\nM1-M7, Delete wiring, builds"]
  Q["Wave 3 · QA\nregression + C5 + a11y"]
  W0 --> A & B & C & D
  W0 --> E
  A & B & C & D & E --> I --> Q
  classDef s fill:#eef4ff,stroke:#3b6fd1; classDef g fill:#e7f6ee,stroke:#1e8e54;
  class W0 g; class A,B,C,D,E,I s;
```

## Integration protocol

- **Worktrees:** one per agent — `git worktree add ../bw-<stream> -b simplification/adstudio-<stream>` (the repo already uses `.claude/worktrees/`). Wave 0 uses `refactor/adstudio-modularize`.
- **Merge order:** Wave 0 merges first; **everyone rebases onto it**. Then A→B→C→D→E in any order (disjoint files ⇒ no conflicts); orchestrator runs `npm run check` after each. Then Integrator branches from updated `main`, lands Wave 2; then QA.
- **Conflict policy:** edit only files you own; `styles.ts` is append-only per the Shared-CSS rule. If you believe you need someone else's file, **stop and escalate to the orchestrator** — don't edit it.
- **Gates:** every PR → `npm run check` (+ `test:e2e` if touching publish/research) + a verified **Vercel Preview**. Orchestrator re-runs the full gate after each merge and does a final Preview QA before `main`.
- **PRs:** reference issue IDs; tag `simplification` for Waves 1–3; include the `AGENTS.md` metrics block. **No deploys to production without the user's explicit approval.**

## Risks & mitigations

- **Wave 0 is a serial bottleneck.** Keep it behaviour-only and tight; if extraction feels risky, use the **low-refactor fallback** (single owner for the monolith, parallelize backend/builds only).
- **Core-hook contention.** Mitigated by per-feature hooks (`use-brand-kit`, `use-copy`, `use-readiness`, `use-media`) owned by single agents; only the core hook is the Integrator's.
- **Refactor LOC rule.** Wave 0 offsets extraction with dead-code deletion (target net-negative LOC); Waves 1–3 are `simplification` (exempt).
- **API-shape / schema / auth rules.** Agents only *consume* existing shapes; the new `DELETE` is additive and RLS-guarded; no schema edits.
- **No new dependencies.** Build the Preview modal / confirm dialog with existing React + the current `STYLES`, not a new UI lib.
- **Vercel toolbar may be dashboard-only.** If so, E documents the exact Settings → Toolbar toggle for the user rather than forcing a code change.

---

## Ready-to-paste kickoff prompts

Each agent's first move is the **Preflight** (CodeGraph check + read `AGENTS.md`, `CONTEXT.md`, `docs/adr/`, plus `docs/ad-studio-ux-review.md` and this file). Spawn Wave 0 alone; spawn A–E together once it merges.

**Wave 0 — Architect**
```
Read docs/ad-studio-fix-buildplan.md (Wave 0) and ad-studio-ux-review.md, then do Preflight.
On branch refactor/adstudio-modularize, extract src/components/adstudio/ad-studio-workbench.tsx into the cohesive modules + feature hooks listed in Wave 0, move existing logic UNCHANGED, and delete the dead code (FORMAT_META.kind/imageClass, dead *-frame classes, unused imports). Also disable/neutralise the Vercel Live toolbar (C3/L6) or document the exact dashboard toggle.
This is a Refactor PR: behaviour + pixels identical, net production LOC must DROP. Gate with `npm run check`. Report the AGENTS.md metrics block. Do not start any behaviour fixes.
```

**Wave 1 — Agent A (Brand)**
```
Preflight. Branch simplification/adstudio-brand. You OWN only panels/brand-panel.tsx and use-brand-kit.ts.
Fix C1 + M8: make the brand fields editable and wire Re-scan (POST /brand-kits/[id]/rescan), Save (PATCH /brand-kits/[id]), Approve (POST /brand-kits/[id]/approve); format phone, distinguish Agent vs Agency. Use existing API shapes only; no new deps. Gate `npm run check`; verify on the Vercel Preview URL. Tag PR `simplification`, reference C1/M8, include metrics.
```

**Wave 1 — Agent B (Copy & readiness)**
```
Preflight. Branch simplification/adstudio-copy. You OWN panels/copy-panel.tsx, copy-fields.tsx, use-copy.ts, use-readiness.ts, inspector/readiness-card.tsx.
Fix H1-H5: wire the Copy assist chips and implement all six labels; compute the readiness score from items (reaches 100%); give Ad copy/CTA a real done path; flag over-limit copy (red counter + warning) using Meta limits from lib/adstudio/platform-rules.ts. Gate `npm run check`; verify on Preview. Tag `simplification`, reference H1-H5, metrics.
```

**Wave 1 — Agent C (Media & preview)**
```
Preflight. Branch simplification/adstudio-media. You OWN panels/media-panel.tsx, use-media.ts, preview.tsx.
Fix H6 + H8: make library tiles selectable (setPrimaryImage updates preview); make Square a true 1:1 layout OR remove the redundant tab. Export AdPreview for reuse. No new deps. Gate `npm run check`; verify on Preview. Tag `simplification`, reference H6/H8, metrics.
```

**Wave 1 — Agent D (Top bar, menus, variant actions)**
```
Preflight. Branch simplification/adstudio-actions. You OWN topbar.tsx, variant-strip.tsx, inspector.tsx, panels/{landing,audience,settings}-panel.tsx.
Fix C2, H7, L2 and the existing-endpoint subset of H9: add outside-click+Escape dismissal to the … menu; make Preview a real modal (reuse AdPreview) or remove it; wire Duplicate (/campaigns/[id]/duplicate), Archive (PATCH /campaigns/[id]), variant Regenerate (/campaigns/[id]/generate), Add variant, View all, Test landing page; fix the breadcrumb. Leave Delete/Share/Approval for Wave 2. Gate `npm run check`; verify on Preview. Tag `simplification`, metrics.
```

**Wave 1 — Agent E (Backend, data, config)**
```
Preflight. Branch simplification/adstudio-backend. You OWN api/adstudio/campaigns/[id]/route.ts, app/(customer)/ad-studio/page.tsx, lib/adstudio/demo-data.ts, toolbar config.
Fix C3 (finish toolbar removal if needed), C4 (branch on liveBundle===null → pass isSample for a sample badge / first-run instead of presenting demo as real), L4 (rewrite broken sample copy), and ADD DELETE /api/adstudio/campaigns/[id] mirroring the existing auth+RLS pattern (data delete only, NO schema change, additive shape). Gate `npm run check` incl. adstudio-* tests; verify on Preview. Tag `simplification`, metrics.
```

**Wave 2 — Integrator (+ optional F1–F3 for the builds)**
```
Preflight. Branch from updated main after all Wave-1 merges are green. You OWN ad-studio-workbench.tsx, use-ad-studio.ts, panels/campaign-panel.tsx, inspector/publish-panel.tsx, styles.ts.
Fix M1-M7 + H9 remainder: split Export (manual) from Publish (live) and surface GET /publish-readiness + POST /export-packages/[id]/publish; dedupe entry points; remove the Generate→Angles teleport; make Campaign goal drive generation; sync variant label/preview; add rail progress ticks (from use-readiness); add empty/loading states; wire Delete (confirm) and Edit-brief. Optionally fan out Share/Approval/recommendations/onboarding to F1–F3 (new components). Gate `npm run check` + `npm run test:e2e`; verify on Preview. Tag `simplification`, metrics.
```

**Wave 3 — QA**
```
Preflight. Run npm run check + npm run test:e2e. On the Vercel Preview URL, re-run the review checklist in ad-studio-ux-review.md as a regression pass (menu dismiss, readiness hits 100%, brand edit→save→reload, media select, copy-limit warning, Publish vs Export, every former dead button). Reproduce + fix C5 (landing scroll→/login) logged-out. Do an a11y + mobile pass and finish residual L-items. Confirm every PR reported metrics and the largest file shrank.
```

---

*Scope note:* this plan covers all 28 reviewed issues. The only **net-new backend** is `DELETE /campaigns/[id]`; everything else consumes endpoints that already exist. The biggest judgment call is Wave 0 (extract-first vs the low-refactor fallback) — pick based on how much appetite there is for touching the monolith now.

