# AdStudio v2 — Layered Templates, Deterministic Rendering, Konva Editor, Full Meta Publish

**Date:** 2026-08-04 · **Status:** Owner-approved direction (Steven, this doc supersedes the template law in `AGENTS.md`, `PRODUCT.md`, and `hermes/skills/adstudio-template-builder/SKILL.md` — Phase 0 rewrites those registers so build agents are not blocked by the old law.)
**Repo:** `github.com/stevenshelley58-afk/blockwise`, branch from `main` (`d023f5c9`). Local machine is on `codex/atlantic-design-system` — that branch is **not** merged and **not** part of this plan; do not build on it.

---

## 0. Verdict: can this be done?

**Yes — and most of the hard machinery already exists in the repo.** But "AI turns any sample into a pixel-exact editable copy, fully automatically, every time" is not honestly achievable by anyone. What IS achievable, and what this plan builds:

**The exactness guarantee, by construction, not by model behaviour:**
Every pixel that the customer does not explicitly replace stays the *original designer's pixels*. A template is decomposed **directly from the real source ad** into: a background **plate** (the source with text regions removed), **image slots** (customer photos drawn into declared boxes), **overlay patches** (original pixels that sit above photos — panels, borders, badges), and **text layers** (measured font/size/colour specs re-typeset with the exact copy). A mandatory Studio **restyle pass** (palette swap to safe colours, generic photos, safe copy — all deterministic) creates the public gallery sample and its distance from the source. Customer ads are then a *deterministic render* of that stack — **no image model ever paints a whole ad, at build time or runtime**. Nothing can drift, hallucinate, or "AI-slop" because nothing is generated. The hand-made craft is preserved because ~90% of the pixels literally *are* the source designer's work. (The system draws nothing: the schema has no shape/SVG layer type, deliberately.)

**The three honest limits (each has a designed escape hatch, not a silent degradation):**

1. **Replaced text is re-typeset, not the original lettering.** When copy changes, the original glyphs can't be kept — we render the new copy in the best-matched Google Font (corpus of ~1,905 families / ~7,527 faces, already built in `scripts/build/font-corpus/`). The fidelity gate re-renders the *source ad's own copy* and measures the residual against the real source; a region that can't get close enough is either (a) given a manually chosen font in the Template Studio, or (b) marked **baked** — its original pixels stay in the plate and that text is simply not editable. It is never shipped "approximately right" silently. Hand-lettering/script logos → always baked.
2. **Exotic text effects are bounded.** v1 text rendering supports: fill colour, weight/italic, case, letter-spacing, line-height, per-line size/horizontal scale, alignment, stroke (outline), drop shadow, and linear-gradient fill. Curved/warped/texture-filled text → baked (see #1).
3. **"Exact" requires ~10–20 min of human QA per template in the Template Studio.** The pipeline auto-decomposes (OCR regions → font match → inpaint plate → slot boxes → story draft), then a human confirms fonts, nudges boxes, marks overlay patches, and approves. That human pass IS the "human touch" you want to keep — AI does ~90%, a person signs off the last 10%. There is no honest fully-automatic path to "exact".

**Why this is a big upgrade even beyond exactness:** customer generation goes from a 30–60 s, ~$0.13–0.42/ad image-model call to a <2 s, ~$0 deterministic render; edits become instant; the 9:16 story stops being a per-ad AI recompose (today's main slop source) and becomes a per-template authored layout; and publish gains true per-placement assets (`asset_feed_spec`) plus explicit opt-out of Meta's AI "enhancements" so **what you preview is what Meta renders**.

---

## 1. Decisions already made (owner, 2026-08-04)

| # | Decision | Choice |
|---|---|---|
| D1 | Editor foundation | **Custom editor on Konva + react-konva** (MIT). Doc JSON mirrors Polotno's schema shape (`{width,height,fonts[],pages[].children[]}`-style) so a later Polotno/IMG.LY swap is data-mapping, not a rewrite. Polotno SDK rejected: no free production tier in 2026 (~$899/mo realistic), API-key kill-switch, requires disabling React StrictMode app-wide. |
| D2 | Existing 71 templates | **Batch auto-migrate all 71; human-QA the best ~24 (covering all primary intents) to `ready` for cutover**; migrate the rest in the following days. v1 gallery keeps serving until the flag flips. |
| D3 | Customer edit freedom | **Guided by default** (swap images with crop/reposition inside slot, edit text content, brand-palette colour swap; layout/fonts locked) **+ an "Advanced" toggle** unlocking move/resize/font-size stepping. Architecture supports full unlock later. |
| D4 | Story 9:16 | **Authored per template in the Template Studio.** Auto-drafted at build time (plate extended once, layers repositioned into Meta safe zones), human-tuned, then rendered deterministically per customer ad. No runtime AI recompose. |
| D5 | Template fidelity source (2026-08-05) | **Decompose the real source ad directly** — the AI-cloned "safe sample" step is **eliminated** (it was the one remaining full-image repaint and capped every template's quality at one model render). Differentiation from the source is created deterministically by a **mandatory Studio restyle pass**: palette remapped to safe colours, photos replaced with generic assets, text re-typeset with safe copy. Gate enforces restyle evidence + sample-hash ≠ source-hash. Originality/legal posture of "decompose + restyle" is an owner call — recommend a counsel sanity-check of the restyle-distance policy (this plan is not legal advice). |

Model/provider policy: image models are used **only at template build time and only on regions** (text-region inpaint for the plate; optional one-time story background extend) — never a whole ad, never in the customer path. Copywriting AI (existing `copy-generation.ts`) stays, unchanged, optional.

---

## 2. Target architecture

```
                      TEMPLATE BUILD TIME (operator + AI, offline/Studio)
 source ad (meta_ad_candidates/ or Ad Radar; curation bar: proven, designer-grade)
   │  1. vision input-contract extraction        (existing: create-template analyse)
   ▼
 2. DECOMPOSE THE SOURCE DIRECTLY (new scripts/adstudio/v2/ingest.mjs)
   │        a. OCR text regions      (existing detect-regions.mjs, OpenCV+tesseract)
   │        b. font match            (existing corpus Stage A/B)
   │        c. inpaint text → PLATE  (existing layer-derivation approach, gpt-image-2,
   │                                  MASKED REGIONS ONLY — original-bytes-outside-mask
   │                                  guarantee kept; never a full-image repaint)
   │        d. image slot boxes+mask (vision + operator confirm)
   │        e. overlay patches       (operator-marked, auto background-removal)
   │        f. 9:16 story draft      (existing outpaint-layout.ts math + safe zones)
   ▼
 3. STUDIO RESTYLE (mandatory, deterministic): palette remap → safe colours, generic
   │  photos in slots, safe copy re-typeset → PUBLIC SAMPLE = deterministic render.
   │  Gate: restyle evidence recorded + sample hash ≠ source hash + no source identity.
   ▼
 TEMPLATE DOC v2 (JSON + plate/patch assets + font refs + full Meta publish block)
   │  4. FIDELITY GATE: re-render with the SOURCE's own values → compare vs source ad
   │  5. Template Studio human QA (100% zoom + stress previews) → status: "ready"
   ▼
 ┌────────────────────── CUSTOMER PATH (zero AI on pixels) ──────────────────────┐
 │ gallery → inputs (photos + copy) → DETERMINISTIC RENDER (<2 s, server)        │
 │   → Konva editor (guided/advanced) inside pixel-true Meta placement frames    │
 │   → save = doc mutation → server re-render (canonical pixels = f(doc))        │
 │   → publish: v26.0, adimages per format, asset_feed_spec feed+story,          │
 │     enhancements OPT_OUT, CTA/lead-form/copy prefilled from template          │
 └───────────────────────────────────────────────────────────────────────────────┘
```

**The doc is canonical; pixels are derived.** `adstudio_creatives.canvas_json` stores the **instance doc** (template ref + customer values + advanced-mode overrides). Every render (creation, edit-save, publish export) is a server-side deterministic function of the doc, reproducible byte-for-byte. The browser editor previews the same doc with the same fonts; a CI parity test pins browser≈server to sub-pixel anti-aliasing differences only. The existing revision CAS machinery (`adstudio_creative_revisions`, `active_revision_id`, `mutation_id`) is **reused as-is** for edit history/undo — it was built for exactly this.

**What stays untouched:** the whole Meta publish worker architecture (`meta_publish_plans`, VPS `job_queue`, idempotent reconcile-by-name, PAUSED-first, kill switch), brand kits + media library + upload paths, lead form creation, credits wiring, auth/RLS, the workbench shell/nav, and the design system rules (shadcn + `--ui-*` bridge, DESIGN.md).
---

## 3. The contract: Template Doc v2 + Instance Doc

**New file: `src/lib/adstudio/v2/template-doc.ts`** — types below are normative. Ship with zod schemas (`templateDocV2Schema`, `adDocInstanceSchema`) in the same file; every loader validates at parse time (same fail-at-import philosophy as v1 `validateGalleryTemplate`).

```ts
// ─── geometry ────────────────────────────────────────────────────────────────
/** All boxes normalized 0..1 against the layout's width/height. */
export type NormBox = { x: number; y: number; width: number; height: number };

// ─── template doc ────────────────────────────────────────────────────────────
export type AdTemplateDocV2 = {
  schema: "adstudio.template.v2";
  id: string;                       // === filename stem, ^meta-[a-z0-9-]+$
  name: string;
  goal: AdStudioGoal;               // reuse from src/lib/adstudio/types.ts
  offerId: string;
  category: string;
  tags: string[];
  audienceIntent: string;
  classification: { ad_type: string; primary_intent: string; property_or_agent_focus: string };

  provenance: {
    sourceAd: { creativeId?: string; file?: string; contentHash: string }; // SHA-256, unchanged from v1
    /** The public gallery sample is a DETERMINISTIC RENDER of the restyled doc (D5). */
    sample: { imageSrc: string; contentHash: string; generatedBy: "deterministic_render" };
    decomposedFrom: "source";       // D5: layers derive from the real source ad's pixels
  };

  /** D5 — mandatory Studio restyle evidence; "ready" requires it non-trivial. */
  restyle: {
    paletteMap: Record<string, string>;   // #source → #safe colour remaps applied to text/effects
    replacedAssets: string[];             // slot inputKeys filled with generic assets in the sample
    note?: string;                        // operator note on differentiation choices
  };

  /** Every font used by any text layer. Files live in public/fonts/adstudio/ and
   *  must appear in public/fonts/adstudio/manifest.json with matching sha256. */
  fonts: Array<{ fontId: string; family: string; weight: number; italic: boolean;
                 file: string; sha256: string }>;

  formats: { feed: TemplateLayout; story?: TemplateLayout };   // story required for status "ready"

  /** Customer input contract — same philosophy as v1: declare only what the source uses. */
  inputs: {
    images: Array<{ key: string; label: string; required: boolean;
                    aspect?: "landscape" | "portrait" | "square"; description: string }>;
    text:   Array<{ key: string; label: string; required: boolean;
                    maxLength: number; sample: string }>;
  };

  publish: TemplatePublishDefaults;   // §9 — the fully-self-contained Meta block

  editPolicy: {
    mode: "guided";
    advancedUnlockable: boolean;      // default true
    /** Per-layer hard locks that even Advanced mode cannot change. */
    lockedLayerIds: string[];
  };

  exactness: {
    status: "draft" | "qa" | "ready";
    /** Per text-layer residual from the gate (0 = identical, lower is better). */
    residuals: Record<string, number>;
    /** Regions deliberately left as original pixels (not editable). */
    bakedTextKeys: string[];
    qaBy?: string; qaAt?: string;     // required for "ready"
  };
};

export type TemplateLayout = {
  format: "4:5" | "9:16";
  width: 1080; height: 1350 | 1920;
  /** Full-bleed raster: the SOURCE ad with text regions inpainted away and slot regions
   *  left as-is (slots draw OVER the plate). Restyle palette remaps are applied where the
   *  operator recolours plate elements (deterministic hue remap, recorded in restyle).
   *  Lossless WebP. */
  plate: { src: string; sha256: string };
  /** z-ordered ABOVE the plate, ascending. */
  layers: TemplateLayer[];
};

export type TemplateLayerBase = { id: string; z: number; box: NormBox; rotation?: number };

export type ImageSlotLayer = TemplateLayerBase & {
  type: "image_slot";
  inputKey: string;                            // → inputs.images[].key
  fit: "cover";
  /** Default focal point for the cover crop; customer can pan/zoom within the slot. */
  focal?: { x: number; y: number };            // 0..1, default from smart-crop.ts saliency
  mask: { kind: "rect" | "rounded" | "ellipse"; radius?: number };  // radius in px @1080w
  /** Minimum customer-photo resolution; default = the slot's own px size at canvas res.
   *  Below 1.0× → editor warning; below 0.5× → hard block (runtime slop guard). */
  minSourcePx?: { width: number; height: number };
};

export type TextLayer = TemplateLayerBase & {
  type: "text";
  inputKey: string;                            // → inputs.text[].key
  typo: {
    fontId: string; family: string; fallbackFamily: "serif"|"sans-serif"|"monospace"|"cursive";
    weight: number; italic: boolean;
    case: "upper" | "lower" | "mixed" | "none";
    sizeRatio: number;                         // fontSize = box.height(px) * sizeRatio
    lineHeight: number; tracking: number;      // tracking in em
    align: "left" | "center" | "right";
    color: string;                             // #rrggbb
    /** carried over from v1 measurement — drives per-line fidelity */
    measuredLines?: Array<{ text: string; box: NormBox; sizeRatio: number; scaleX?: number }>;
    effects?: {
      stroke?: { color: string; widthRatio: number };          // width = box.height * ratio
      shadow?: { color: string; blurRatio: number; dx: number; dy: number };  // dx/dy normalized
      gradientFill?: { from: string; to: string; angleDeg: number };
    };
  };
  constraints: { maxLength: number; maxLines: number; autoFitMinRatio: number }; // default 0.85
  /** provenance of the spec — carried from the v1 measurement pipeline */
  measurement: { fitScore: number; detectionScore: number;
                 source: "ocr-v2" | "manual-verified"; version: number };
};

export type OverlayPatchLayer = TemplateLayerBase & {
  type: "overlay_patch";                       // original RGBA pixels above slots (panels, borders, badges)
  src: string; sha256: string;                 // lossless WebP with alpha
};

export type TemplateLayer = ImageSlotLayer | TextLayer | OverlayPatchLayer;
```

**Instance doc (per customer ad)** — same file:

```ts
export type AdDocInstance = {
  schema: "adstudio.instance.v2";
  templateId: string;
  /** SHA-256 of the canonical-JSON template doc at instantiation — renders are reproducible
   *  even after a template is later re-QA'd. Template docs are versioned in-repo; the
   *  resolver keeps the last 3 versions per id under template-gallery-v2/<id>/history/. */
  templateHash: string;
  format: "4:5" | "9:16";
  values: {
    images: Record<string, { src: string;                       // AdStudioImageSrc rules (image-src.ts)
                             focal?: { x: number; y: number };  // customer pan
                             zoom?: number }>;                  // 1..3, cover-crop zoom
    text: Record<string, string>;
  };
  /** Advanced-mode deltas, empty in guided mode. Applied after template layers. */
  overrides: Array<
    | { layerId: string; op: "move";   box: NormBox }
    | { layerId: string; op: "font-size"; sizeRatio: number }
    | { layerId: string; op: "align";  align: "left"|"center"|"right" }
    | { layerId: string; op: "color";  color: string }          // brand-palette values only in guided
  >;
  renders?: { feed?: string; story?: string };                  // media paths of last canonical render
};
```

**Rules the zod schema must enforce** (mirror of v1's discipline):
- every `TextLayer.inputKey` ∈ `inputs.text[].key`, minus `exactness.bakedTextKeys`; every `ImageSlotLayer.inputKey` ∈ `inputs.images[].key`; no orphans either direction, per format.
- every `typo.fontId/weight/italic` resolves to an entry in `fonts[]`; `color` matches `^#[0-9a-f]{6}$`; scores ∈ [0,1]; boxes normalized and non-degenerate.
- `story` layout, when present: no text layer or CTA-critical content inside the top 250 px or bottom 340 px of 1920 (Meta story safe zones; Reels bottom clearance 672 px is a Studio *warning*, not a hard fail).
- text boxes may not overlap another text box by > 5% of the smaller box (carried from v1 gate).
- `status: "ready"` ⇒ story layout present, `qaBy/qaAt` set, all residuals ≤ threshold (§10), zero unmatched declared inputs, **and restyle evidence non-trivial** (`paletteMap` non-empty OR every required slot in `replacedAssets`) with `sample.contentHash ≠ sourceAd.contentHash`.

**Files on disk:**
```
src/lib/adstudio/template-gallery-v2/<id>/template.json
public/adstudio-templates/<id>/plate-feed.webp        (lossless)
public/adstudio-templates/<id>/plate-story.webp
public/adstudio-templates/<id>/patch-<layerId>.webp   (RGBA)
public/adstudio-templates/<id>/sample.png             (deterministic restyled render — gallery image)
```
Size budget: lossless-WebP plates run ~40–60% of PNG; expect +40–70 MB repo growth for 71 templates × 2 formats. Acceptable (repo already carries 23 MB of `meta_ad_candidates/` + samples). If it exceeds ~150 MB, move plates to Supabase storage with build-time hash pinning — flagged, not planned.
---
