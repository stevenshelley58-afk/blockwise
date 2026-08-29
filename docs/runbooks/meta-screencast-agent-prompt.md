# Agent prompt: record Meta App Review screencasts for Blockwise (historical)

> HISTORICAL ONLY: This recording prompt assumes the former Vercel/managed
> Supabase deployment. It is not a current deployment or go-live runbook; use
> the self-hosted VPS target and controlled hostname for any new evidence.

Copy everything below the line into a fresh agent session (Claude Code on a
machine with a browser, or any agent with Playwright + screen recording).

---

You are recording the Meta App Review screencasts for Blockwise
(github.com/stevenshelley58-afk/blockwise, a Next.js + Supabase app deployed
on Vercel). Blockwise is a B2B tool where Australian real-estate agencies
connect their own Meta Business ad account, generate lead-ad creative, publish
campaigns in PAUSED state behind a human approval gate, and retrieve lead-form
submissions.

Your deliverable: one or more MP4 screen recordings that satisfy Meta's
per-permission screencast requirements for this exact permission set:
`ads_read`, `ads_management`, `business_management`, `leads_retrieval`,
`pages_manage_ads`, `pages_show_list`, `pages_read_engagement` (plus the Ads
Management Standard Access feature). Output goes to
`artifacts/meta-app-review/`. Read
`docs/runbooks/meta-app-review-submission.md` (section 7) before starting.

## Non-negotiable requirements (Meta rejects without these)

1. Every recording must open with the COMPLETE Facebook login/consent flow:
   the user clicks "Connect Meta" in Blockwise Settings, the real
   facebook.com OAuth dialog appears listing the requested permissions, and
   the test user clicks through and grants them. Do not fake, mock, or skip
   this dialog. Do not stop at the redirect.
2. After granting, show each permission actually working in the product:
   - `pages_show_list` / `pages_read_engagement`: Settings shows the Pages
     list and connected Page metadata after OAuth.
   - `ads_read` / `ads_management` / `business_management`: the
     Results/Monitor screen displaying REAL insights for the connected ad
     account — impressions, reach, clicks, spend must be visible on screen.
     Sample/demo-labelled data is an automatic rejection; verify the
     workspace has a live Meta connection first.
   - `pages_manage_ads` + `ads_management`: run the Ad Studio publish flow
     through the approval step, then show Meta Ads Manager in a second tab
     with the newly created campaign/ad set/ad in PAUSED state.
   - `leads_retrieval`: submit a test lead with Meta's Lead Ads Testing Tool
     (business.facebook.com/ads/lead_gen/tool), then show the lead appearing
     on Blockwise /leads.
3. Recording quality: 1440×1000 or larger, mouse visible, unhurried pacing,
   English UI. No secrets, tokens, or real customer data on screen.

## Environment setup (do this first)

- Use the writes-enabled review environment, NOT production:
  `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` on a Vercel preview deployment
  whose `/api/integrations/meta/callback` URL has been added to the Meta
  app's Valid OAuth Redirect URIs. Confirm with the owner which URL to use;
  production blockwise.sale has provider writes disabled.
- Blockwise login: seed/reuse the review user via
  `node scripts/record-meta-app-review.mjs` tooling
  (`META_REVIEW_TEST_EMAIL`, default `meta-review@blockwise.sale`;
  `META_REVIEW_TEST_PASSWORD`; `META_REVIEW_BASE_URL` for the target host;
  Supabase env comes from `.vercel/.env.production.local` or `.env.local`).
- Facebook side: use the app's designated Facebook test user / test Page /
  test ad account with a role on the Meta app (roles can grant unapproved
  permissions pre-review). Ask the owner for these credentials — never use a
  personal account.

## Suggested workflow

1. Dry-run `node scripts/record-meta-app-review.mjs` against the review URL.
   It automates the in-product walkthrough (privacy page → data-deletion page
   → Settings connect → Results → Leads → Ad Studio publish → Approvals) with
   on-screen captions naming each permission, and outputs an annotated MP4.
   Reuse its flow and captions.
2. The script cannot record the facebook.com consent dialog or Ads Manager.
   Record those segments with a real browser session (Playwright headed mode
   with `recordVideo`, or OS screen recorder): (a) full OAuth grant, (b) Ads
   Manager showing the paused campaign after publish, (c) Lead Ads Testing
   Tool submission.
3. Stitch segments in this order (ffmpeg concat is available; the script
   already converts webm→mp4): OAuth grant → Settings assets → Monitor
   insights → publish + Ads Manager paused proof → test lead → /leads.
4. QA pass against the checklist in
   `docs/runbooks/meta-app-review-submission.md` section 7. Watch the final
   file end-to-end: every permission name must be visibly demonstrated, no
   sample-data labels, no secrets.

## Output

- `artifacts/meta-app-review/meta-app-review-<date>.mp4` (master), plus
  per-permission trims if any single file exceeds Meta's upload limit.
- A short manifest (`manifest.md`) mapping each requested permission to the
  timestamp range that demonstrates it, so the owner can fill the upload slot
  for each permission quickly.
- Report anything that blocked a required shot (missing test asset, sample
  data showing, publish failure) instead of working around it with fakes.
