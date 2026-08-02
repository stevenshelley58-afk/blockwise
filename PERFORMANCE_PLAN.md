# Blockwise Performance Plan

**Date:** 2026-07-28
**Audited:** full `src/` (503 TS/TSX files, 100 API routes, 50 pages), `docs/` (34 files), live Supabase project `blockwise` (uwwbvdloschaccycjozr), Vercel project `blockwise`, `pg_stat_statements` (33 days of query stats), and all 493 Supabase advisor lints.

Every claim below traces to a file:line or a live query. Prices verified against official Supabase/Vercel docs on 2026-07-28.

---

## TL;DR — the 6 moves that matter most

| # | Move | Type | Effort | Impact |
|---|------|------|--------|--------|
| 1 | **Your app shares a 1GB-RAM database with your scraper.** The `research` schema is 8.5GB of the 9.1GB DB; Hermes has issued **16.2M queue polls in 33 days (~5.7/sec around the clock, ~78 hours of pure DB execution time)** against the same Micro instance that serves every page. Upgrade compute today ($15–60/mo), then split research out of the app DB. | Infra | S then L | ★★★★★ |
| 2 | **Nothing streams.** 1 `loading.tsx`, 1 `<Suspense>`, 0 server caching, 0 prefetch in the entire app. Every navigation blocks on 3+ sequential DB round trips before any pixel changes. Skeletons + Suspense + `staleTimes` is the single biggest *felt* improvement and it's nearly free. | Code | S | ★★★★★ |
| 3 | **Every API request pays a 3-round-trip auth tax.** All 100 routes call `supabase.auth.getUser()` (network hop to Supabase Auth) + 2 membership queries before doing real work — and the ad-studio client polls those routes **once per second**. Local JWT verification + poll backoff/Realtime. | Code | M | ★★★★☆ |
| 4 | **Worst waterfall: up to 23 sequential round trips** to render `/ad-studio` (`src/lib/adstudio/load-live-bundle.ts:57-134`). Several pages have fixable 3–5-step chains. | Code | M | ★★★★☆ |
| 5 | **175KB of CSS shipped as JavaScript strings** (`src/components/adstudio/styles.ts` alone is 114KB) + **255KB of render-blocking CSS on every route** including `/login`. Mechanical fixes. | Code | S–M | ★★★☆☆ |
| 6 | **Measure before/after:** enable Vercel Speed Insights, reset `pg_stat_statements`, set a TTFB/LCP baseline so you can prove each change worked. | Process | S | prereq |

**What's already right (don't spend time here):** Vercel `syd1` ↔ Supabase `ap-southeast-2` region alignment is correct; `src/middleware.ts` is a cookie-presence check with zero network I/O; recharts is properly code-split behind `dynamic()`; main ad generation correctly runs async on Trigger.dev (202 + poll); ad-studio media has `immutable` cache headers; `/guides` pages use `next/image` correctly; auth context is `React.cache()`-memoized for server components.

---

## 1. Evidence summary

### Database (live project, stats window 2026-06-25 → 2026-07-28)

- Instance: **Micro-class** — `max_connections=60`, `shared_buffers=256MB` (≈1GB RAM, 2-core). DB size **9,172MB**.
- `research` schema ≈ **8.5GB** of it: `agent_decisions` 3.7GB (928K rows), `ingest_events` 1.7GB (3.5M rows), `work_queue` 1.6GB (1.07M rows), plus snapshots/creatives/media tables. The app's own `public` schema is a few hundred MB.
- Top 3 statements by total time are all **Hermes `work_queue` polling**: 5.2M + 1.5M + 9.4M calls (1.4–45ms mean each; ≈205M ms ≈ 57 hours combined), with `ad_fetch_runs` cost checks close behind at 342ms mean. Top-20 statements ≈ 78 hours of execution over a 33-day window — a sustained ~10% of one core, plus the cache-eviction and I/O pressure that comes with it. Docs confirm the effective poll loop is **10s** in compose (`docs/research-engine/env.md:84`), concurrency 4, claim batch 8.
- Effective cache is 768MB against a 9.1GB database: **the working set cannot fit in memory**, so app queries regularly hit disk after scraper activity evicts their pages.
- Advisor lints (493): **137 duplicate-index groups** (70 in `public`, 27 in `research` — every write pays twice), **42 unindexed foreign keys** (37 in `public`), 294 unused indexes, 15 multiple-permissive-policy warnings, and Auth pinned at 10 absolute connections.
- App-side query stats are healthy (tables are tiny; seq scans on 5-row tables are fine). **The app isn't out-querying the database — the scraper is out-muscling it.**

### Rendering (Next.js 16 App Router)

- `force-dynamic`: 127 occurrences — 32 of 50 pages, 95 API routes (the API ones are no-ops).
- Streaming: **1** `loading.tsx` (customer group only — and it doesn't cover `AppShell`, so it can't paint until auth resolves), **1** `<Suspense>` (`results/page.tsx:61`), **0** for all 11 operator pages.
- `<Link prefetch>`: 0 uses; `experimental.staleTimes`: unset → Next 16 default `dynamic: 0`, so **Back/forward re-fetches the full RSC payload including the whole auth chain**.
- Server caching: `unstable_cache` 0, `revalidateTag` 0, `"use cache"` 0. Only 2 ISR pages (`suburb/[postcode]`, `pwa`).
- First-paint chain on every self-serve page: `getUser()` (network) → profiles+membership (parallel) → `get_trial_status` RPC (sequential, `src/components/app-shell.tsx:154`; 2 extra queries if the RPC errors) → page queries. **3–5 sequential round trips before any HTML flushes.**

### API routes & polling

- 6 client polling loops, **0 with backoff, 0 that pause when the tab is hidden**. Ad-studio job poll: **1,000ms interval for up to 10 minutes** (`src/components/adstudio/use-campaign-actions.ts:24-25`) = up to 600 requests × ~4 queries each per generation. Workbench re-downloads the **entire campaign pack every 3s** just to read one QA flag (`ad-studio-workbench.tsx:786-801`).
- `/api/adstudio/campaigns/[id]` runs 15 queries per hit, **5 of them fully redundant** (fetched raw at `route.ts:21-28`, then re-fetched inside `loadAdStudioCampaignPack`), and returns every payload twice.
- `/api/operator/research/drain-status`: **~53 queries per request** (44 `count: "exact"` scans over `work_queue`), polled every 15s while the dashboard is open (`src/lib/research/drain-status.ts`, `research-drain-dashboard.tsx:33`).
- `/api/research/local-ad-radar`: up to **48 sequential leading-wildcard ILIKE queries** per request (`src/lib/research/public-ad-radar.ts:404-412`) — the code already swallows statement timeouts from this.
- Cache-Control: **51 of 57 GET routes send none.** Supabase Realtime: **0 uses** — everything that could push is polled. Signed URLs: 0 — every ad-studio image goes through an authenticated proxy route costing 3 auth round trips + a Lambda invocation per image (`/api/adstudio/media`).
- `select("*")`: 44 call sites; the ad-studio library loads **every creative a workspace has ever made, with full `canvas_json`, no limit** (`ad-studio/library/page.tsx:25`).
- Synchronous AI in request handlers: creative **edit** and **layers** routes hold the HTTP connection up to **5 minutes** (`maxDuration = 300`) instead of using the 202+job pattern that generation already has.

### Client bundle & assets

- **CSS-as-JS**: 7 inline `<style>{...}</style>` injections totalling ~175KB — `adstudio/styles.ts` 114KB, `new-ad-dialog.tsx` 25.6KB, `brand-studio.tsx` 14.8KB, etc. Parsed as JS, not cacheable as CSS.
- **Root layout imports 5 stylesheets (~255KB) on every route** (`src/app/layout.tsx:10-14`), including `meta-monitor.css` (only `/results` uses it) and `landing.css` (only audit/pricing/research use it). `globals.css` alone is 165KB/8,088 lines — your own `docs/REBUILD-PLAN.md:22` flags this.
- `radix-ui` **monolithic barrel** imported in 14 UI files and NOT in `optimizePackageImports` (the current `["recharts"]` entry is a no-op — recharts is in Next's default list; `next.config.ts:14`).
- `motion` statically imported into the landing page (`home-landing/start-studio.tsx:4`); supabase-js (~35KB gz) in the shared authenticated layout chunk just for `signOut()` (`account-menu.tsx`, `mobile-bottom-nav.tsx`).
- 58 raw `<img>` (24 without `loading="lazy"`); the landing FB-ad mock photo has no dimensions/priority (`fb-ad-card.tsx:25`). Meta Pixel loads and fires `PageView` on **every** route incl. authenticated app, before consent resolves (`layout.tsx:99-113`).
- Service worker caches **every same-origin image incl. `/_next/image` responses, cache-first, forever, no size cap** (`src/lib/pwa/sw-policy.ts:33,74-76`) and intercepts all navigations.
- Dead weight: 16 orphaned components (~102KB source, one pulling recharts), `@tanstack/react-table` in dependencies with **0 imports**, duplicate Inter font declaration on the homepage.

---

## 2. Tier 0 — Measure first (half a day)

1. **Enable Vercel Speed Insights** on the project (dashboard → Speed Insights; add `@vercel/speed-insights` `<SpeedInsights/>` next to the existing `<Analytics/>` in `src/app/layout.tsx`). Watch TTFB p75 and LCP p75 per route — this is the scoreboard for everything below.
2. **Reset query stats** so post-change comparisons are clean: `SELECT pg_stat_statements_reset();` (Supabase SQL editor). Snapshot the current top-20 first (Appendix A.5).
3. **Sentry tracing**: `src/instrumentation-client.ts` sets `integrations: []`, which disables everything — `replaysOnErrorSampleRate` there is dead config. Either remove it or set a small `tracesSampleRate` (e.g. 0.1) to get real route timings.
4. Baseline Lighthouse (mobile) on `/`, `/results`, `/ad-studio`, `/login`.
5. Supabase dashboard → Reports → Database: note CPU, disk I/O and cache-hit-rate graphs before you change compute, so the before/after is visible.

**Targets worth aiming at:** authenticated TTFB p75 < 400ms (currently the auth+trial chain alone can exceed that), LCP p75 < 2.5s on `/` and `/results`, generation-status request volume down ~90%.

---

## 3. Tier 1 — Make it FEEL fast this week (small, low-risk, mostly perception)

These don't reduce total work much — they reorder it so users see something instantly. This is the "make it feel faster" list.

1. **Add `src/app/(operator)/loading.tsx`** (copy the customer skeleton). One file; makes all 11 operator pages paint a skeleton immediately AND re-enables Link prefetching for them.
2. **Fix the customer skeleton so it actually shows.** `(customer)/loading.tsx` sits inside the layout, so nothing paints until `AppShell` finishes auth+trial. Move the trial fetch out of the blocking path: render the pill from a `<Suspense fallback={null}>` child and pass the promise, or drop the server fetch entirely and let `TrialStatusPill`'s existing `/api/trial/status` fetcher hydrate it (`src/components/app-shell.tsx:154,87`). Saves 1–3 sequential round trips on **every** self-serve page.
3. **`experimental.staleTimes: { dynamic: 30 }`** in `next.config.ts`. Back/forward and re-visits within 30s become instant instead of re-running the full server render. One line, huge perceived win.
4. **Wrap slow page bodies in `<Suspense>`** exactly like `results/page.tsx:61` already does: ad-studio, leads, settings, and the operator pages. Shell + nav appear immediately; data streams in.
5. **Poll hygiene** (pure client, no server changes):
   - `use-campaign-actions.ts:24` — 1s → exponential backoff (1s×5 → 2s → 5s → 10s cap). A 10-min generation drops from ~600 requests to ~70.
   - `ad-studio-workbench.tsx:798` and `publish-panel.tsx:360,516` — same backoff; merge the two overlapping publish polls into one effect.
   - All pollers: skip when `document.visibilityState === "hidden"`, fire immediately on `visibilitychange`.
   - `research-drain-dashboard.tsx:33` — 15s → 30s + hidden-tab pause (this alone removes ~53 DB counts × 4/min while an operator tab idles).
   - `public-ad-radar-dialog.tsx:73-78` — stop the unbounded page-walk; load first page, then "Load more".
6. **Delete duplicate mount-fetches** — data the server already rendered: `adstudio/topbar.tsx:44` (campaigns), `settings-view.tsx:603` + `connections-section.tsx:188` (same Meta-setup call, twice), `email-console.tsx:98`.
7. **Drop `force-dynamic` where it's wrong**: `(legal)/data-deletion/page.tsx:12` (make static like its siblings), `access-unavailable/page.tsx:3`. Add ISR to `audit/page.tsx` (`revalidate` keyed on location).
8. **`optimizePackageImports: ["radix-ui"]`** and remove the no-op `"recharts"` entry (`next.config.ts:14`).

---

## 4. Tier 2 — Ship real speed (the structural code work)

### A. Kill the per-request auth tax (biggest API win)

Every authenticated route pays: `getUser()` network hop → profiles + membership queries (`src/lib/auth/workspace-access.ts:117-130`). None of the 100 routes use the memoized context that pages use.

1. Verify the JWT **locally** (`jose` + project JWT secret / JWKS) instead of calling `supabase.auth.getUser()` per request. Keep `getUser()` only on sensitive mutations where instant revocation matters (billing, publish, team).
2. Put `is_operator` + workspace membership into **custom access-token claims** via a Supabase Auth Hook, collapsing the remaining 2 queries to 0 for most routes; fall back to a 30–60s in-process LRU if you'd rather not do claims yet.
3. Rate limiting (`src/lib/rate-limit.ts:42-77`) is select→update/insert (2–3 round trips); replace with one atomic RPC (`increment_rate_limit`).

Net effect: typical authenticated API request goes from 4–5 network waves to 1–2.

### B. Fix the waterfalls (each is a contained refactor)

| Where | Now | Fix |
|---|---|---|
| `src/lib/adstudio/load-live-bundle.ts:57-134` | up to 23 sequential RTs (loop over 10 campaigns × 2 waves each) | hoist `loadAdStudioBrandAssetRows` into the existing `Promise.all`; filter completeness in the query; one embedded PostgREST select. Target ≤3 RTs |
| `ad-studio/page.tsx:27-34` | 3 loaders chained serially after the above | parallelize; skip starter-bundle INSERT when bundle exists |
| `src/lib/meta-monitor/getMetaMonitorData.ts:71-105` | 2 serial DB RTs before an 8-way parallel Meta wave | one joined query for connection+token |
| `leads/page.tsx:19-28`, `settings/page.tsx:41-64`, `model-control/page.tsx:27-28`, `customer-ad-library-pages.ts:65-75` | independent queries awaited serially | `Promise.all` each pair |
| `home/page.tsx:11-13` | full auth chain for a redirect, then destination repeats it | use `getRequestAuthContext()`; resolve destination in the login action |
| `src/lib/supabase/service.ts:11` | fresh service client built at 77 call sites | wrap in `React.cache()` like the server client already is |

### C. Cache on the server (currently zero)

1. `unstable_cache` + `revalidateTag("workspace:{id}")` for near-static per-workspace data: trial status, provider connections, workspace plan. Invalidate from the mutating routes.
2. **Cache-Control headers** on read-heavy GETs (51/57 currently send none) — see Appendix B for the exact route→header table. Highest value: `drain-status` (`s-maxage=15, stale-while-revalidate=60`), coverage/health/policies views, `meta-targeting-locations` (static reference data → `s-maxage=86400`).
3. `/api/research/ads/search` responses are deterministic per query string — `private, max-age=30` absorbs the search-as-you-type burst.

### D. Shrink the payloads

1. `/api/adstudio/campaigns/[id]/route.ts:21-42` — delete the duplicate block; return the pack only (15→7 queries, payload halves). Add a **narrow QA endpoint** (or `?fields=cloneQa`) for the workbench poll so it stops downloading every creative's `canvas_json` at 3s cadence.
2. `ad-studio/library/page.tsx:25` — explicit columns, `.limit(100)`, keyset pagination. Same for the other unbounded `select("*")` sites (Appendix C).
3. Export renders (`export-render-storage.ts:67`) and fresh sync-path generations return base64 data URLs (~1.5MB per image, +33% overhead) — upload to Storage first and return paths.

### E. Serve images like a CDN, not like an API

`/api/adstudio/media` = per-image: 3 auth round trips + storage download buffered through a Lambda. Options (either works):
- **Batched signed URLs**: one `createSignedUrls(paths, 3600)` per page render; browser talks straight to Supabase Storage CDN.
- Or keep the proxy but make content-addressed paths `public, max-age=31536000, immutable` so Vercel's CDN absorbs repeats (currently `private`).

`research-ad-creatives` already uses public URLs — that's the right pattern (`customer-meta-card.ts:392`).

### F. Database work (SQL in Appendix A — mostly generated, review then run)

1. **Create the 42 missing FK indexes** (37 in `public` — includes hot tables like `adstudio_campaigns`, `adstudio_creatives`, `adstudio_creative_revisions`). Appendix A.1 generates the DDL.
2. **Drop the 137 duplicate index groups** (every INSERT/UPDATE on those tables maintains two identical indexes; `work_queue` and the adstudio tables are write-heavy). Appendix A.2 generates review-then-run DROPs.
3. **Retention policy** — the cheapest "upgrade" available: `ingest_events` (3.5M rows), `agent_decisions` (3.7GB), completed `work_queue` rows. A nightly `pg_cron` purge to a 30–60 day window could take the DB from 9.1GB to ~2GB, at which point the instance's cache actually holds the working set (Appendix A.3).
4. **Replace drain-status counting** with one `GROUP BY job_type, status` view/RPC (53 queries → 1; Appendix A.4).
5. **local-ad-radar text search**: `pg_trgm` GIN index (or tsvector) + a single `.or()` query instead of 48 sequential ILIKEs.
6. **Auth connections**: advisor flags Auth pinned at 10 absolute connections — switch to percentage-based allocation before/when you resize compute (Dashboard → Auth settings).
7. After 2–4 weeks of the new baseline, review the 294 unused-index list and drop what's still unused (careful: stats only cover since June 25).

### G. Push, don't poll (Supabase Realtime — currently 0 uses)

Highest-value conversions, all tables the workers already write:
1. `adstudio_creative_jobs` → replaces the 1Hz generation poll entirely.
2. `meta_publish_plans` → replaces both publish-panel polls.
3. `adstudio_creatives` → replaces the 3s QA poll.
Keep a slow poll (10–15s) as socket-failure fallback. Realtime also inherently solves the hidden-tab problem.

### H. Finish the async story

`creatives/[id]/edit` and `creatives/[id]/layers` hold an HTTP connection up to 5 minutes (`maxDuration = 300`). The 202 + `adstudio_creative_jobs` + poll (soon Realtime) infrastructure already exists for generation — reuse it for these two routes. Also make the sync-generation fallback **fail loudly in production** instead of silently degrading (`campaigns/route.ts:308-336` — the BOM incident in the comments shows this already bit you once).

---

## 5. Tier 3 — Bundle & asset weight (mechanical, parallelizable)

1. **CSS-as-JS → real CSS files** (~175KB of JS removed): `adstudio/styles.ts` (114KB), `new-ad-dialog.tsx:1684`, `brand-studio.tsx:882`, `research-console-styles.ts`, `research-drain-dashboard.tsx:357`, `ad-radar-search-panel.tsx:177`.
2. **Move route-specific CSS out of the root layout** (`layout.tsx:10-14`): `meta-monitor.css` → results page, `landing.css` → the pages using `lp-*`. Then split `globals.css` (165KB) — your REBUILD-PLAN already calls this out.
3. **`dynamic()` the heavy islands**: `StartStudio` (the only `motion` consumer, below the fold on `/`), `NewAdDialog` (94.6KB), `PublishSetupPanel` (58.7KB) — all modal/step-gated.
4. **Get supabase-js out of the layout chunk**: sign-out via a route handler POST (or lazy `import()` in the click handler) in `account-menu.tsx` / `mobile-bottom-nav.tsx` / `self-serve-shell.tsx`.
5. **Images**: `fb-ad-card.tsx:25` → `next/image` with dimensions + priority (likely landing LCP element, currently guaranteed CLS); add `loading="lazy" decoding="async"` to the 24 bare `<img>`s; convert `/adstudio-samples/**` PNGs (1080×1350) to WebP.
6. **Fonts**: delete the duplicate `Inter` on `page.tsx:20`; `preload: false` (or remove) `JetBrains_Mono` — nothing consumes its variable.
7. **Meta Pixel** (`layout.tsx:99-113`): load on marketing routes only, after consent — it currently fires `PageView` on every authenticated page before the consent banner resolves.
8. **Service worker** (`sw-policy.ts`): exclude `/_next/static/` and `/_next/image` from cache-first (they're already immutable/CDN-cached), add an LRU cap for images, and drop navigation interception unless offline support is a real requirement — verify `/offline.html` + both icons exist or the SW never activates and re-registers every load.
9. **Delete dead weight**: 16 orphaned components (~102KB incl. one orphaned recharts import), `@tanstack/react-table` (0 imports), unused `ui/sonner.tsx` wrapper (`next-themes` with it), `hero-lab` if it's not needed in prod (its 28.6KB CSS ships), empty `tmp-shell-preview/`.
10. Video lists: `preload="none"` + `poster` on list-rendered `<video>`s (6 currently `preload="metadata"`) — your own mobile spec calls videos-in-grids a trap.

---

## 6. Tier 4 — Infra: what to buy, with verified prices

### Supabase — this is where the money goes first

Current: **Micro-class compute** (60 conns / 256MB shared_buffers / ~1GB RAM), 9.1GB database, project `ap-southeast-2`. Compute pricing (verified 2026-07-28, [supabase.com/docs/guides/platform/manage-your-usage/compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute)):

| Size | RAM | Monthly |
|---|---|---|
| Micro (now) | 1GB | ~$10 (covered by the $10 credit on paid plans) |
| **Small** | 2GB | **~$15** |
| **Medium** | 4GB | **~$60** |
| Large | 8GB | ~$111 |

- **Do now:** upgrade to **Small (~$15/mo, ~$5 net after credit)**; if research stays co-located more than a month, go **Medium (~$60/mo)** — 4GB RAM finally gives the working set somewhere to live. Resizing restarts the DB (takes ~1–2 minutes) — do it at a quiet hour. Note compute is billed hourly and is **not** covered by the Spend Cap.
- **Disk math favors cleanup over payment:** the retention purge in Tier 2-F.3 shrinks 9.1GB → ~2GB, which both reduces disk cost and makes even Small compute feel much bigger (cache-hit rate).
- **Do next (the structural fix): move `research` off the app database.** Options, in order of preference:
  1. Separate Supabase project for research (the env vars — `HERMES_SUPABASE_URL/…` — already exist as distinct names in `.env.example`, and `docs/runbooks/paid-service-alerts.md:106` already speaks of "main + Hermes projects"). App DB drops to ~600MB; scraper load can never again evict app pages or eat app CPU.
  2. Or plain Postgres in Docker on the VPS next to Hermes (free, same box as the writer; you lose managed backups/PostgREST unless you configure them).
  - Cost of option 1: a second project's compute (Micro ~$10/mo is plenty for the scraper's own queries once counts are fixed).
  - Migration note: the app reads `research` in ~57 call sites via `.schema("research")` — introduce one `researchClient` wrapper pointing at the research project and the blast radius is contained. `research-ad-creatives` storage is already read via public URLs, which keep working from the other project.

### Vercel — nothing to buy for speed

- You're on **Pro** already (the code's own comment: "300 is the Pro plan ceiling", `campaigns/route.ts:23-26`) and pinned to `syd1` — correct next to Sydney Supabase. A plan upgrade would not make the app faster; the latency lives in the DB and the waterfalls.
- **Verify Fluid Compute is ON** (Project → Settings → Functions). It reuses warm instances and cuts cold starts; projects created around when yours was may predate the default-on cutover.
- Enable **Speed Insights** (Tier 0). Included on Pro with generous limits.
- Optional, only after measuring: raise memory on the image-heavy routes (`/api/adstudio/media`, export) via the `functions` block in `vercel.json`.
- Build speed (dev velocity, not runtime): `buildCommand` runs the full test suite on every deploy (`vercel.json:3`); moving tests to CI-only roughly halves deploy time. Also fixes the documented always-red Preview builds (`docs/FIRST_TESTER_PLAN.md:246-249`).

### VPS — don't upgrade it for app speed

The VPS (Hermes + Steel + Uptime-Kuma at 76.13.209.160) does not serve a single user request — upgrading it cannot make the app faster. Its impact on the app is entirely through the shared database, which the split above removes. Before spending anything: `ssh` in, `docker stats`, and check it isn't CPU/RAM-bound for its *own* job (capture throughput). Your capture docs already say the bottleneck is proxy/IP discipline, not compute ("never raise concurrency on one IP", `docs/plans/2026-07-20-meta-capture-rebuild-model-cutover.md:33-36`).
Also reduce its DB chatter at the source: `HERMES_QUEUE_LOOP_INTERVAL_MS` effective 10s in compose → 30–60s in `maintain` mode costs nothing in freshness, and fixing drain-status-style exact counts applies to any worker-side counting too.

### Trigger.dev — fine as-is

`maxDuration: 900` and externalized Playwright are sensible. No plan change indicated.

---

## 7. What NOT to do

- **Don't** upgrade the Vercel plan or move regions — TTFB is DB + waterfalls, not compute or geography (Perth→Sydney is ~50ms once; the Vercel↔Supabase hops are intra-Sydney, ~1–5ms each — the problem is doing 23 of them in a row).
- **Don't** add Redis/Upstash yet — `unstable_cache` + CDN headers + Realtime cover this scale. Revisit at real multi-tenant load.
- **Don't** touch `src/middleware.ts` — it's already minimal and correct.
- **Don't** raise Hermes concurrency to "catch up" after the DB split — your own docs correctly forbid it per-IP.
- **Don't** hand-delete "unused" indexes on day one — the 294-item list reflects only 33 days of stats; drop duplicates (safe) now, review unused in a month.

---

## 8. Suggested order (two-week sprint)

**Day 1 — infra + one-liners:** Tier 0 measurement on; Supabase → Small (or Medium); run Appendix A.1 (FK indexes) + A.2 (duplicate drops, public+research schemas first); `staleTimes`; `optimizePackageImports: ["radix-ui"]`; `(operator)/loading.tsx`.
**Days 2–3 — perceived speed:** trial-pill Suspense fix; poll backoff + visibility gating; delete duplicate mount-fetches; Suspense on slow pages; force-dynamic cleanup.
**Days 4–5 — hot paths:** `load-live-bundle` rewrite; `campaigns/[id]` dedupe + QA-only poll target; drain-status GROUP BY view; cache headers (Appendix B).
**Week 2 — structural:** local JWT verification + claims; media signed-URLs/CDN; Realtime for the three job tables; retention purge + `pg_cron`; decide and schedule the research-DB split; move edit/layers to 202+jobs; CSS-as-JS → CSS files; root-layout CSS split.

Rough expected outcome: authenticated navigations go from "blank pause, then page" to instant skeleton + ~200–400ms data; `/ad-studio` server time drops several hundred ms; generation UX stops hammering 600 requests; DB contention from the scraper disappears entirely after the split.

---

## Appendix A — SQL (run in Supabase SQL editor; review output before executing generated DDL)

### A.1 Generate CREATE INDEX for all unindexed foreign keys

```sql
SELECT format(
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.%I (%s);',
  c.conname || '_idx', n.nspname, t.relname,
  (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.ord)
     FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum)
) AS ddl
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.contype = 'f'
  AND n.nspname IN ('public','research')
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND (i.indkey::int2[])[0:cardinality(c.conkey)-1] @> c.conkey
      AND c.conkey <@ (i.indkey::int2[])[0:cardinality(c.conkey)-1]
  )
ORDER BY 1;
```
Run the output statements one at a time (CONCURRENTLY can't run inside a transaction block). The advisor list has 42 (37 `public`, 5 `research`).

### A.2 Generate DROPs for exact-duplicate indexes

```sql
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I;  -- duplicate of %I',
              n.nspname, i2.relname, i1.relname) AS ddl
FROM pg_index x1
JOIN pg_index x2 ON x1.indrelid = x2.indrelid
 AND x1.indexrelid < x2.indexrelid
 AND x1.indkey = x2.indkey
 AND coalesce(x1.indexprs::text,'') = coalesce(x2.indexprs::text,'')
 AND coalesce(x1.indpred::text,'') = coalesce(x2.indpred::text,'')
 AND x1.indisunique = x2.indisunique
JOIN pg_class i1 ON i1.oid = x1.indexrelid
JOIN pg_class i2 ON i2.oid = x2.indexrelid
JOIN pg_class t  ON t.oid  = x1.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname IN ('public','research','legacy_archive')
  AND NOT x2.indisprimary
  AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x2.indexrelid)
ORDER BY 1;
```
Advisors found 137 duplicate groups (70 `public`, 27 `research`, 39 `legacy_archive`, 1 `private`); this query reproduces 136 (excludes `private` by design). Keep one per group; skip anything backing a constraint. Tested read-only against the live DB 2026-07-28.

### A.3 Retention sketch (tune windows first, then schedule via pg_cron)

```sql
-- inspect volume per age bucket before deleting anything:
SELECT date_trunc('week', created_at) w, count(*), pg_size_pretty(sum(pg_column_size(t))) 
FROM research.ingest_events t GROUP BY 1 ORDER BY 1;

-- example purge (batched):
DELETE FROM research.ingest_events WHERE created_at < now() - interval '45 days'
  AND ctid IN (SELECT ctid FROM research.ingest_events
               WHERE created_at < now() - interval '45 days' LIMIT 50000);
-- same pattern: research.agent_decisions (45–60d), research.work_queue done/failed rows (14–30d)
-- then: VACUUM (ANALYZE) research.ingest_events;  -- and consider pg_repack/full during a window
SELECT cron.schedule('research-retention', '0 18 * * *', $$ /* purge batches here (18:00 UTC = 02:00 Perth) */ $$);
```

### A.4 Drain-status: 53 counts → 1 query

```sql
CREATE OR REPLACE VIEW research.v_work_queue_drain AS
SELECT job_type, status, count(*) AS n, min(created_at) AS oldest
FROM research.work_queue
WHERE status IN ('pending','claimed','failed','blocked')
GROUP BY 1, 2;
```
Have `/api/operator/research/drain-status` read this once (estimates via `pg_class.reltuples` are also fine for a dashboard).

### A.5 Snapshot + reset query stats

```sql
CREATE TABLE IF NOT EXISTS ops_pgss_snapshot_20260728 AS
  SELECT now() AS taken_at, * FROM extensions.pg_stat_statements ORDER BY total_exec_time DESC LIMIT 200;
SELECT pg_stat_statements_reset();
```

## Appendix B — Cache-Control targets (51/57 GETs currently send nothing)

| Route | Header |
|---|---|
| `/api/operator/research/drain-status` | `s-maxage=15, stale-while-revalidate=60` |
| `/api/operator/research/coverage` | `s-maxage=60, stale-while-revalidate=300` |
| `/api/operator/research/health` | `s-maxage=30, stale-while-revalidate=120` |
| `/api/operator/research/policies` | `s-maxage=60, stale-while-revalidate=300` |
| `/api/operator/research/skills` | `s-maxage=300` |
| `/api/research/ads/search` | `private, max-age=30` |
| `/api/adstudio/meta-targeting-locations` | `public, s-maxage=86400` (static reference data) |
| `/api/trial/status` | `private, max-age=60` |
(`/api/research/local-ad-radar` and `/api/adstudio/media` already have good headers — keep.)

## Appendix C — Unbounded / over-wide queries to tighten

- `ad-studio/library/page.tsx:25` — `select("*")`, no limit, full `canvas_json` per creative.
- `api/adstudio/campaigns/route.ts:121-125` — all workspace campaigns, unbounded.
- `api/operator/research/coverage|policies|health|meta-api-validation` — `select("*")`, no limit (up to ~3,300 rows).
- `ad-studio/page.tsx:116`, `operator/research/page.tsx:106,117`, `onboarding/page.tsx:42` — same pattern.
- `api/settings/team/invite/route.ts:71-86` — paginates the entire Auth user list to find one email; replace with an indexed lookup.

## Appendix D — Files safe to delete (verified zero importers)

`public-ad-radar-dialog.tsx`†, `brand-studio-styles.ts`, `CampaignsManagement.tsx`, `ui/dropdown-menu.tsx`, `AdsSummaryTable.tsx`, `audit-pdf-button.tsx`†, `brand-color-swatch.tsx`, `audit-charts.tsx` (orphaned recharts), `ad-radar-advertiser-search.tsx`, `InstallAppPrompt.tsx`, `landing/home-motion.tsx`, `brand-voice-card.tsx`, `brand-details-cards.tsx`, `setup-checklist.tsx`, `confirm-delete-dialog.tsx`, `first-run-explainer.tsx`, plus `@tanstack/react-table` from package.json.
† = double-check first; grep matched no importers in this snapshot but both look recently touched.

## Sources

- Supabase compute pricing & credits: https://supabase.com/docs/guides/platform/manage-your-usage/compute
- Supabase connection management: https://supabase.com/docs/guides/database/connection-management
- Advisor remediation: https://supabase.com/docs/guides/database/database-linter (lints 0001 unindexed FKs, 0009 duplicate index)
- Vercel functions config / Fluid Compute: https://vercel.com/docs/functions/functions-api-reference, https://vercel.com/docs/project-configuration/vercel-ts
- Live data: Supabase project `uwwbvdloschaccycjozr` (`pg_stat_statements`, `pg_stat_user_tables`, advisors API), Vercel project `prj_8gJyKjHN4miNOWK7ReA4vKDXxc4B`.
