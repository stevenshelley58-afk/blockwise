# HANDOFF — read this before touching anything (2026-07-02)

Written at the end of a long session with Steven. Version ~30 of this product.
The next session starts HERE, not from scratch. The single biggest cause of 29
failed rebuilds: each one started blind and rebuilt the same mistakes.

## The goal (the spec that was never written down before)

A real-estate agent picks a proven lead-gen ad they wish was theirs, supplies
ONLY what that ad genuinely needs (the app tells them exactly what), and within
~a minute owns a professional adaptation — their brand, photos, suburb —
click-to-edit in place, Meta-ready, repeatable 50x/month without quality
slipping. The ads sell the AGENT (leads: appraisals, open-home signups, seller
enquiries) — never the house; houses sell themselves.

Quality bar (Steven-agreed): a faithful professional adaptation an agent would
proudly run — NOT a pixel-perfect font-exact replica (no current AI can promise
that; anyone claiming it is selling their hits). No AI slop. No fabricated data.
The product justifies itself vs a free image-chat ONLY through: curated proven
templates, brand memory, repeatability, in-place editing, Meta plumbing.

## What is ACTUALLY wrong (ranked, verified with evidence tonight)

1. **The gallery is the product problem.** 26 hand-made SVG recreations that
   collapsed into one visual mould (dark overlay / gold accent / same rhythm).
   Steven's genuinely great source ads were NEVER in the system: his curated
   folder lives only on his PC (`C:\Dev\Blockwise\meta_ad_candidates`), and
   `research.ad_creatives` holds ~2,897 real classified competitor ads with
   images in storage — none used as clone references.
2. **Templates demand data nobody supplies.** Stats slots (median price, growth)
   with no customer input → the AI printed filler ("LATEST DATA") or FABRICATED
   numbers ("$720,000") in perfect typography. Any data slot without a customer
   input must be removed or the template killed. Also: the dialog collects one
   free-text brief instead of the template's specific fields — forces mind-reading.
3. **Config rot (some fixed, some needs Steven):**
   - `TRIGGER_SECRET_KEY` in Vercel is INVALID (401 from trigger.dev) → async
     lane dead; everything runs the sync fallback. Code now strips BOM and
     caches the 401. Fix = paste a real prod secret key in Vercel.
   - `trigger.config.ts` project ref was a placeholder — the task was NEVER
     deployable. Deploy workflow now exists (`.github/workflows/trigger-deploy.yml`),
     needs `TRIGGER_ACCESS_TOKEN` + `TRIGGER_PROJECT_ID` repo secrets.
   - **OpenRouter balance is $0** → every Gemini model unusable → cascade falls
     to slowest/priciest OpenAI. $10-20 top-up unlocks 10-20s drafts.
   - DB `model_profile_versions` had gpt-5.5 pinned everywhere since May 27.
     FIXED tonight (migration): copy/QA now gpt-4.1-mini (copy = 4.5s in prod).
4. **Speed:** prod generation ~2.5 min (slowest model via fallback chain +
   blocking QA). Fixes exist but are PARKED (see PR #157 below).

## What WORKS now (do not rebuild; verified by the robot + prod tonight)

- The clone pipeline end-to-end: template sample (rasterized) + user photos +
  brief → copy → clone → vision QA → persist. Real ads generated in prod with
  LETTER-PERFECT text (see `adstudio_creatives.canvas_json->cloneQa`).
- The e2e robot: `.github/workflows/adstudio-e2e-preview.yml` +
  `e2e/adstudio-real-loop.spec.ts` runs the full customer loop against every
  Vercel preview. ONE secret (ADSTUDIO_E2E_PASSWORD). It caught 10+ real bugs
  in one evening, incl. that cloning had NEVER worked (SVG samples rejected by
  every image API — gallery now ships rasterized .jpg siblings). NEVER trust a
  change that hasn't passed it. NEVER weaken it (AGENTS.md law).
- In-place editing, Meta chrome preview, CTA enum, export gates (P0-P2.1 tasks).

## PARKED: PR #157 (branch claude/template-flow-review-t72mjj) — NOT merged

Draft-then-upgrade (fast draft shown, quality re-render swaps in background via
`creatives/[id]/enhance`), invalid-size retry (gpt-image-1-mini rejects
1024x1280 → retry "auto"), deferred QA on drafts, trigger deploy workflow.
ONE outstanding failure: the robot's export step never fires the download —
the app refuses silently via toast; spec now captures the toast text
(commit 78fde55) but that diagnostic round never ran. Resolve that, gate green,
then merge (Steven authorized going live).

## Why 30 versions failed (don't repeat)

1. Spec unwritten → every session optimized its own guess. (Now written, above.)
2. Source ads outside the system → recreations → mould. (SKILL.md documents this;
   `hermes/skills/adstudio-template-builder/SKILL.md` is LAW for templates.)
3. Outputs never judged ONE AT A TIME by human eyes — bulk regeneration always.
4. Runtime breakage invisible for months (tests skipped themselves). Fixed via
   the robot — keep it sacred.
5. Steven reports feelings ("hanging", "shit") — always pull the exact error/
   latency from Vercel logs (`mcp__Vercel__get_runtime_logs`) and
   `adstudio_provider_runs` (has per-step model + latency_ms) BEFORE guessing.

## The agreed next step (approved plan, kill rule agreed)

ONE template, prove-or-kill (full plan was approved by Steven):
1. Steven supplies his top source ads (chat-paste or repo upload to
   `meta_ad_candidates/`). ONLY he can do this — it has been the blocker.
   Alternative: pick from `research.ad_creatives` (image_storage_path) — but
   sandbox cannot fetch image bytes (network-blocked); a human or CI must look.
2. Requirements card FIRST (what must the customer supply — image slots, text
   facts, data fields; fabricatable slots die), Steven sanity-checks it.
3. Build ONE manifest per SKILL.md, original ad as the clone reference
   (`sampleImageSrc`), gate green, robot green, merge.
4. Generate 3 ads with his real assets; HE judges on his screen.
   Kill rule: not proud to run the best of 3 after one revision round → stop
   for good, wind down honestly. Pass → next template, one at a time; then
   delete the 26 look-alikes; then per-field input UI; then merge PR #157.

## Access notes

- Supabase project: uwwbvdloschaccycjozr. E2e workspace
  00000000-0000-4000-8000-0000000000e2 (user adstudio-e2e@blockwise.test);
  Steven's workspace 00000000-0000-4000-8000-000000000001.
- Sandbox network is locked (no OpenAI/Supabase/GitHub-artifact fetch): AI runs
  only via the deployed app or CI; images reach the session only by user paste.
- Model profiles live in DB (`model_profiles` + `model_profile_versions`) and
  OVERRIDE `src/lib/ai/model-control-config.ts` — check both when models act odd.
