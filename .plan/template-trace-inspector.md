# Template Trace Inspector — Build Plan

> Wayfinder-style map. Chartr-inspired cockpit UI. Lives in `(operator)`.

## Destination

An operator-only interactive tool at `/operator/template-trace` that lets you
open any of the 71 AdStudio templates and see the **entire clone pipeline trace**
side-by-side: source ad → sample → generated output, with every prompt, rule,
bounding box, text field, font placement, and image input visible and editable.
You can tweak any input and regenerate to verify the clone is faithful before
it ships to customers.

**Success looks like:** you open a template, immediately see WHY the output
diverges from the source, edit the prompt or swap an asset, hit regenerate,
and confirm the fix — all without leaving the page or reading code.

## Notes

- Domain: Blockwise Ad Studio template QA / clone fidelity debugging.
- Skills: `adstudio-template-builder`, `blockwise-adstudio-pipelines`, `$impeccable`.
- Operator surface uses the existing CSS shell (`globals.css`), NOT shadcn/Tailwind.
- 71 templates in `src/lib/adstudio/template-gallery/*.json`.
- Source ads in `meta_ad_candidates/` (private, never shown to customers).
- Samples in `public/adstudio-samples/meta/`.
- Clone prompt builder: `src/lib/adstudio/reference-clone.ts` → `buildCloneImageRequest`.
- Region detection: `src/lib/adstudio/clone-qa.ts` → `detectCloneRegions`.
- Generation runs on Vercel (sync) or trigger.dev (async), NEVER locally.

---

## Decision Tickets

### T1 — Data shape: what does the trace contain? `research`

**Question:** For each template, what exact data points constitute a "trace"?

Known so far from the codebase:

| Layer | Data | Source |
|---|---|---|
| Provenance | `sourceAd.file`, `sourceAd.contentHash`, `classification` | template JSON |
| Source image | The real Meta ad PNG | `meta_ad_candidates/<file>` |
| Sample image | The safe public gallery image | `public/adstudio-samples/meta/<id>-sample.png` |
| Input contract | `inputs.images[]` (key, label, required, aspect, description) | template JSON |
| Text contract | `inputs.text[]` (key, label, maxLength, sample, required) | template JSON |
| Clone prompt | The full assembled prompt string | `buildCloneImageRequest()` at runtime |
| Negative prompt | `GLOBAL_CLONE_NEGATIVES` + `PHOTO_FIT_RULE` | `reference-clone.ts` constants |
| Reference assets | Ordered list: [sample, ...customer images] | `buildCloneImageRequest()` |
| Aspect ratio | `template.format` ("4:5" or "9:16") | template JSON |
| Brand colour | `brandHex` or default | runtime input |
| Regions | Bounding boxes for editable zones | `detectCloneRegions()` vision call |
| Campaign meta | `meta.primaryText`, `headlines`, `descriptions`, `cta`, `leadForm` | template JSON |

**Decision needed:** Do we also capture the model profile used (image_draft vs
image_final), the seed, and the generation timestamp? Do we store traces in
Supabase or compute them on-the-fly?

---

### T2 — Prompt reconstruction: show the exact prompt `research`

**Question:** Can we reconstruct the full prompt server-side without running
generation, so the inspector can display it read-only?

`buildCloneImageRequest(template, inputs)` is a **pure function** — it takes
the template JSON + inputs and returns an `ImageProviderRequest` with `prompt`,
`negativePrompt`, `referenceAssets`, `aspectRatio`, `seed`. No API calls.

**Approach:** Create an API route `GET /api/operator/template-trace/[id]` that:
1. Loads the template JSON from the gallery.
2. Calls `buildCloneImageRequest` with the template's own sample values as inputs.
3. Returns the full prompt, negative prompt, reference asset list, and all
   template metadata as JSON.

No generation happens. The prompt is deterministic from the template + inputs.

**Decision needed:** Do we also reconstruct `buildTargetedEditRequest` for the
edit trace? (Probably yes — show what a text edit prompt looks like too.)

---

### T3 — Image serving: how does the operator see source ads? `grilling`

**Question:** Source ads are private (`meta_ad_candidates/`). The operator
surface is auth-gated. How do we serve these images safely?

Options:
- A) New API route `/api/operator/template-trace/image?path=...` that reads
  from `meta_ad_candidates/` on the server, auth-gated to operator role.
- B) Copy source images to a private Supabase storage bucket, serve via
  signed URLs.
- C) Serve from the existing `/api/adstudio/media` proxy with an operator
  access check.

**Leaning toward A** — simplest, no storage migration, source files are already
on disk in the repo. The route validates the path is inside `meta_ad_candidates/`
to prevent directory traversal.

---

### T4 — UI layout: the cockpit `prototype`

**Question:** What's the screen layout?

Chartr-inspired cockpit with three zones:

```
┌─────────────────────────────────────────────────────────────┐
│ SIDEBAR (left)          │ MAIN CANVAS (center)              │
│                         │                                   │
│ Template list           │ ┌─────────┐ ┌─────────┐          │
│ (71 items, searchable,  │ │ SOURCE  │ │ SAMPLE  │          │
│  filterable by format,  │ │  AD     │ │ (clone) │          │
│  intent, focus)         │ │         │ │         │          │
│                         │ └─────────┘ └─────────┘          │
│ Each item shows:        │                                   │
│ - thumbnail             │ ┌─────────────────────┐          │
│ - name                  │ │ REGION OVERLAY      │          │
│ - format badge          │ │ (bounding boxes on  │          │
│ - intent badge          │ │  the sample)        │          │
│ - status dot            │ └─────────────────────┘          │
│                         │                                   │
│                         │ ── Prompt & Rules ──              │
│                         │ Full prompt (read-only, copyable) │
│                         │ Negative prompt                   │
│                         │ PHOTO_FIT_RULE                    │
│                         │ Reference asset order             │
│                         │                                   │
├─────────────────────────┴───────────────────────────────────┤
│ DETAIL DRAWER (bottom or right, expandable)                 │
│                                                             │
│ Tabs: [Inputs] [Text] [Regions] [Meta] [Regenerate]        │
│                                                             │
│ Inputs tab: each image slot with preview, upload override   │
│ Text tab: each field with sample value, editable            │
│ Regions tab: bounding box list with coordinates             │
│ Meta tab: campaign settings, lead form, CTA                 │
│ Regenerate tab: edit prompt, swap assets, hit "Generate"    │
│   → shows result side-by-side with sample                   │
└─────────────────────────────────────────────────────────────┘
```

**Decision needed:** Is this one page with a selected-template detail view,
or a list page + a separate `[id]` detail page? (Leaning toward list + detail
for deep-linking and browser back.)

---

### T5 — Region overlay: how to draw bounding boxes `prototype`

**Question:** How do we render the editable-region bounding boxes on top of
the sample image?

`detectCloneRegions` returns regions with bounding box coordinates (from the
vision model). We overlay them as absolutely-positioned `<div>` elements with
colored borders + labels on top of the sample `<img>`.

Two modes:
- **Static:** Show the last-detected regions (stored in DB from the most
  recent generation).
- **Live:** Run `detectCloneRegions` on-demand via an API route and overlay
  the result.

**Decision needed:** Do we store regions in the template JSON (static, fast)
or always compute them live (accurate, slow ~2-5s per vision call)?

---

### T6 — Regeneration: how does the operator regen? `grilling`

**Question:** When the operator edits inputs and hits "Regenerate", what
happens?

Options:
- A) Call the existing `/api/adstudio/campaigns` route with operator-supplied
  inputs → creates a real campaign (pollutes customer data).
- B) New operator-only route `/api/operator/template-trace/regenerate` that
  runs `buildCloneImageRequest` + the image provider directly, returns the
  image without persisting a campaign.
- C) Use the existing `scripts/adstudio/create-template.mjs render` CLI
  command from the server.

**Leaning toward B** — clean separation, no customer data pollution, returns
the image + the exact prompt used so the operator can compare. Uses the same
`generateCloneWithCascade` path so the model routing is identical to production.

**Decision needed:** Does regen use `image_draft` (fast, Gemini) or
`image_final` (quality, GPT)? Or let the operator choose?

---

### T7 — Diff view: source vs sample vs regen `prototype`

**Question:** How do we make divergence obvious at a glance?

Ideas:
- Side-by-side images with a **slider wipe** (drag to reveal source vs sample).
- **Onion-skin opacity** slider (blend source and sample).
- **Difference heatmap** (pixel-diff overlay highlighting changed areas).
- Simple 2-up or 3-up grid with labels.

The slider wipe is the most intuitive for "are these the same composition?"
The heatmap is the most diagnostic for "what exactly changed?"

**Decision needed:** Start with 2-up + slider wipe, add heatmap later?

---

### T8 — Scope: MVP vs full `grilling`

**Question:** What ships first?

**MVP (this build):**
- List page: all 71 templates, searchable, filterable.
- Detail page: source + sample side-by-side, full prompt display, input
  contract (images + text), region overlay, campaign meta.
- Read-only trace. No regeneration yet.

**Phase 2:**
- Regeneration with editable inputs.
- Slider-wipe comparison.
- Edit-trace (targeted edit prompt display).
- Region re-detection (live vision call).

**Phase 3:**
- Difference heatmap.
- Batch fidelity scoring (run all 71, flag the worst clones).
- Prompt A/B testing (two prompts, two outputs, side-by-side).

---

## Not yet specified (fog of war)

- **Fidelity scoring:** Could we use the vision model to score how closely
  the sample matches the source? (composition, text placement, colour
  palette, image treatment). This would turn "they look different" into
  a number.
- **Template editing from the UI:** If the operator spots a bad sample,
  can they regenerate the sample and write the new hash back to the JSON?
  Or does that stay in the CLI (`create-template.mjs render`)?
- **History:** If we allow regen, do we store a history of attempts per
  template? (Supabase table `template_trace_history`.)
- **Font extraction:** The user asked about "fonts." The clone prompt says
  "preserving its typography" but we don't extract or name the actual font.
  Could vision identify the font family from the source? (Probably
  approximate — "sans-serif, bold, condensed" level.)

## Out of scope

- Customer-facing changes. This is operator-only.
- Modifying the clone pipeline itself (`reference-clone.ts`). The inspector
  observes and tests; fixes go through the normal PR process.
- The Stitch-style in-place editor. That's the customer's post-clone tool.
- trigger.dev integration. Regen runs sync on Vercel or locally.

---

## Build order (once decisions are locked)

1. **API route** `GET /api/operator/template-trace` — list all templates with
   metadata (no images, just JSON). ~1 file.
2. **API route** `GET /api/operator/template-trace/[id]` — full trace for one
   template: prompt reconstruction, input contract, regions, meta. ~1 file.
3. **API route** `GET /api/operator/template-trace/image` — serve source/sample
   images, auth-gated. ~1 file.
4. **List page** `src/app/(operator)/operator/template-trace/page.tsx` —
   searchable grid of 71 templates. ~1 file + CSS.
5. **Detail page** `src/app/(operator)/operator/template-trace/[id]/page.tsx` —
   the cockpit: images, prompt, inputs, regions, meta. ~2-3 files + CSS.
6. **Region overlay component** — SVG/div overlay on the sample image. ~1 file.
7. **Regen route + UI** (Phase 2) — `POST /api/operator/template-trace/regenerate`
   + regenerate tab in the detail page.

Estimated: MVP is ~6-8 new files, no changes to existing pipeline code.
