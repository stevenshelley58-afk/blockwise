# Meta App Review Submission Runbook

Status date: 2026-07-16. Owner: Steven. This runbook tracks everything required
to submit Blockwise for Meta App Review and what remains after approval.

References: Meta App Review Submission Guide
(developers.facebook.com/docs/app-review/submission-guide), Permissions
Reference (developers.facebook.com/docs/permissions), Business Verification
(developers.facebook.com/docs/development/release/business-verification),
Facebook Login for Business
(developers.facebook.com/docs/facebook-login/facebook-login-for-business).

## 1. What is already done (verified 2026-07-16)

- OAuth connect/callback/disconnect with CSRF-signed state
  (`src/app/api/integrations/meta/*`, `src/lib/providers/oauth-handlers.ts`).
- Scopes requested: `ads_read`, `ads_management`, `business_management`,
  `leads_retrieval`, `pages_manage_ads`, `pages_show_list`,
  `pages_read_engagement` (Graph API v23.0).
- `/privacy` and `/terms` live on blockwise.sale and Meta-specific
  (verified over HTTP). `/data-deletion` page serving 200s (verified in
  Vercel runtime logs).
- Data Deletion Callback at `/api/integrations/meta/data-deletion` with real
  HMAC-SHA256 `signed_request` verification, request audit table, and
  confirmation codes.
- Deauthorize Callback at `/api/integrations/meta/deauthorize` (added
  2026-07-16, see section 7).
- Tokens encrypted AES-256-GCM in `private.provider_token_vault`,
  service-role-only access.
- All provider writes gated by `BLOCKWISE_ENABLE_PROVIDER_WRITES`; campaigns
  created PAUSED behind a human approval gate.
- Automated screencast scaffold: `scripts/record-meta-app-review.mjs`.

## 2. Blockers found during this review

1. **`app.blockwise.sale` is not attached to the Vercel project.** DNS
   resolves to Vercel but the project only serves `blockwise.sale` (plus
   vercel.app aliases), so every URL on app.blockwise.sale dead-ends. The
   privacy policy tells users (and reviewers) the application lives at
   app.blockwise.sale. Either add the domain to the Vercel project or edit
   `src/app/(legal)/privacy/page.tsx` to drop the subdomain. Until then, use
   `https://blockwise.sale` for every URL given to Meta.
2. **Confirm `NEXT_PUBLIC_APP_URL` in Vercel production env is
   `https://blockwise.sale`.** It drives the OAuth `redirect_uri` and the URL
   returned by the data-deletion callback. If it points at app.blockwise.sale
   the OAuth round-trip breaks (see blocker 1).
3. **Data-deletion revocation bug (fixed in this change, needs deploy).**
   `disconnectProviderConnectionsForMetaUser` wrote four token columns that
   migration `202605270001_security_hardening` dropped from
   `public.provider_connections`, and never checked the PostgREST error — so
   connections were never marked revoked while the request was still reported
   "completed". Fixed and regression-tested; must be deployed before Meta
   tests the callback.

## 3. App Dashboard checklist (Settings → Basic)

- [ ] App icon 1024×1024, no Meta trademarks.
- [ ] Privacy Policy URL: `https://blockwise.sale/privacy`
- [ ] Terms of Service URL: `https://blockwise.sale/terms`
- [ ] Data Deletion Callback URL:
      `https://blockwise.sale/api/integrations/meta/data-deletion`
      (open it in a browser first — GET must return the JSON probe descriptor)
- [ ] Deauthorize Callback URL (Facebook Login → Settings):
      `https://blockwise.sale/api/integrations/meta/deauthorize`
- [ ] Valid OAuth Redirect URIs:
      `https://blockwise.sale/api/integrations/meta/callback`
      plus the writes-enabled preview host used for reviewer testing
      (`https://<preview>/api/integrations/meta/callback`).
- [ ] App Domains: `blockwise.sale`
- [ ] Category: Business and pages / advertising-appropriate category.
- [ ] Business Use: **Provide services to other businesses**.
- [ ] Primary contact email: monitored inbox (review notifications go here).
- [ ] Connect the app to the Business (Settings → Basic → Verification).

## 4. Business Verification (longest lead time — start first)

- [ ] Business Manager: complete Business Verification for the business that
      owns the app (legal name SHELLEY, STEVEN JOHN / business docs, address,
      phone or domain verification). Advanced Access is inactive until this
      clears.
- [ ] Create the public Blockwise Facebook Page (buyers and reviewers check).
- [ ] Note: Facebook Login for Business apps also need Advanced Access to
      `public_profile` before going live — request it alongside the rest.

## 5. Permissions and features to request in App Review

Request all of: `ads_read`, `ads_management`, `business_management`,
`leads_retrieval`, `pages_manage_ads`, `pages_show_list`,
`pages_read_engagement`, **plus the "Ads Management Standard Access"
feature** (a documented dependency of `leads_retrieval`; also lifts
development-tier Marketing API rate limits), plus `public_profile`
(Advanced) if the app uses Facebook Login for Business.

### Usage description drafts (paste per permission, adjust freely)

**ads_read** — Blockwise shows real-estate agencies the live performance of
the Meta lead campaigns they created in Blockwise. After a business connects
its own ad account, the Monitor screen reads campaign insights (impressions,
reach, clicks, spend, leads, CPL) via `GET /act_{id}/insights` and displays
them inside Blockwise. Without ads_read the customer cannot see whether their
campaign is delivering and the reporting product is non-functional.

**ads_management** — Blockwise turns an agent's property brief into a Meta
lead campaign. After explicit in-app human approval, Blockwise creates the
campaign, ad set, ad creative, and ad on the customer's own ad account via
the Marketing API — always in PAUSED state; activation requires a separate
human approval. Without ads_management, Blockwise cannot create or manage the
campaign objects that are the core of the product.

**business_management** — Requested only as a documented dependency of
`leads_retrieval` (and asset discovery). Blockwise lists the ad accounts and
Pages the connected business user can access so they can choose which assets
Blockwise should use. Blockwise does not call Business Manager write
endpoints.

**leads_retrieval** — Blockwise retrieves submissions from lead forms that
Blockwise itself created on the customer's Page (via
`GET /{form_id}/leads`) and delivers them into the agent's workspace so they
can contact the prospective seller/buyer. This is the product's purpose:
agents run lead ads and work the resulting leads. Blockwise acts as the
advertiser-authorized platform pulling lead data on the advertiser's behalf.

**pages_manage_ads** — Blockwise creates lead-generation ads and lead forms
associated with the customer's Facebook Page (the Page hosts the lead ad and
form). Requested so the publish flow can create the leadgen form on the Page
and run Page-associated ads. Dependency of leads_retrieval.

**pages_show_list** — During connection setup Blockwise lists the Pages the
user manages so they can pick which Page will host their lead ads. Requested
as a dependency of pages_manage_ads and leads_retrieval.

**pages_read_engagement** — Requested as a documented dependency of
ads_management/pages_manage_ads. Blockwise reads Page metadata (name, ID,
linked Instagram business account) to label the connected assets in Settings.
No follower content is displayed.

## 6. Reviewer access instructions (App Verification step draft)

> Blockwise is a B2B workflow tool for real-estate agencies. Test at
> `https://<REVIEW_URL>` (writes-enabled environment).
> 1. Sign in with the test credentials below (email + password login; the
>    app does not use Facebook Login for authentication — Facebook OAuth is
>    only used to connect a Meta Business ad account).
> 2. Go to Settings → Connections → "Connect Meta". You will be redirected
>    to the Facebook OAuth dialog requesting the permissions under review.
>    Grant them with your test user.
> 3. Settings shows the connected ad account, the Pages list
>    (pages_show_list / pages_read_engagement) and asset pickers.
> 4. Results/Monitor shows campaign insights: impressions, reach, clicks,
>    spend, leads (ads_read).
> 5. Leads shows lead-form submissions retrieved from Meta
>    (leads_retrieval). Use the Lead Ads Testing Tool to submit a test lead.
> 6. Ad Studio → Publish creates the campaign/ad set/lead form/creative/ad
>    on the connected ad account in PAUSED state after the human approval
>    step (ads_management, pages_manage_ads). Verify in Ads Manager.
> Test user: meta-review@blockwise.sale / <password> (seeded by
> `scripts/record-meta-app-review.mjs` tooling).

- [ ] Stand up the writes-enabled Preview URL
      (`BLOCKWISE_ENABLE_PROVIDER_WRITES=true` on a Vercel preview env with
      its own callback in Valid OAuth Redirect URIs) and substitute
      `<REVIEW_URL>`.
- [ ] Make sure the review workspace has a REAL Meta connection — with no
      connection the Monitor falls back to labelled sample data
      (`NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA` / no-connection fallback), and a
      recording or reviewer session showing demo numbers is a rejection.

## 7. Screencasts — required content vs current script

`scripts/record-meta-app-review.mjs` already walks privacy → data deletion →
settings/connect → results → leads → ad-studio publish → approvals with
per-permission annotations. Gaps to close before recording the final take:

- [ ] **Show the real Facebook consent dialog.** Meta's screencast
      requirements for every requested permission start with "demonstrate the
      complete Facebook login process showing how your app user grants your
      app this permission". The current script stops at the OAuth handoff.
      Record the actual facebook.com dialog (test user granting the listed
      permissions) — this is the most common rejection cause.
- [ ] Record against the writes-enabled preview with a genuinely connected
      account so Monitor shows real insights (impressions, clicks, spend,
      reach visible on screen), not sample data.
- [ ] After publish, show Ads Manager with the created PAUSED campaign
      ("showcase that the ads are created successfully").
- [ ] Show at least one real lead row in /leads (submit one with the Lead
      Ads Testing Tool first).
- [ ] Keep the existing permission-name annotations; they map cleanly to
      Meta's per-permission upload slots.

## 8. Code changes made in this prep (2026-07-16)

- `src/lib/meta/data-deletion.ts` — revocation now writes only existing
  `provider_connections` columns, checks PostgREST errors (failed deletions
  are recorded as failed instead of silently "completed"), adds
  `processMetaDeauthorizeRequest`.
- `src/app/api/integrations/meta/deauthorize/route.ts` — new Deauthorize
  Callback (verifies `signed_request`, nulls vault tokens, marks connection
  revoked; does not delete leads — that stays on the data-deletion trail).
- `src/lib/meta-monitor/getMetaMonitorData.ts` — comment fix: leads arrive by
  scheduled polling; there is no Meta webhook.
- `tests/meta-data-deletion.test.ts` — regression tests for the dropped-column
  bug and the new deauthorize route.
- Verified: `tsc --noEmit` clean, meta test file 5/5 pass.
- [ ] Commit, deploy, then click both callback URLs (expect JSON probe
      descriptors) before pasting them into the App Dashboard.

## 9. Submit

- [ ] App Review → Permissions and Features → Request each permission +
      Ads Management Standard Access.
- [ ] Paste usage descriptions (section 5) and upload screencasts (section 7).
- [ ] Complete App Verification with reviewer instructions + test credentials
      (section 6).
- [ ] Accept Platform Terms, submit. Decision typically within a week.

## 10. After approval

- [ ] Set `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` in production.
- [ ] Switch the app to Live mode.
- [ ] Re-run `node scripts/verify/adstudio-templates.mjs` and the publish
      smoke on production.
- [ ] Expect Meta's annual Data Protection Assessment while holding Advanced
      Access; the privacy policy and token-handling answers in it are already
      accurate.
