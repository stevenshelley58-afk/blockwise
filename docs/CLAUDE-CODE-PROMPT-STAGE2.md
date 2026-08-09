# Claude Code prompt — Blockwise Premium v2 rebuild (Stage 2: Ad Studio)

Copy everything below the line into Claude Code, run from the repo root.

---

Rebuild Ad Studio to the approved **Premium v2** mockup. This is Stage 2 of the rebuild that Stage 1 (`docs/CLAUDE-CODE-PROMPT.md`) started — **it is the same app**. Stage 1 created the shared foundation: the token bridge v2, `src/lib/motion.ts`, `src/config/niche/`, refreshed shadcn primitives, and the shared settings section components under `src/components/settings/`. Build on those. If Stage 1 (or any phase of it) is not merged yet, branch from its branch — do not re-implement anything it owns.

## The one-app rule (read this twice)

Extend, never duplicate. Before writing any new module, check whether an owner already exists and use it:

- **Theming/tokens** → `src/app/tailwind.css` bridge (extend with studio sidebar values; never a second token system)
- **Motion** → `src/lib/motion.ts` (add studio-specific presets there if truly needed)
- **Copy/nouns** → `src/config/niche/` (all studio copy moves here, same as every other surface)
- **UI primitives** → `src/components/ui/*` + already-installed registry/motion-primitives/Magic UI components
- **Settings** → mount the Stage 1 shared section components; zero forked settings logic (details below)
- **Generation pipeline** → `buildCloneImageRequest` and the existing `src/lib/adstudio/*` modules (`clone-generation.ts`, `clone-creative.ts`, `clone-campaign.ts`, `clone-regions.ts`, `reference-clone.ts`, `template-resolver.ts`, `templates.ts`, `template-preview.ts`, `template-gallery/`)
- **Magic Layers** → `src/lib/adstudio/text-layers.ts` + `src/app/api/adstudio/creatives/[id]/layers/` (the derived-editing-layers system just built — connect to it, do not rebuild it)
- **Publishing** → `src/lib/publishing/*`
- **Data** → existing Supabase tables/RPCs; no schema changes without a tested migration, per AGENTS.md

Old studio components that the new surfaces replace get deleted in the final phase — no dangling parallel routes or dead components ("delete > simplify > abstract").

## Read these first, in order

1. `AGENTS.md` — binding. The AdStudio template process (one pipeline through `buildCloneImageRequest`, no alternate generators, verify gates never weakened) and the mandatory `$impeccable` UI workflow both apply to every phase here.
2. `hermes/skills/adstudio-template-builder/SKILL.md` — the template process in full.
3. `mockups/adstudio-mockup.html` — the approved target. Open it in a browser at desktop and ~390px. Click through everything: Create's three entry points, the template flow (Browse → photos → brand vs template colours → generate), Edit (editor left, pixel-true Meta/IG preview right, live copy binding, AI rewrite chips, connected image editor), Library (Ads/Assets/Listings), Publish (review → live, statuses flipping everywhere), Settings (synced), the black rail with the Blockwise button home, and the mobile tab bar.
4. `docs/REBUILD-PLAN.md` + `docs/CLAUDE-CODE-PROMPT.md` — what Stage 1 built and the standing decisions (component sourcing, motion rules, config rules). All still binding.
5. Current studio code: `src/app/(customer)/ad-studio/**`, `src/components/adstudio/**`, `src/lib/adstudio/**` — map what exists before changing anything.

## Information architecture (per the approved mockup)

**Shell.** Ad Studio gets a distinct near-black rail so users always know they're in the studio — build it as a dark variant of the existing shadcn sidebar (override the `--ui-sidebar-*` bridge values under a studio scope; not a new nav component). Rail items: Create, Edit, Library, Publish (with a ready-count badge), Settings; footer: Meta connection status + a **Blockwise button that returns to `/self-serve`**. Mobile: black studio topbar with a Home button, and a 5-tab bottom bar (Create, Edit, Library, Publish, Settings) matching the Stage 1 tab bar pattern.

**Mobile density rule (owner requirement):** on a phone, **Create must fit one screen with zero scrolling** — the three entry points render as compact tappable rows (icon, title, one-line clamped description, chevron; the whole row is the tap target) and recents as compact rows, exactly as the mockup's mobile layout shows. Hold the same instinct across the studio: no mobile screen wastes height on desktop-sized cards.

**Create.** Three entry points, all ending in the same pipeline:
- *From a listing* — address/listing picker → brand pack + listing photos through `buildCloneImageRequest`.
- *From a template* — template browser fed by `template-gallery/` → "Make it yours" step: photo upload + a **colour choice: "Your brand colours" vs "Template colours"** (this choice parameterizes the clone request; per the mockup it's a radio pair with swatch previews) → generate.
- *From Ad Radar* — a picked Radar ad enters the standard template-creation process (source ad → extract inputs → safe sample via clone) and then behaves like any other template. Same generator, same QA — AGENTS.md allows no second path.
- "Pick up where you left off" row of recent drafts.

**Edit.** Opens the most recently edited ad by default. Editor column on the LEFT, preview on the RIGHT:
- Copy card: headline / primary text / CTA, all **live-bound to the preview**, with an AI rewrite row (Punchier / Shorter / More local / Urgency) using the existing AI/content-engine infra.
- **Magic Layers connection:** on-image text edits go through `text-layers.ts` + the `creatives/[id]/layers` endpoint — browser re-typesets the exact copy over the plate crop, server clamps the patch to the region. Surface layer state honestly in the UI: a "Magic Layers · live" indicator when layers are valid (text edits apply instantly), and an explicit re-rendering state when layers are stale and the image-model fallback runs. Never imply an instant edit that's actually a full re-render.
- Image card: Replace image (asset picker from Library assets) and **Edit image** (prompt-based image-model edit anchored on the latest finished ad, per the pipeline rules). Version indicator (v1 → v2 · edited).
- Preview: **pixel-true Meta units** — Feed (sponsored header, primary text, creative, link bar with domain/headline/description/CTA, Like-Comment-Share row) and Story (progress bars, sponsored header, swipe-up CTA pill), toggled with a segmented control.
- Toolbar: ad name + status chip, "Library — open another ad", and Publish (routes to the Publish section carrying this ad).

**Library.** Three tabs: **Ads** (all campaigns/creatives with status chips and Edit actions), **Assets** (logo, uploaded photos, upload tile), **Listings** (address cards with Create-ad actions). This is the single browse surface; Edit's "open another ad" lands here.

**Publish.** A real section, not a modal: "Ready to go live" (drafts that passed QA — honest per-format checks from real pipeline state, destination select, publish via the existing publishing lib) and "Live now" (running ads with basic performance). Publishing updates status everywhere it appears — Edit chip, Library chip, rail badge — one state, many views. The Review checklist must reflect actual generation/QA/export state; never green-tick anything that isn't.

**Settings.** Mounts the SAME section components Stage 1 extracted (brand pack, Meta connection, defaults) with a visible "Synced with Settings" affordance and a link to workspace Settings for everything else. An edit in studio Settings **is** an edit in workspace Settings because it's the same component + server action. If Stage 1's refactor isn't merged yet, do that refactor first as its own PR — do not fork.

## Execution order (one PR per phase, same acceptance as Stage 1)

1. **Studio shell** — dark-rail variant of the shared sidebar, routes (`/ad-studio`, `/ad-studio/library`, `/ad-studio/publish`, `/ad-studio/settings`, edit route per existing structure), mobile topbar + 5-tab bar, Blockwise-home button, copy → config.
2. **Create + template flow** — three entry cards, template browser + "Make it yours" (photos, brand/template colours), Ad Radar → template path, recents row.
3. **Edit** — layout swap, live copy binding, AI rewrite actions, Magic Layers wiring + state surfacing, connected image editor, pixel-true Feed/Story previews.
4. **Library** — Ads/Assets/Listings on real data, empty states.
5. **Publish** — ready queue + live list on real pipeline/publishing state, status propagation.
6. **Settings mount + cleanup** — shared sections mounted; delete replaced legacy studio components/styles; final `$impeccable` audit desktop + 390px + 320px on Vercel Preview.
7. **Ship to production** — not done until it's live. Once all phases are green on Preview: merge to main and deploy to production via the normal Vercel path (pre-authorized by AGENTS.md for release work; log decisions in PR descriptions). Verify the PRODUCTION URL directly: create → edit → publish path on desktop and 390px (Create fitting one phone screen without scrolling), Magic Layers text edit and image-edit fallback behaving, template verify gates still green post-deploy. Report the production URL and exactly what was verified on it.

## Acceptance — every phase

- `npm run check` green; **`node scripts/verify/adstudio-templates.mjs` and `npm run verify:hard-reset` stay green and are never weakened or special-cased.**
- Runtime verification on Vercel Preview only, desktop AND mobile viewports.
- No new global CSS; everything through the token bridge; no parallel component/nav/token systems.
- No design-tool complexity or provider jargon exposed to users (PRODUCT.md): users see "Magic Layers" as instant text editing, not layers/plates/models.
- Report per AGENTS.md (skills, Impeccable commands, routes, viewports, remaining issues).

## Acceptance — end of Stage 2

- Every studio surface matches the approved mockup's structure and register; operator/monitor untouched.
- `grep -rn "listing\|suburb\|agent" src/app/\(customer\)/ad-studio src/components/adstudio` → only `niche.*` references and data-model identifiers.
- Zero duplicated logic between studio and workspace: settings sections, tokens, motion, config, publishing all single-source.
- Old studio UI components that were replaced are deleted, not orphaned.

Out of scope: template pipeline internals (`buildCloneImageRequest`, layers derivation, QA gates — consume, don't change), database schema, operator surfaces, marketing pages.
