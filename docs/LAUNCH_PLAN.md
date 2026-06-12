> Superseded: use `docs/runbooks/production-readiness.md` as the current go-live checklist; this file is retained as implementation history.

# Blockwise Go-Live Plan

**Generated:** 2026-06-10 Â· Full e2e review (security, user flow, UI/UX, ads readiness, ops)
**Audience:** A code agent executing tasks one at a time, in order.

## How to use this document

Work through phases in order. Each task has an ID, files, the problem, the fix, and acceptance criteria. Do not skip Phase 0. Obey `AGENTS.md` at all times â€” tasks that require an exception (new dependency, auth-behaviour change) are tagged `[OWNER-AUTHORIZED]`, meaning the repo owner has explicitly requested this work as part of the launch plan. Never print or commit secret values. After each task: run `npm run typecheck` and `npm test`; commit with the task ID in the message.

---

## Phase 0 â€” Emergency (do these first, ~30 minutes)

### P0-1: Fix corrupted .gitignore â€” SSH private key is one `git add .` away from being committed ðŸ”´ CRITICAL ✅ DONE 2026-06-10
- **File:** `.gitignore` (repo root)
- **Problem:** The file is truncated â€” the final entry reads `.s` instead of `.secrets/`. The `.secrets/` directory contains `vps_key` (a private SSH key to the production VPS) and is currently UNIGNORED.
- **Fix:** Restore the end of `.gitignore` to:
  ```
  .secrets/

  # Office temp/owner-lock files
  ~$*
  ```
- **Accept:** `git check-ignore .secrets/vps_key` exits 0. `git status` does not list `.secrets/`.

### P0-2: Remove `ignoreBuildErrors: true` ðŸ”´ BLOCKER ✅ DONE 2026-06-10
- **File:** `next.config.ts` line 7
- **Problem:** TypeScript errors are silently swallowed at build time; broken code deploys to production.
- **Fix:** Delete the `typescript: { ignoreBuildErrors: true }` key. Run `npm run typecheck` and fix every error it reports (do not suppress with `any`/`@ts-ignore` unless unavoidable; if used, leave a `// TODO` comment).
- **Accept:** `npm run typecheck` passes with zero errors; `npm run build` succeeds.

### P0-3: Add build step to CI ✅ DONE 2026-06-10
- **File:** `.github/workflows/hard-reset-verification.yml`
- **Fix:** Add `- run: npm run build` after the typecheck step (provide dummy-but-valid env vars if the build requires them).
- **Accept:** CI green on a test PR; build step actually runs.

---

## Phase 1 â€” Security hardening (before any public traffic)

`[OWNER-AUTHORIZED]` for this phase: adding auth checks to currently-unauthenticated endpoints is an intentional, owner-requested auth change.

### S-1: Remove hardcoded operator email fallback ðŸ”´ HIGH ✅ DONE 2026-06-10
- **File:** `src/lib/operator/auth.ts` line 28
- **Problem:** `process.env.OPERATOR_EMAILS ?? "stevenshelley58@gmail.com"` â€” personal email hardcoded as superuser fallback; grants operator access if the env var is unset.
- **Fix:** Change to fail-closed: `const allowed = (process.env.OPERATOR_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);` Operator access must otherwise come from `profile.is_operator` / workspace role rows. **Owner action:** set `OPERATOR_EMAILS` in Vercel production env before deploying this change.
- **Accept:** Grep finds no `stevenshelley58` in `src/`. With env var unset locally, operator routes return 403/redirect.

### S-2: Lock down `/api/health` and `/api/health/research` ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** `src/app/api/health/route.ts`, `src/app/api/health/research/route.ts`
- **Problem:** Unauthenticated callers receive missing-env-var names, Supabase error messages, and internal ops metrics.
- **Fix:** Require `Authorization: Bearer ${CRON_SECRET}` (same pattern as `src/app/api/alerts/paid-service-watchdog/route.ts`) for the detailed payload. Unauthenticated callers get only `{ app: "blockwise", status: "ready" | "degraded" }`. Strip `missing`, `invalid`, `security.missingRecommended`, and DB error messages from the public response. Also (M6) never return raw Supabase error messages publicly.
- **Accept:** `curl /api/health` without a token returns only app+status; with token returns full detail.

### S-3: Authenticate `/api/model-profiles` GET ðŸ”´ HIGH ✅ DONE 2026-06-10
- **File:** `src/app/api/model-profiles/route.ts` lines 9â€“13
- **Problem:** Exposes all model profiles, cost rates, and provider config without auth.
- **Fix:** Add the same operator guard used in `src/app/api/model-profiles/[key]/test/route.ts` (`requireOperator()` / `ensureOperatorSession(supabase)`) at the top of GET.
- **Accept:** Unauthenticated GET returns 401/403; operator session returns data.

### S-4: Fix PostgREST filter injection in ad search ðŸ”´ HIGH ✅ DONE 2026-06-10
- **File:** `src/app/api/research/ads/search/route.ts` lines 28â€“46
- **Problem:** User-controlled `q` interpolated raw into `.or(...)` filter string â€” commas/parens inject extra predicates.
- **Fix:** Sanitize before building the needle: `const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/[(),]/g, "").trim();` and escape LIKE wildcards: `const needle = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";`
- **Accept:** Searching `foo,status.eq.active` or `foo)` returns normal (empty/literal) results, no PostgREST parse error.

### S-5: Close SSRF gaps in brand-kit URL extraction ðŸ”´ HIGH ✅ DONE 2026-06-10
- **File:** `src/lib/adstudio/extraction-url.ts` (`isBlockedHost`, lines 34â€“47)
- **Fix:** Add blocks for: CGNAT `100.64.0.0/10` (`a === 100 && b >= 64 && b <= 127`); IPv6 link-local/ULA (`/^fe[89ab]/i`, `fc`/`fd` prefixes, and any bracketed IPv6 that isn't validated public); IPv6-mapped IPv4 (strip `::ffff:` prefix before parsing the four octets so `::ffff:169.254.x.x` is caught); hostname `metadata.google.internal` (exact and suffix).
- **Accept:** Unit tests added in `tests/` covering each bypass return blocked.

### S-6: Authenticate the Google Places proxy ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/api/research/locations/autocomplete/route.ts`
- **Problem:** Unauthenticated proxy burning your Google API quota.
- **Fix:** Require a Supabase session (`createSupabaseServerClient()` + `auth.getUser()`) before forwarding.
- **Accept:** Unauthenticated request â†’ 401; logged-in flow still autocompletes.

### S-7: Add Content-Security-Policy header ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `vercel.json`
- **Fix:** Add a `Content-Security-Policy-Report-Only` header first: `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://connect.facebook.net https://www.googletagmanager.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.facebook.com; img-src 'self' data: blob: https:; frame-src https://challenges.cloudflare.com; frame-ancestors 'none';` After a week with no violations of legitimate traffic, switch to enforcing `Content-Security-Policy`.
- **Accept:** Header present in production responses; site functions (Turnstile, pixel, Supabase) unbroken.

### S-8: Rate-limit expensive endpoints ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **Files:** `src/app/api/adstudio/generate-image/route.ts`, `src/app/api/adstudio/campaigns/*/generate*`, `src/app/api/demo-request/route.ts`, `src/app/api/research/ads/search/route.ts`
- **Problem:** No rate limiting anywhere; the `public.rate_limits` table exists but is unused. AGENTS.md forbids new deps, so use the existing table.
- **Fix:** Write one helper `src/lib/rate-limit.ts` that reads/writes `public.rate_limits` (keyed by user id + route, fixed window, e.g. 20/min for search, 10/hour for AI generation, 5/hour per IP for demo-request). Call it at the top of each listed route; return 429 with `Retry-After` when exceeded.
- **Accept:** Hammering an endpoint past the limit returns 429; normal use unaffected; node tests cover the window logic.

### S-9: Validate `sourceUrl` on brand asset creation ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/api/adstudio/brand-kits/[id]/assets/route.ts` lines 41â€“57
- **Fix:** Run incoming `sourceUrl` through `normalizeAndValidateExtractionUrl()` (same module as S-5) before storing; reject invalid/blocked URLs with 400.
- **Accept:** Posting `http://169.254.169.254/` as sourceUrl â†’ 400.

### S-10: Stop returning raw prompt/error JSON to all workspace members ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/api/adstudio/provider-runs/route.ts`
- **Fix:** Omit `input_json`, `output_json`, `error_json` from the default response; return metadata only (id, status, timestamps, model key). If the UI needs error info, map `error_json` to a short human-readable `errorSummary` string server-side.
- **Accept:** Member/viewer responses contain no raw prompt bodies; UI still renders run list.

### S-11: Small auth hardening items ðŸŸ¡ LOW ✅ DONE 2026-06-10
- `src/app/auth/confirm/route.ts` line 50: redirect base â†’ `new URL(next, process.env.NEXT_PUBLIC_APP_URL ?? request.url)`.
- `src/app/api/compliance/route.ts`: add `requireWorkspaceAccess` to GET.
- `.env.example`: remove duplicate `HERMES_BASE_IMAGE`; standardize on `META_AD_LIBRARY_ACCESS_TOKEN`.
- Add root `middleware.ts` that 401s unauthenticated `/api/adstudio/*` and `/api/operator/*` requests as a catch-all (keep per-route guards as defense in depth). `[OWNER-AUTHORIZED]`
- **Accept:** typecheck + tests pass; manual smoke of login â†’ ad-studio flow works.

---

## Phase 2 â€” Conversion funnel & ads instrumentation (before spending ad money)

### A-1: Cookie consent gate for Meta Pixel ðŸ”´ BLOCKER ✅ DONE 2026-06-10
- **Files:** `src/app/layout.tsx` lines 81â€“102, `src/lib/analytics/pixel.ts`
- **Problem:** `fbq('init')` + PageView fire unconditionally for every visitor â€” GDPR/PECR exposure for any EU/UK traffic.
- **Fix:** Build a small consent banner component (no new deps; localStorage key e.g. `bw-consent`). Render pixel/gtag `<Script>` tags only after consent is granted. Use the existing `fbq("consent", "revoke"/"grant")` overload in `pixel.ts`. Banner: short copy, "Accept" / "Essential only" buttons, link to `/privacy`.
- **Accept:** With no consent stored, no requests to `connect.facebook.net` appear in the network tab; after Accept, pixel fires; choice persists.

### A-2: Fire `CompleteRegistration` on signup confirmation ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** post-confirm landing page (see UX-1 â€” `/self-serve`), `src/lib/analytics/pixel.ts`
- **Problem:** Meta can only optimize for page views, not actual signups.
- **Fix:** On first authenticated load after email confirm (e.g. `?confirmed=1` param appended by the confirm route, consumed client-side once), call `fbq('track', 'CompleteRegistration')` (consent-gated per A-1).
- **Accept:** Meta Pixel Helper shows CompleteRegistration exactly once per new signup.

### A-3: Add Google Ads tag ðŸ”´ HIGH `[OWNER-AUTHORIZED]` (script tag, not an npm dep) ✅ DONE 2026-06-10
- **Files:** `src/app/layout.tsx`, `src/lib/analytics/`
- **Fix:** Load `gtag.js` with `NEXT_PUBLIC_GOOGLE_ADS_ID` (new env var, added to `.env.example`), consent-gated per A-1. Fire a conversion event on demo-form success and on CompleteRegistration. If the owner hasn't supplied the AW- ID yet, wire everything behind the env var so it's a config-only enable.
- **Accept:** With env var set + consent granted, gtag network calls fire; without env var, nothing loads.

### A-4: Create a `/pricing` page ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** new `src/app/pricing/page.tsx`; nav/footer links in `src/app/page.tsx`
- **Problem:** Ads â†’ trial signup with no visible price anywhere = trust/conversion leak; FAQ promises a plan choice that doesn't exist.
- **Fix:** Single clear plan card (owner to supply price; use placeholder copy "$X/mo" flagged with TODO if not provided), what's included, trial terms (7 days / 10 ad packs), CTA â†’ `/signup`. Add "Pricing" to landing nav + footer + sitemap.ts.
- **Accept:** `/pricing` renders, linked from landing nav, present in sitemap.

### A-5: Turnstile in production ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** `.env.example`, `src/components/signup-form.tsx` line 28
- **Problem:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` missing from `.env.example`; if unset in Vercel, bot protection silently disables right when ads start driving bot traffic.
- **Fix:** Add the key to `.env.example` and to `scripts/verify-env.mjs` required list. **Owner action:** set real site/secret keys in Vercel.
- **Accept:** `npm run verify-env` fails when the key is missing; signup page on production renders the Turnstile widget.

### A-6: Configure demo-request notifications ðŸŸ  MEDIUM (config-only)
- **Owner action:** set `RESEND_API_KEY`, `DEMO_NOTIFY_FROM`, `DEMO_NOTIFY_TO` in Vercel; verify sender domain in Resend; submit the live demo form and confirm email arrives.

### A-7: Landing page performance + trust polish ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **Files:** `src/app/page.tsx`
- **Fix:** (a) Replace hero `<img>` (lines ~129â€“133) with `next/image` + `priority` + `sizes` (keep mobile/desktop variants). (b) Footer social icons (lines ~577â€“589): until real profiles exist, add `pointer-events: none` so they aren't dead tap targets; when profiles exist, swap spans for real `<a>` links. (c) Verify `opengraph-image.png` and `twitter-image.png` are 1200Ã—630; regenerate if not. (d) Standardize "10 ad packs" vs "10 campaigns" copy everywhere (landing, signup checkbox, trial pill, FAQ) â€” pick **"10 free ad packs"**.
- **Accept:** Lighthouse LCP improves; OG validator (metatags.io) renders correctly; grep shows one consistent trial phrase.

---

## Phase 3 â€” User flow & UI/UX fixes

### UX-1: Kill the dead `/start` route and unify "home" ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** `src/app/(customer)/start/page.tsx`, `src/components/signup-form.tsx` line 122, `src/components/adstudio/topbar.tsx` line 126, `src/lib/**/home.ts` (stale comment)
- **Problem:** `/start` redirects instantly to `/self-serve` (its whole page body is dead code); the email-confirm link targets `/start`; the Ad Studio topbar links `/home` (another redirect). Four competing "home" concepts.
- **Fix:** Canonical home = `/self-serve`. Change signup `emailRedirectTo` next param to `/self-serve` (append `?confirmed=1` for A-2). Delete `start/page.tsx` and its unreachable components. Topbar href â†’ `/self-serve`. Fix stale comment in `home.ts`. Keep `/home` redirect for old links.
- **Accept:** Fresh signup â†’ confirm email â†’ lands on `/self-serve` in one hop; no route renders dead code.

### UX-2: Fix error/404 pages ðŸ”´ HIGH ✅ DONE 2026-06-10
- **Files:** `src/app/error.tsx` (lines 17, 22), `src/app/not-found.tsx` (line 12)
- **Fix:** Buttons link to `/self-serve` labeled "Go to dashboard" (not "/operator"). 404 copy â†’ "Page not found / We couldn't find that page." In production, never render raw `error.message` â€” show the generic fallback (gate on `process.env.NODE_ENV`).
- **Accept:** Crashing page and unknown URL both show customer-appropriate copy and a working dashboard link.

### UX-3: Login form input attributes ðŸ”´ HIGH (tiny) ✅ DONE 2026-06-10
- **File:** `src/components/login-form.tsx` lines 71â€“85
- **Fix:** Email input: add `type="email"`, `id="login-email"`, label `htmlFor="login-email"`. Password: `id="login-password"` + `htmlFor`. (Signup form is already correct â€” match it.)
- **Accept:** Password managers autofill; mobile shows email keyboard.

### UX-4: De-jargon Settings ðŸ”´ HIGH ✅ DONE 2026-06-10
- **File:** `src/app/(customer)/settings/settings-view.tsx`
- **Fix:** (a) Line ~365: remove the "Monthly AI budget" card (internal cost cap) â€” show plan name + trial usage instead. (b) Line ~662: "Instagram actor" â†’ "Instagram account (optional)". (c) Line ~482: replace `status.replace(/_/g," ")` with display map `{connected:"Connected", needs_attention:"Needs attention", revoked:"Disconnected", not_connected:"Not connected"}`; disconnect toast uses `prov.label` not raw key. (d) Region selects (also `onboarding-wizard.tsx` lines ~336â€“342): show full country names (`AU: "Australia"`, etc.).
- **Accept:** No raw enums, internal terms, or country codes visible on Settings/Onboarding.

### UX-5: Reset-password expired-link fallback ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/reset-password/page.tsx` lines 63â€“66
- **Fix:** If `PASSWORD_RECOVERY` hasn't fired within 8s, show "This reset link has expired or was already used." + link to `/forgot-password`.
- **Accept:** Opening a stale link shows the fallback within ~8s.

### UX-6: Brand gate keeps navigation ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/(customer)/ad-studio/page.tsx` lines 112â€“127
- **Fix:** Render `BrandSetupGate` inside the normal app shell (sidebar + topbar) and add a "Back to Home" link next to "Open Brand Studio".
- **Accept:** A user hitting the gate can still navigate anywhere.

### UX-7: Empty/loading state fixes ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- `src/components/monitor/EmptyMetaState.tsx`: accept + use `metaConnectHref` (passed from `MetaMonitorDashboard.tsx` line ~120) so "Connect Meta" starts OAuth directly, falling back to `/settings`.
- `src/app/(customer)/leads/page.tsx` lines 106â€“126: only render the "Duplicate matches" panel when `duplicateCount > 0` or rows exist; normalize pill copy to "Possible duplicate" in both table and mobile views.
- `settings-view.tsx` line ~620 (MetaSetupForm): while loading, show only the loading message/spinner instead of an empty form.
- **Accept:** New-user empty states contain no implementation detail; Connect Meta is one click.

### UX-8: Small polish batch ðŸŸ¡ LOW ✅ DONE 2026-06-10
- `signup-form.tsx`: add "At least 8 characters." hint under password (mirror settings-view.tsx line ~255).
- `sample-banner.tsx` line 31: replace literal `X` with Lucide `<X aria-hidden size={14} />`; persist dismissal in localStorage (copy `FirstRunExplainer` pattern).
- `trial-status-pill.tsx`: add max-width + ellipsis / hide "X used" on narrow viewports.
- `pwa/page.tsx`: show "You appear to be offline" message when offline persists.
- **Accept:** typecheck + visual smoke pass.

---

## Phase 4 â€” Ops & monitoring (first week of traffic)

### O-1: Error monitoring (Sentry) ðŸ”´ HIGH `[OWNER-AUTHORIZED â€” new dependency]` ✅ DONE 2026-06-10
- **Problem:** `NEXT_PUBLIC_SENTRY_DSN` is in `.env.example` but `@sentry/nextjs` isn't installed; failures in Stripe webhooks and Trigger.dev jobs vanish into ephemeral logs.
- **Fix:** `npm install @sentry/nextjs`, run the wizard, set DSN in Vercel. Capture exceptions in: Stripe webhook handler, every Trigger.dev task `catch` block (`trigger/meta-publish.ts`, `trigger/provider-sync.ts`, lead-sync, watchdog), and the global error boundary.
- **Accept:** A thrown test error appears in Sentry from (a) an API route, (b) a Trigger.dev task.

### O-2: Trigger.dev failure alerting ðŸŸ  MEDIUM
- **Fix:** Enable failure email/Slack alerts in the Trigger.dev dashboard (owner action) + Sentry capture from O-1. Wire `SECURITY_AUDIT_LOG_DRAIN_URL` if available.
- **Accept:** A forced task failure produces an alert.

### O-3: Team invite actually invites ðŸŸ  MEDIUM ✅ DONE 2026-06-10
- **File:** `src/app/api/settings/team/invite/route.ts` lines 45â€“46
- **Fix:** Replace `createUser({ email, email_confirm: true })` with `service.auth.admin.inviteUserByEmail(email)` so the invitee receives a magic-link email.
- **Accept:** Inviting a fresh email delivers an invite email; user can set password and land in the workspace.

### O-4: Rollback runbook ðŸŸ¡ LOW ✅ DONE 2026-06-10
- **Fix:** Create `docs/runbooks/rollback.md`: (1) Vercel instant rollback steps, (2) set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` + redeploy, (3) pause Trigger.dev schedules, (4) pause/delete runaway Meta campaign objects in Ads Manager.

### O-5: Verify PWA or hide it ðŸŸ¡ LOW
- **Fix:** On the production URL, check DevTools â†’ Application â†’ Service Workers. If the SW doesn't register/work offline, remove the PWA `start_url` redirect from `manifest.ts` until it's ready.

---

## Phase 5 â€” Owner actions (not code â€” Steven's checklist)

1. **Vercel env vars (production):** `OPERATOR_EMAILS`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (+ secret), `RESEND_API_KEY` / `DEMO_NOTIFY_FROM` / `DEMO_NOTIFY_TO`, `NEXT_PUBLIC_GOOGLE_ADS_ID`, `NEXT_PUBLIC_SENTRY_DSN`, `CRON_SECRET`, Stripe keys (below). Run `npm run verify-env` against the production list.
2. **Stripe:** create product + price, set `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID`, register webhook `https://blockwise.sale/api/settings/billing/webhook` (checkout.session.completed, customer.subscription.created/updated/deleted), test checkout end-to-end. **Until done, ship the Option-B fallback:** hide billing UI claims and keep "get in touch" messaging â€” don't send paid traffic to a funnel that implies self-serve payment.
3. **Meta App Review:** complete review (privacy policy âœ…, data deletion URL âœ… already live), verify OAuth â†’ publish â†’ paused-campaign on a Preview URL, then set `BLOCKWISE_ENABLE_PROVIDER_WRITES=true`. Until then, customers cannot publish â€” the README warning stands.
4. **Decide pricing** for A-4 (the agent will use a TODO placeholder otherwise).
5. **Social profiles:** create LinkedIn + Facebook/Instagram pages (you're selling a Meta-ads product â€” buyers will check), then have the agent swap footer spans for links (A-7b).
6. **Trigger.dev dashboard:** enable failure notifications (O-2).
7. **Rotate the VPS SSH key** if there is any chance `.secrets/vps_key` was ever committed or shared (check `git log --all -- .secrets/` â€” P0-1 protects the future, not the past).

---

## Verification gate (run before flipping ads on)

1. `npm run check` (NUL check + tests + typecheck) and `npm run build` â€” all green.
2. Fresh-user e2e on production: signup â†’ Turnstile renders â†’ confirm email â†’ land on `/self-serve` (one hop) â†’ onboarding wizard â†’ Ad Studio sample campaign â†’ Settings shows no jargon/raw enums.
3. Security spot-checks: `/api/health` (no env detail), `/api/model-profiles` (401), ad search with `foo,status.eq.active` (no injection), `git check-ignore .secrets/vps_key`.
4. Pixel checks (Meta Pixel Helper): no pixel before consent; PageView after consent; CompleteRegistration on signup; Lead on demo form.
5. `/pricing` live and linked; legal pages reachable from footer.
6. Force one error â†’ appears in Sentry.
7. Playwright suite passes: `npm run test:e2e`.

## What is already good â€” do not break

Stripe webhook signature verification; OAuth state HMAC + token vault (`private.provider_token_vault`) + AES-256-GCM token crypto; RLS with workspace isolation on every workspace table; cron watchdog bearer-token gating; Meta data-deletion HMAC callback; redirect sanitization in auth confirm; media path-traversal checks; operator/workforce layouts gated server-side; actionable empty states on leads/results/swipe-file; disabled-while-submitting on all forms; SEO metadata/robots/sitemap; substantive legal pages; Turnstile + honeypot on signup; Trigger.dev job suite.
