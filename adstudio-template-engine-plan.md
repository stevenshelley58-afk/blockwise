# Ad Studio Template Engine — Full Process Plan

**Goal:** templates that are mined from ads *proven to work*, and a generator that actually produces ads matching those templates.

**The reframe in one line:** a template stops being "a copy string + a free-text hint" and becomes **Creative DNA** — a structured, reusable skeleton (layout + composition + copy-safe zones + shot type + colour + copy slots) distilled from real winning ads. Generation stops being free text-to-image and becomes **composition inside that skeleton**, conditioned on a reference exemplar and the user's real photo.

---

## What you already have (build on this, don't rebuild)

Your pipeline is further along than the symptom suggests. Confirmed in code:

- **Ingestion** — Hermes (VPS only, per `AGENTS.md`) scrapes Meta Ad Library → `research.observed_ads` → `research.ad_creatives` (with `creative_hash`, `classification`, `primary_image_url`).
- **Winner scoring** — `trigger/ad-winner-scoring.ts` runs nightly; `src/lib/ad-template-library/winner-scoring.ts` produces a composite score (longevity + iteration + cross-agency + 6-dim review), winner threshold ≥ 70, AU real-estate gate.
- **Template mining** — winners cluster by `(category, hook_style, funnel_stage)` → `research.ad_template_candidates` (`status='draft'`) → operator approves → `research.v_ad_template_library` → AdStudio.
- **Layout render (deterministic, already faithful)** — `buildArchetypeCreative()` + `geometryForArchetype()` + `renderCreativeSvg()` produce the on-template SVG/Fabric.
- **Publish + monitor** — `meta-execution.ts` / `meta-monitor` publish ads and read performance back.

**The two real gaps:**

1. Mined templates capture **copy only** (`headline`, `primary_text`, `cta`, `ai_prompt_seed`) plus a *free-text* `ad_template_image_briefs` row (`concept/layout/imagery/palette` as prose). The **visual structure of the winner is never captured as data**.
2. Generation (`/api/adstudio/generate-image`) is **free text-to-image** and is never told the archetype, geometry, copy-safe zones, or shown the user's photo — so output can't resemble the template. (Documented in the first HTML trace.)

This plan fills both gaps and closes the loop with your *own* ad performance.

---

## The full process (6 stages)

### Stage 0 — Ingest both sources
- **Competitor ads (have it):** Hermes → `observed_ads` / `ad_creatives`. Keep VPS-only; Apify stays a capped fallback ($0.05/run, banned `apify/facebook-ads-scraper`) per `AGENTS.md`.
- **Your own run ads (add it):** pull creatives you've actually shipped + their real metrics (impressions, CTR, CPL, lead count/quality) from `meta-monitor`. Your own performance is a *stronger* winner signal than competitor longevity because it's ground truth for your market and brand.

> Net: one creative corpus, two evidence types — "still running / widely copied" (competitor) and "actually converted" (yours).

### Stage 1 — Winner signal (extend existing scorer)
- Keep the deterministic objective + review score.
- **Add a performance term for your own ads:** blend real CTR / cost-per-lead / lead-quality into `composite_score` (new `ai_score`/`performance_score` column already exists as `ai_score numeric` in `ad_quality_scores`).
- Winner = "proven to work," not "looks plausible."

### Stage 2 — Creative DNA extraction *(NEW — the core gap)*
For every winner image (and video keyframe), run a **vision-model ad teardown** → strict JSON. This is the "data mining the pixels" step.

```jsonc
// creative_skeleton  (extends research.ad_template_image_briefs)
{
  "archetype": "appraisal",              // map to your 8, or propose a new one
  "shot": { "type": "exterior_hero", "lighting": "golden_hour", "mood": "aspirational" },
  "composition": {
    "subject_placement": "center-right",
    "horizon": 0.42,
    "copy_safe_zones": [ {"x":0.06,"y":0.55,"w":0.7,"h":0.3} ],  // normalized boxes
    "focal_point": [0.66, 0.38]
  },
  "color": { "palette": ["#0e2c4a","#f2b138"], "overlay": "bottom_scrim_0.42", "contrast": "high" },
  "text_system": { "headline_zone": "lower_left", "badge": "sold_ribbon_top_left", "cta": "solid_pill" },
  "copy": { "hook_style": "question", "headline_pattern": "What could your {property} be worth?", "cta": "Request update" },
  "variables": ["suburb","property","price_band"],
  "exemplars": ["observed_ad_id_a","observed_ad_id_b"]   // links back to the winning ads
}
```

- Model: Gemini 3 vision or GPT‑4o/`gpt-image`-family vision via your existing provider profiles; **structured outputs / JSON schema** enforced.
- Runs as a **trigger.dev job** (it's AI inference over already-scraped data — *not* scraping — so it's allowed off-VPS; reads images from `research`, writes skeletons back).
- Stores the skeleton on `ad_template_image_briefs` (promote the free-text fields to a typed `creative_skeleton jsonb`).

### Stage 3 — Template distillation (extend existing mining)
- Keep the existing clustering by `(category, hook_style, funnel_stage)`.
- **Aggregate skeletons across a cluster → one canonical template:** the dominant archetype, the median copy-safe zones, the shared palette/shot-type, the copy pattern, and the variable slots — plus 2–3 **exemplar references** (the actual winning ads) for the generator to imitate.
- A distilled **Template** now =
  `{ copy slots · layout skeleton (geometry-ready) · image brief (shot type + composition + copy-safe boxes) · reference exemplars · evidence (why it wins) }`.
- Operator still approves draft → `v_ad_template_library` (governance unchanged).

### Stage 4 — Layout-faithful generation *(NEW — fixes the original bug)*
Split the one bad text-to-image call into two honest jobs that **both read the skeleton**:

**(A) Photo job — reference-conditioned, not free text-to-image**
- Use a reference-capable model:
  - **Gemini 3 Pro Image ("Nano Banana Pro")** — accepts up to 14 role-assigned references + high-fidelity text; you already wire `gemini-3.1-flash-image-preview` via OpenRouter, so the path exists.
  - or **`gpt-image` edit endpoint** with a **mask built from the copy-safe zones**, so the subject is kept out of text areas (inpaint/outpaint).
- Inputs: `[user's listing photo]` (role: subject — *finally actually sent*), `[1–2 winning exemplars]` (role: composition/style), and a prompt **generated from the skeleton** (shot type, lighting, copy-safe zones, AU cues — reuse the richer `bulk-cell.ts → buildImagePrompt()` language).
- Output: a photo that fits the frame the template expects.

**(B) Composite job — deterministic (already works)**
- `renderCreativeSvg()` places headline / subhead / CTA / logo using the skeleton's geometry. Unchanged, already faithful.

> Because the skeleton conditions both jobs, the result matches the template *by construction*. This also kills the earlier 504/timeout debate: one well-scoped photo call is short.

### Stage 5 — QA + feedback loop (closes the loop)
- **Auto-QA:** a vision check compares the generated ad to its skeleton — copy-safe zones respected? on-palette? text legible? on-brief? Fail → regenerate (bounded retries). Your compliance gate stays in front of publish.
- **Publish:** via existing `meta-execution.ts`.
- **Learn:** real performance flows back into Stage 1. Templates that convert get boosted and re-mined; losers archived. The library becomes self-improving — the templates literally get better the more you run.

---

## Concrete build list (mapped to your repo)

| # | Change | Where | New / Extend |
|---|--------|-------|--------------|
| 1 | Pull own-ad creatives + performance into the corpus | `meta-monitor`, new `research.owned_ad_performance` | New |
| 2 | Blend performance into composite score | `winner-scoring.ts` (use existing `ai_score`) | Extend |
| 3 | Vision "ad teardown" → `creative_skeleton` JSON | new `trigger/creative-dna.ts` + provider profile | New |
| 4 | Promote image-brief free text → typed `creative_skeleton jsonb` | migration on `ad_template_image_briefs` | Extend |
| 5 | Aggregate skeletons per cluster into canonical template | `trigger/ad-winner-scoring.ts` mining step | Extend |
| 6 | Carry skeleton + exemplars through to AdStudio template | `templates.ts → mapAdStudioLibraryTemplate`, `AdStudioTemplate` type | Extend |
| 7 | Reference-conditioned photo job (Gemini 3 / gpt-image edit) | `ai-providers.ts`, `generate-image/route.ts` | Extend |
| 8 | Send the user's photo + exemplars as real reference assets | `ad-studio-workbench.tsx → generateBackgroundImage()` | Fix |
| 9 | Build prompt + mask from skeleton geometry | new `skeleton-to-prompt.ts` (reuse `bulk-cell` language) | New |
| 10 | Auto-QA vision check before publish | new `trigger/creative-qa-vision.ts` | New |

---

## Phased rollout (ship value early)

- **MVP (days, highest leverage):** items **7 + 8 + 9** — make generation reference-conditioned and actually send the photo + a layout brief derived from the *existing* archetype geometry. This alone fixes "nothing like the template" without any new mining.
- **V1 (the mining win):** items **3 + 4 + 5 + 6** — extract creative DNA from winners and carry real skeletons into the library, so templates come from proven ads.
- **V2 (the flywheel):** items **1 + 2 + 10** — own-ad performance feedback + auto-QA, so the library self-improves.

---

## Guardrails (respect existing architecture)
- **Scraping stays on the VPS / Hermes**; Vercel only reads research state (`AGENTS.md`). DNA extraction and generation are AI inference, not scraping — fine on trigger.dev/Vercel.
- **Compliance + AU-only gate** stay in front of publish (unchanged `compliance.ts`, market-relevance gate).
- **Cost:** vision teardown runs once per *winner* (a few hundred/night, not every ad); image gen is one scoped call per creative. Apify stays capped.
- **Provider tokens** stay in `private.provider_token_vault`, service-role only.

---

## Why this works
The template and the ad finally share one source of truth — the **skeleton mined from ads that demonstrably worked**. The deterministic renderer already nails text placement; the only thing that was generic — the photo — now gets the layout, the exemplar, and the real listing image as conditioning. And every ad you run feeds the next template. It's an ad app; the templates should be evidence, and the output should obey them.

---

### Sources
- Apify Meta Ad Library actors — https://apify.com/harvestlab/facebook-ads-library-scraper , https://apify.com/apify/facebook-ads-scraper
- OpenAI image edit endpoint (inpaint/outpaint, reference images) — https://developers.openai.com/api/reference/python/resources/images/methods/edit , https://help.openai.com/en/articles/11128753-gpt-image-api
- Gemini 3 Pro Image ("Nano Banana Pro"), multi-image composition + text rendering — https://ai.google.dev/gemini-api/docs/image-generation , https://blog.google/innovation-and-ai/technology/developers-tools/gemini-3-pro-image-developers/
- Vision LLM structured ad teardown — https://dev.to/iloven8n/i-built-an-ai-creative-director-automating-fb-ad-gen-with-gpt-4o-vision-structured-outputs-4g5c
