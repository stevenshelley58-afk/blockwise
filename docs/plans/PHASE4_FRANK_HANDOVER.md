# Phase 4 Handover — Frank Iterative Template Factory

**For:** Frank agent working in `C:\Dev\Frank`
**Date:** 2026-08-12
**Blocks on:** Blockwise Phase 1-3 (complete, SHA `42e9e962` on `codex/adstudio-clean-rebuild`)

## What Frank must build

A private VPS service that accepts one source ad and produces signed, immutable `TemplatePack` objects consumable by Blockwise's importer.

### 4.1 Common intake

Frank accepts one source ad and records:
- Private source location (S3/SeaweedFS path)
- Creative ID or file ID
- SHA-256 hash
- AI ad-radar classification
- Source aspect ratio
- Declared customer image inputs (extracted by vision)
- Declared editable text inputs (extracted by vision)
- Protected/baked elements (regions that must not be altered)

Vision extracts ONLY what is visible — never invents new customer fields.

### 4.2 Versioned AI requests

Store prompt version, payload, model route, output, and cost for each iteration.

Three request types:
1. **Extract** — vision extracts customer inputs and layer candidates from the source image
2. **Build** — AI returns structured layer operations (not a finished ad image)
3. **Review** — AI scores the candidate render against the source

### 4.3 Cost-efficient model escalation

- Run deterministic checks first (zero AI cost)
- Run cheapest capable multimodal reviewer
- If passes with high confidence, run second independent cheap review
- Accept when both cheap reviewers pass
- If they disagree, escalate only disputed defects to middle tier
- If same defect survives 2 correction attempts, escalate that defect to strong tier
- Never rerun expensive full review for unrelated minor defect
- Maximum 8 correction iterations per placement
- On exhaustion, reject/quarantine — never lower the gate

### 4.4 Source-aspect loop

Optimizes pixel/region similarity, visual hierarchy, text placement, image-slot geometry, overlay alignment, protected pixels, brand/style character.

Masked image generation ONLY for declared plate or overlay regions — never repaints the whole ad.

### 4.5 Alternate-aspect redesign loop

Separate job and separate history. Creates native composition for the other ratio. Reviewed for style continuity, hierarchy, balance, legibility, vertical space use, safe zones, shared content keys. No mechanical crop or stretch.

### 4.6 Automated stress QA

Before packaging, both placements must pass:
- Longest allowed text, one-character text
- Portrait, landscape, square photos
- Minimum accepted image dimensions
- Extreme permitted crop positions
- Template colours, Brand Pack colours
- Missing Brand Pack roles
- Contrast checks, font loading, safe zones
- Source identity leakage
- Deterministic rerender hash
- No private asset references

### Phase 4 gate

Frank can emit a pack only when:
- Feed passes its independent loop
- Story passes its independent loop  
- Both share the same content keys
- All stress fixtures pass
- Two cheap reviewers agree (or stronger reviewer resolves)
- No human approval field exists
- Pack signing succeeds

## Shared contracts (already built)

Frank must import from Blockwise's published packages:

```
@blockwise/ad-template-pack-contract  — types, schemas, canonical hashing
@blockwise/ad-deterministic-renderer  — renderPlacement(), renderBoth()
```

These live at:
- Blockwise repo: `codex/adstudio-clean-rebuild` branch
- Package paths: `packages/ad-template-pack-contract/`, `packages/ad-deterministic-renderer/`

Frank's `frank/template-factory/package.json` already has file: deps on both.

## Product laws (mandatory)

- Frank OWNS source ads, AI prompts, iteration history, rejected candidates, model credentials
- Blockwise NEVER receives the private source ad, failed candidates, or generation prompts
- Story is a redesign task — not a crop, stretch, or automatic extension of Feed
- No human template review — automated QA either approves or rejects/quarantines

## Existing Frank foundation

The Frank service shell exists at `frank/template-factory/` with:
- Express server, health endpoint, pack CRUD stubs
- Auth middleware, env-driven config
- Docker Compose + Dockerfile under `infra/frank/`

## Starting point

```bash
# In Frank repo:
git fetch origin
git worktree add .worktrees/adstudio-phase4 codex/adstudio-phase4
cd .worktrees/adstudio-phase4

# Copy the contract + renderer packages from Blockwise:
cp -r /c/Dev/Blockwise/.worktrees/adstudio-clean-rebuild/packages/ packages/

# Copy the Frank service shell:
cp -r /c/Dev/Blockwise/.worktrees/adstudio-clean-rebuild/frank/ frank/
cp -r /c/Dev/Blockwise/.worktrees/adstudio-clean-rebuild/infra/frank/ infra/frank/

# Install and verify:
cd frank/template-factory && pnpm install && pnpm run typecheck
```
