# Ad Studio — Flow & UI/UX Fix Plan

**Date:** 2026-06-04 · **Scope:** restore templates, fix labels, real AI copy flow, kill the cheap look
**Companion mockups:** `docs/ad-studio-mockups.html` (open in a browser)

---

## 1. Diagnosis (grounded in code)

| Complaint | Root cause | Where |
|---|---|---|
| Template section is gone | Templates still exist (10 in `templates.ts`) but only surface as plain text buttons inside the New Ad dialog. The visual angle-card panel was deleted in the current working tree (`panels/angles-panel.tsx` removed). | `src/lib/adstudio/templates.ts`, `src/components/adstudio/new-ad-dialog.tsx` |
| "Review" tab is wrong | Nav item is `{ id: "media", label: "Review" }` — the panel is a media library. Mobile nav repeats the mistake. Panel header says "Review ads". | `ad-studio-workbench.tsx:63`, `:72`; `panels/media-panel.tsx:19` |
| No idea how AI helps with copy | There is **no real AI in the studio**. Assist chips are hardcoded string transforms (with "South Perth" baked in). The generator emits `promptHint` strings and 5 hardcoded fallback messages. The real AI layer (`ai-providers.ts`: OpenAI/OpenRouter text + image, plus the full prompt library in `prompts/real_estate/`) is never called by the studio flow. | `use-copy.ts:70–97`, `lib/adstudio/generator.ts:40–73` |
| Looks cheap | Flat `#f7f8fa` + white boxes, identical 1px border + 8px radius on everything, no elevation, weight-700 text everywhere, dashed-border empty states, inline styles drifting from `styles.ts`, text-only template buttons. Reads as wireframe. | `styles.ts`, `panels/campaign-panel.tsx` (inline styles) |

---

## 2. Target flow

```
Create ad
  └─ Step 1 · TEMPLATE   visual gallery (10 existing templates + "Start blank")
  └─ Step 2 · MEDIA      upload or pick from library
  └─ Step 3 · COPY       choose one of three paths:
        ① AI copy        one click — model writes from template + brand kit + market
        ② From a brief   you describe the ad in plain words → AI drafts
        ③ Write your own manual fields, AI assist chips optional
  └─ Step 4 · REVIEW & PUBLISH   formats, compliance, export/launch

Left nav (workbench): Ad · Templates · Brand · Media · Copy · Audience · Publish · Settings
```

Templates live in **both** places: the gallery is step 1 of creation, and a `Templates` nav item lets you browse/manage them anytime (per decision 2026-06-04).

---

## 3. Workstream A — Quick wins (≤1 hr, ship first)

1. **Rename Review → Media.** `ad-studio-workbench.tsx:63` label → `"Media"`; mobile nav `:72` id/label → media; `media-panel.tsx:19` header → "Media" / "Your images and generated sizes."
2. **De-hardcode "South Perth"** out of assist transforms until real AI lands (use `market` prop).
3. **Move campaign-panel inline styles into `styles.ts`** (it's the only panel styled inline — part of the inconsistent feel).

## 4. Workstream B — Restore the template section

1. **Template gallery component** (`panels/templates-panel.tsx` + reuse inside `new-ad-dialog.tsx` step 1). Cards = rendered mini-preview (use `renderer.ts` SVG output at thumb size), template name, goal chip. No new deps.
2. **Add `Templates` to NAV_ITEMS** between Ad and Brand. Panel = same gallery + "Use template" action that starts the create flow with it preselected.
3. **Data:** `AD_STUDIO_TEMPLATES` is already the source of truth; later migrate to `adstudio_offer_templates` table (currently empty) so adding templates doesn't need a deploy. *(Schema work is a separate PR per AGENTS.md — no schema changes inside UI PRs.)*

## 5. Workstream C — Real AI copy, three explicit paths

1. **One endpoint:** `POST /api/adstudio/copy` with `{ mode: "ai" | "brief" | "assist", briefText?, assistAction?, field?, campaignContext }`. Internally calls `generateAdStudioText` (`ai-providers.ts`) with `prompts/real_estate/meta_copy.md`. Auth + workspace scoping same as existing adstudio routes.
2. **Copy panel mode switch** (segmented control, sticky at top):
   - **AI copy** — one button: "Write it for me". Generates headline / primary text / description (+2 alternates each, tap to swap). Shows what it used: template, brand voice, market.
   - **From a brief** — textarea ("Tell us about this ad…") → Generate. Brief is saved on the variant for regeneration.
   - **Write your own** — current manual fields; assist chips remain but now call the endpoint (`mode: "assist"`).
3. **Generator honesty:** `generator.ts` calls the same endpoint server-side for first-ad generation; fallback messages remain only as offline/demo fallback, clearly badged "Sample".
4. **States:** skeleton shimmer while generating, per-field regen icon, error toast with retry. Never silently no-op (the old broken-buttons sin).

## 6. Workstream D — Premium-light visual pass (kill the cheap)

Direction confirmed: **premium light** (decision 2026-06-04). One system, applied everywhere — no per-panel drift.

1. **Tokens** (extend existing `globals.css` vars, reuse `--accent #1f3a6e` family):
   - Type scale: 22/15/13.5/12 with weights 650/600/500 — stop using 700+ for body/labels.
   - Radius: 12 outer cards, 8 inner controls (one nesting rule, not 8px on everything).
   - Elevation: `--shadow-1` (cards) `0 1px 2px rgba(15,23,41,.05)`, `--shadow-2` (popovers) existing menu shadow. Borders go `--line-soft`; elevation does the separating.
   - Canvas: keep `#f7f8fa` but panels float on it as cards with 20–24px gutters instead of edge-to-edge borders.
2. **Nav rail:** active item gets `--accent-tint` pill + accent icon; section order matches flow (see §2).
3. **Buttons:** primary = accent fill; secondary = white + border; ghost = borderless. Kill the 44px-tall everything — 38px standard, 44 only for primary CTAs.
4. **Empty states:** replace dashed boxes with illustration-weight icon in accent-tint circle, 15px headline, one-line sub, primary button.
5. **Preview column:** dark neutral stage (`#10141c`) behind the phone frame so creatives pop — the single highest-impact "premium" move; format switcher as segmented control.
6. **Template/media cards:** real thumbnails, hover lift (`translateY(-1px)` + shadow-2), accent ring on selected (not black `box-shadow 0 0 0 1px #111`).

## 7. Sequencing & PR discipline (per AGENTS.md)

| PR | Contents | Tag | Risk |
|---|---|---|---|
| 1 | Workstream A (labels, de-hardcode, style consolidation) | `simplification` | none |
| 2 | D tokens + rail + buttons + empty states (no behaviour change) | `simplification` | low |
| 3 | B template gallery + nav item | `simplification` | low |
| 4 | C endpoint + copy panel modes | feature | medium — needs `BLOCKWISE_OPENAI_API_KEY`/OpenRouter env on Vercel |
| 5 | D preview stage + card polish | `simplification` | low |

Rules honoured: no new dependencies; no schema/API-contract/auth changes inside UI PRs (the copy endpoint is additive); validate with `npm run typecheck` + `npm run test` + Vercel Preview URL, not localhost; don't split one messy file into five messy files — panel changes stay in their existing modules.

**Pre-PR1 housekeeping:** the working tree has a large uncommitted adstudio changeset (the Zeely-session merge that crashed mid-resolution — including the deleted `angles-panel.tsx`). Commit or stash deliberately first so each PR diffs clean.

## 8. Acceptance checklist

- [ ] Nav reads Ad · Templates · Brand · Media · Copy · Audience · Publish · Settings (no "Review")
- [ ] Template gallery visible in nav AND as step 1 of Create ad, with visual thumbnails
- [ ] Copy panel offers AI / brief / write-your-own; AI path returns model-written copy using brand kit + market (verify network call, not string transform)
- [ ] Assist chips hit the endpoint; no hardcoded suburb strings remain (`grep -r "South Perth" src/components/adstudio` → only data, not logic)
- [ ] Visual: no dashed empty states, single radius rule, preview on dark stage, active-nav accent pill
- [ ] `npm run typecheck` + `npm run test` green; walkthrough on Vercel Preview
