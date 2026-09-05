# Frank Agent Handover — AdStudio Clean-Rebuild

**For:** Frank agent working in `C:\Dev\Frank`
**Date:** 2026-08-12
**Blockwise main:** `ee020d87` (merged)

## What Blockwise built

14 commits on `codex/adstudio-clean-rebuild` → merged to main:

- **Contracts** (`packages/ad-template-pack-contract/`): TemplatePack v1 types, AdDocument v1 types, Zod schemas, canonical JSON hashing. 13 tests.
- **Renderer** (`packages/ad-deterministic-renderer/`): Exact 1080×1350/1920 PNG output, layer rendering, deterministic hashing. 5 tests.
- **Importer** (`src/lib/adstudio/import-pack.ts`): Validates signed packs from Frank, idempotent replay, nonce tracking, atomic activation. DB migration at `supabase/migrations/20260812150000_ad_template_pack_import.sql`.
- **Persistence** (`src/lib/adstudio/save-ad.ts`): Save transaction with atomic two-render, revision tracking, unchanged detection. DB migration at `supabase/migrations/20260812160000_ad_customer_ads.sql`.
- **Instant Forms** (`src/lib/adstudio/instant-form-generator.ts`): AI form generator with deterministic validation, Meta policy enforcement.
- **Editor shell** (`src/components/adstudio/editor/`): Feed/Story tabs, undo/redo, layer selection, crop dialog.
- **Publish** (`src/lib/adstudio/publish-adapter.ts`): Paused-on-Meta model, snapshot freezing, validation.
- **Handover** (`docs/plans/PHASE4_FRANK_HANDOVER.md`): Detailed Phase 4 spec for Frank.

Blockwise is now in "waiting for Frank" state — `/ad-studio` shows a "being prepared" page. `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` in production.

## What Frank must build

### Phase 4 — Iterative Template Factory

Frank is a private VPS service. It accepts source ads, runs AI-driven extract/build/review loops, and emits signed TemplatePacks that Blockwise imports.

**Product laws:**
- Frank OWNS source ads, AI prompts, iteration history, rejected candidates, model credentials
- Blockwise NEVER receives private source ads, failed candidates, or generation prompts
- Every pack has Feed (1080×1350) AND Story (1080×1920) — Story is a redesign, not a crop
- No human template review — automated QA approves or rejects

**What to build:**

1. **Common intake** — accept one source ad, record SHA-256, AI ad-radar classification, aspect ratio
2. **Vision extraction** — extract customer image/text inputs visible in the ad (never invent fields)
3. **Source-aspect loop** — optimize pixel similarity, hierarchy, text placement, image-slot geometry, overlay alignment, protected pixels. Max 8 correction iterations.
4. **Alternate-aspect redesign loop** — separate job creating native composition for the other ratio. Reviewed for style continuity, balance, legibility, safe zones.
5. **Cost-efficient model escalation** — deterministic checks first (free), cheapest reviewer, escalate only disputed defects. Never rerun expensive full review for minor defects.
6. **Automated stress QA** — longest text, one-char text, portrait/landscape/square photos, min dimensions, extreme crops, colour variants, contrast, font loading, safe zones, source identity leak, deterministic rerender.
7. **Pack signing** — emit TemplatePack with manifest SHA-256 + Ed25519 signature. Send to Blockwise import endpoint.

**Phase 4 gate:** Feed passes independent loop, Story passes independent loop, shared content keys, all stress fixtures pass, two cheap reviewers agree, no human approval field, pack signing succeeds.

### Starting point

```bash
cd C:\Dev\Frank
git fetch origin
# Create a fresh worktree from Frank's main
git worktree add .worktrees/adstudio-phase4 main
cd .worktrees/adstudio-phase4

# Copy Blockwise contracts + renderer + Frank service shell
cp -r /c/Dev/Blockwise/packages/ packages/
cp -r /c/Dev/Blockwise/frank/ frank/
cp -r /c/Dev/Blockwise/infra/frank/ infra/frank/

# Install Frank deps
cd frank/template-factory && pnpm install && pnpm run typecheck
```

### Shared contracts (copy from Blockwise)

```
Blockwise: packages/ad-template-pack-contract/  →  Frank: packages/ad-template-pack-contract/
Blockwise: packages/ad-deterministic-renderer/  →  Frank: packages/ad-deterministic-renderer/
Blockwise: frank/template-factory/              →  Frank: frank/template-factory/
Blockwise: infra/frank/                         →  Frank: infra/frank/
```

### After Phase 4

When Frank can emit signed TemplatePacks:

1. Frank sends a real pack to Blockwise's import endpoint
2. Blockwise validates, renders canaries, activates
3. Customer can select the template in the editor
4. Full E2E test: create → crop → edit → Save → Publish → PAUSED → Activate → Lead sync

### Questions?

The detailed Phase 4 spec is in Blockwise at `docs/plans/PHASE4_FRANK_HANDOVER.md`.
Blockwise contracts are at `codex/adstudio-clean-rebuild` (now merged to main at `ee020d87`).
