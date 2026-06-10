# Ad Studio Improvement Roadmap

June 2026. Based on a full codebase audit plus current AI/ad-tech research. Ordered by impact-per-effort within each section. File paths verified against the repo.

---

## 1. Faster (days of work, immediate user-felt wins)

**Parallelize copy enrichment.** `src/lib/adstudio/campaign-copy-enrichment.ts:27-58` awaits `generateAdStudioCopy()` serially per variant. 5 variants × 3-5s = 15-25s spinner. Switch to `Promise.allSettled()` per variant; apply successes, surface failures per-variant instead of `break`ing the whole loop on first error. This alone cuts generate time ~70%.

**Cache prompt bundles and model profiles in memory.** Every inference call re-queries Supabase for the active prompt bundle (`prompt-registry.ts:220-258`) and model profile (`model-profile-runtime.ts:11-26`) — ~200-500ms overhead per call. Cache with a 5-min TTL keyed by prompt key + workspace. Zero risk: fallbacks already exist.

**Return generated images before the storage upload finishes.** `api/adstudio/generate-image/route.ts:258-296` blocks the response on Supabase Storage upload. Return the data URL immediately, upload in the background (or via Trigger.dev), patch the asset URL after.

**Concurrent bulk cells.** `api/adstudio/bulk-generate/route.ts:75-85` runs cells one at a time. Fan out with a concurrency limit of ~5. 20-cell runs go from minutes to ~1/5 the time.

**Progressive reveal in the workbench.** Even with parallelization, show variant cards as each one resolves (stream per-variant results to the client) instead of one long spinner. Perceived speed matters more than actual speed.

---

## 2. Cheaper

**Stop generating 4 images per request by default.** The mixed OpenAI + OpenRouter path (`ai-providers.ts:234-265`, `generate-image/route.ts:85-163`) fires 4 calls every variant request. Default to 2 (1 per provider), make 4 an explicit "more options" click. ~50% image spend cut.

**Cut default variant count from 5 to 3.** `campaigns/[id]/generate/route.ts:77`. Scoring is deterministic (see §3), so the extra 2 variants don't earn their cost today. Restore 5 once scoring is learned.

**Trim bulk-cell rolls.** `bulk-cell.ts:44` defaults to 3 image rolls per cell. Worst case ~$48/bulk run. Default to 1 roll; only re-roll when QA fails (which is the actual purpose of rolls).

**Compress the prompt.** Every copy call carries full compliance rules + brand constraints (~400-500 token system prompt, `assemble-prompt.ts:254-289`). Use OpenAI prompt caching (static system prefix first, variable context last) — cached input tokens are ~50-90% cheaper and faster. No behaviour change.

**Watch the ledger.** You already log everything to `adstudio_provider_runs` and aggregate in `/api/ai-ledger`. Add a per-workspace daily spend alert so cost regressions surface in hours, not invoices.

---

## 3. Higher-performing ads (the biggest lever)

This is where Ad Studio goes from "makes ads" to "makes ads that win."

> **Implemented 2026-06-10** (see `docs/plans/ad-studio-3-4-execution-plan.md`, Workstream A): variant→ad tagging via ad-name suffix + plan JSONB (A3), angle analytics in the monitor (A4), LLM-judge scoring of generated copy with deterministic fallback (A1, phase 1 of learned scoring), cross-variant copy-similarity warnings (A2, text-based, no perceptual hashing — no new deps), creative fatigue alerts with an Ad Studio CTA link (A5), and A/B publish of selected variants into one ad set (A6, server + publish-panel variant multi-select; default all-selected keeps the existing full-pack publish). Phase-2 CPL-calibrated scoring and generation biasing toward winners remain open.

**Close the performance loop.** You have both halves but they're not connected: Ad Studio generates variants, and Meta Monitor (`meta-monitor/getMetaMonitorData.ts`) ingests spend/leads/valid-CPL per ad. Nothing feeds performance back into generation. Build the join: tag every published ad with its variant ID, template, angle, image style, and copy hash; then surface "your 'price clarity' angle ads get 2.1× the valid leads of 'market update' ads in Parramatta" and bias future generation toward winners. This is the moat — none of the per-account data leaves your platform, and competitors can't replicate it.

**Replace deterministic scoring with learned scoring.** `scoring.ts:14-30` assigns scores by rule/index at generation time, disconnected from output quality. Phase 1: have the LLM score actual generated copy/image against the 6 dimensions (cheap, immediate). Phase 2: calibrate against real valid-CPL data from the monitor once you have volume. Pre-flight creative scoring is now table stakes — AdCreative.ai and Pencil both predict CTR/CVR before launch.

**Design for Meta Andromeda.** Meta's 2026 retrieval engine reads creative content semantically and suppresses near-duplicates (similarity >60% competes as one entity). Current guidance: 10-15 *conceptually distinct* assets per Advantage+ campaign beats 50 variations of one idea. Implications for Ad Studio:
- Generate variants that differ by *angle and visual concept*, not just headline swaps. Your hardcoded angle system (`generator.ts:176-254`) is a good base — push diversity into the image prompts too.
- Add a perceptual-hash similarity check across a campaign's variants (you only do exact content-hash dedup in `creative-qa.ts`) and warn when variants are too similar to each other.
- Position bulk generation as the Andromeda play: "feed Meta 12 distinct concepts" is a feature, not a power tool.

**Creative fatigue alerts.** You already pull frequency per ad in the monitor. When frequency climbs and CTR decays, prompt the user: "This ad is fatiguing — generate 3 fresh concepts?" One-click from insight to regeneration is the workflow competitors charge enterprise prices for, and it drives recurring generation usage.

**A/B publish as a first-class flow.** Variants exist but there's no formal test framework. Let users publish 2-3 variants into one ad set with a shared budget and report the winner by valid CPL after N days. The monitor already attributes per ad ID — this is mostly UX, not infra.

---

## 4. UI/UX

> **Implemented 2026-06-10** (see `docs/plans/ad-studio-3-4-execution-plan.md`, Workstream B): staged generation progress with skeleton variant tiles and per-slot error states (B1), draft-brand generation with publish-time approval gating (B2, simplification), left nav collapsed to Ad / Brand / Publish + Advanced with Media/Copy as canvas-driven contextual inspectors (B3), per-format export progress with retry chips so one failed format never blocks the rest (B4), and client in-flight guards + a server input-hash dedup on the generate route (B5).

**Make first-generation magical and linear.** The brand-kit-approval gate before any generation is a conversion killer for trial users. Auto-extract the brand kit from their URL, generate immediately with it marked "draft brand — confirm later," and let approval happen after they've seen value. (AGENTS.md simplification-PR territory.)

**Cut the 7-panel navigation.** Campaign / Templates / Brand / Media / Copy / Publish / Settings is a lot of concepts. The real workflow is Generate → Refine → Publish. Collapse Media + Copy into the canvas context (click the image → image actions, click text → copy actions); panels become contextual inspectors instead of destinations.

**Streamed generation states.** Replace spinners with staged progress ("Writing your Parramatta angle… 2 of 3 variants ready") and skeleton variant cards that fill in. Pairs with §1 parallelization.

**Defuse export waits.** `use-campaign-actions.ts` waits up to 45s for Fabric renders with no graceful degradation. Render server-side or in a worker, show per-format progress, never block the whole export on one slow format.

**Request dedup on the client.** Generate/save/export buttons can double-fire. Disable-while-pending plus an input-hash guard server-side.

---

## 5. AI tech not yet used

Ranked by fit. Note AGENTS.md: new dependencies and provider-behaviour changes need explicit authorization — most of these are env/config-level model swaps, which your `model_profiles` system was built for.

**Text-reliable image models for headline-in-image creatives.** Real estate ads live and die on legible suburb names and offers rendered in the image. Ideogram v3 is the category leader for text-in-image; Flux 2 Pro is the strongest general default; Imagen 4 Ultra leads photorealism. All are available via API/OpenRouter, so they slot into your existing fallback cascade as new candidates in `model_profiles` — no code restructure.

**Reference-image brand consistency.** Flux Kontext-style editing (reference image + instruction) means "same house photo, dusk lighting, add SOLD banner in brand red" instead of regenerating from scratch. Cheaper than full generations and dramatically more consistent. This also unlocks **virtual staging** — staged listings sell 73% faster, and AI staging (with disclosure) is now standard practice. A "stage this room" button on uploaded property photos is a feature agents will pay for by itself.

**Short-form video ads.** Listings with video get ~4× the inquiries; 15-20s vertical clips are the highest-performing Meta real-estate format. Veo 3.1 (best overall, native audio, portrait 4K), Kling 3.0 (cheapest for volume, multi-shot storyboard), Runway Gen-4 (best reference-image control for brand consistency). Start narrow: image-to-video pan/zoom "motion ads" from existing creatives — low cost, low risk, huge perceived upgrade. Note Sora's API is being discontinued Sept 2026 — don't build on it.

**Vision-grounded copy at scale.** You already support image-grounded copy (`copy-generation.ts:100`) — make it the default path so headlines reference what's actually in the creative ("That north-facing deck…"). Differentiator vs. template tools.

**Agentic campaign strategist.** A higher-tier flow where a reasoning model takes the brand kit + suburb data + monitor history and proposes a full month's campaign plan (concepts, budgets, flighting) which the user approves once. Your operator prompt/model-profile infrastructure already supports tiered model profiles (`strategy` profile exists but is unused in Ad Studio).

**Embeddings for creative memory.** Embed every generated + published creative; use it for (a) "more like this winner," (b) cross-workspace anonymized angle insights, (c) the similarity guard in §3. pgvector is already available in Supabase — schema work, so needs explicit sign-off per AGENTS.md.

---

## 6. Suggested sequence

| Phase | Theme | Items |
|-------|-------|-------|
| Week 1-2 | Speed + cost | Parallel copy, prompt/profile caching, image count defaults, prompt caching |
| Week 3-4 | Trust the output | LLM-judge scoring, perceptual similarity guard, streamed generation UX |
| Month 2 | Performance loop | Variant→ad tagging, winner analytics, fatigue alerts, A/B publish |
| Month 2-3 | New creative tech | Ideogram/Flux in model profiles, reference-image editing, virtual staging |
| Month 3+ | Expansion | Motion/video ads, agentic strategist, embeddings memory |

The single most important strategic move: **close the generation→performance loop (§3)**. Speed and cost fixes keep users; the feedback loop is what makes the ads measurably better than what anyone else's tool produces, and it compounds with every campaign published.

---

## Sources

- [Atlas Cloud — Best AI Image Models 2026](https://www.atlascloud.ai/blog/guides/best-ai-image-generation-models-2026)
- [AI/ML API — Best AI Image Generators 2026](https://aimlapi.com/blog/the-best-ai-image-generators)
- [Space Ads — Veo vs Sora vs Kling vs Runway for Ads 2026](https://www.spaceads.agency/blog/ai-video-generators-veo-3-sora-2-kling-runway-ads-2026)
- [Digital Applied — Best AI Video Generators 2026](https://www.digitalapplied.com/blog/after-sora-best-ai-video-generators-2026-runway-kling-veo)
- [Segwise — Meta Andromeda Creative Strategy 2026](https://segwise.ai/blog/meta-andromeda-update-creative-strategy-2026)
- [Affect Group — Andromeda Explained](https://affectgroup.com/blog/andromeda-2026-how-meta-ads-algorithms-now-deliver-our-ads/)
- [Meta Engineering — Andromeda retrieval engine](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/)
- [Get-Ryze — Creative Optimization Tools 2026](https://www.get-ryze.ai/blog/best-ad-creative-optimization-tools-2026)
- [Superside — AI Ad Creative Generators 2026](https://www.superside.com/blog/ai-ad-creative-generators)
- [HousingWire — Virtual Staging 2026](https://www.housingwire.com/articles/virtual-staging-companies-apps/)
- [Stape — Real Estate Facebook Ads 2026](https://stape.io/blog/real-estate-facebook-ads)
