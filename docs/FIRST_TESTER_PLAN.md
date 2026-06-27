# Blockwise — First-Tester Readiness Plan

**Generated:** 2026-06-12 · Multi-agent code review of every surface (12 review areas, findings verified against code and the live production DB/URL).
**Audience:** a code agent executing tasks one at a time, in order.
**Scope:** everything needed to put the app in front of the FIRST external tester and make it feel finished. **Security is explicitly out of scope** — a dedicated security review happens after this plan is complete. Do not add security work here; do not remove existing security controls.
**Supersedes:** `docs/LAUNCH_PLAN.md` (June 10 plan — ~90% done; its open items are folded in here).

## How to work this plan

- Do phases in order. Within a phase, tasks are independent unless noted.
- Before each task, READ the cited files first — line numbers may have drifted.
- After each task: `npm run typecheck` && `npm test` (node is not on PATH on this machine: use `C:\Users\steve\scoop\apps\nodejs\current\node.exe` / `npm.cmd`). Commit with the task ID in the message. One task = one commit.
- Runtime verification happens on Vercel Preview/Production URLs only (per `AGENTS.md`). Production: https://blockwise.sale (alias https://blockwise-tan.vercel.app).
- Obey `AGENTS.md` at all times. Tasks below that change auth-adjacent flows, delete routes, or add migrations are owner-authorized by this plan.
- If a task's premise turns out to be already fixed, mark it `✅ ALREADY DONE`, commit the plan-doc edit, move on.

---

## Phase 1 — First-session blockers (the tester WILL hit these)

### T1-1: Persist the seeded starter campaign — every first edit currently fails with "Could not save: Campaign not found." 🔴 BLOCKER
- **Files:** `src/app/(customer)/ad-studio/page.tsx` (buildTrialStarterBundle ~71–103, buildDraftBrandBundle ~111–160), `src/lib/adstudio/load-live-bundle.ts` (~109–138), `src/app/api/adstudio/campaigns/[id]/draft/route.ts`
- **Problem:** All three first-session bundle paths (trial starter, draft-brand, approved-kit-with-no-campaign) build a campaign pack in memory and never persist it. The workbench autosaves on any edit/variant click via PATCH `/api/adstudio/campaigns/<id>/draft`, which 404s "Campaign not found." and pins a persistent error in the footer. A trial tester sees this on their very first interaction, before pressing Generate.
- **Fix:** In all three call sites, call `persistAdStudioCampaignPack(supabase, pack, userId)` (already used by POST `/api/adstudio/campaigns`) when building the seeded pack. Campaign IDs are deterministic, so repeat loads upsert the same row. Do NOT reserve a trial credit for the seed. As a backstop, also make the draft route self-heal: when `loadExistingCampaignPack` returns null, persist the submitted pack instead of returning 404.
- **Accept:** Fresh trial user opens `/ad-studio?first=1`, clicks between variant tiles and edits copy — no error toast, footer shows saved state; reloading shows the edits.

### T1-2: Email-confirm fallback redirects to a 404, and the redirect can drop the session across domains 🔴 BLOCKER
- **Files:** `src/app/auth/confirm/route.ts` (line 6 `DEFAULT_NEXT_PATH = "/start"`, line ~51 redirect base), `tests/signup-auth.test.ts` (line ~42), `src/components/onboarding/start-choice.tsx` (dead)
- **Problem:** (a) `/start` does not exist (live 404 verified) — any confirm link with a missing/malformed `next` lands on a 404. (b) The redirect resolves against `NEXT_PUBLIC_APP_URL`; a tester who signed up on the other live domain (`blockwise-tan.vercel.app` vs `blockwise.sale`) gets bounced cross-origin and loses the just-set session cookie.
- **Fix:** Change `DEFAULT_NEXT_PATH` to `"/self-serve"`. Change the redirect to `NextResponse.redirect(new URL(redirectPath, requestUrl.origin))`. Update the test assertion. Delete `src/components/onboarding/start-choice.tsx` (dead). **Owner action (note, don't block):** pick one canonical domain and 308-redirect the other in Vercel domain settings.
- **Accept:** Confirm link with no `next` param lands on `/self-serve` logged-in, on the same origin the user clicked from.

### T1-3: Self-serve setup checklist "Confirm your brand" can never complete (queries a column that doesn't exist) 🔴 BLOCKER
- **Files:** `src/app/(customer)/self-serve/page.tsx` (lines ~17, ~26)
- **Problem:** Queries `adstudio_brand_kits.select("name")` but the column is `business_name` (verified against live prod schema). The query silently errors; the checklist item never completes.
- **Fix:** `.select("business_name")` and check `kit.business_name?.trim()`.
- **Accept:** A workspace with a brand kit shows the brand checklist item complete on `/self-serve`.

### T1-4: Ad Radar search returns every ad ~4 times 🔴 BLOCKER
- **Files:** `src/app/api/research/ads/search/route.ts`
- **Problem:** The card view fans out one row per area match (live prod: 4,143 rows, only 1,045 distinct card_ids). Search results show the same ad ~4×.
- **Fix:** Raise the query limit to ~200, dedupe rows by `card_id` before normalising (reuse/port `dedupeRows` from `src/lib/research/public-ad-radar.ts` ~522–534), then slice to 50.
- **Accept:** Searching "ray white" on `/ad-radar` returns unique ads only.

### T1-5: Ad Radar detail pages render broken images/videos (~90% of ads) 🔴 BLOCKER
- **Files:** `src/lib/research/ad-library-api.ts` (`normaliseMedia`/`addMedia` ~211–249), `src/lib/research/customer-meta-card.ts` (`normaliseMediaUrl`, ~272)
- **Problem:** Hermes stores relative bucket paths (`media-blobs/<checksum>.<ext>`); the detail-page normaliser uses them raw as `src`.
- **Fix:** Export `normaliseMediaUrl` from `customer-meta-card.ts` and apply it to storage paths in `addMedia`: non-http(s) paths get URL-encoded per segment and prefixed `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/research-ad-creatives/`.
- **Accept:** Opening several `/ad-radar/ads/[id]` pages on Preview shows media rendering.

### T1-6: Scheduled lead sync floods delivery attempts + approval requests every 15 minutes 🔴 BLOCKER
- **Files:** `src/lib/providers/meta-leads.ts` (~125–156)
- **Problem:** `recordDeliveryAttempt` runs for EVERY incoming lead on every 15-min sync regardless of `result.inserted` — one lead accrues ~96 delivery attempts/approval requests per day for 7 days (~672 rows), flooding `/approvals` and `lead_delivery_attempts`.
- **Fix:** Wrap the delivery-action loop in `if (result.inserted) { ... }`. Optionally add a unique index on `lead_delivery_attempts (workspace_id, lead_id, destination_type, destination_label)` as a backstop migration.
- **Accept:** Unit test: re-syncing the same lead twice records exactly one delivery attempt.

### T1-7: Scheduled provider-report sync fails on every run (snake_case/camelCase) 🔴 BLOCKER
- **Files:** `trigger/provider-sync.ts` (~18–34)
- **Problem:** Selects `workspace_id` then reads `connection.workspaceId` (undefined) → NOT NULL violation in `sync_runs` → the 6-hourly job fails for every connected workspace; `last_sync_at` in Settings goes permanently stale.
- **Fix:** Replace the unsafe cast with explicit mapping `{ workspaceId: c.workspace_id, provider: c.provider }`. Add a regression test feeding a snake_case row through.
- **Accept:** Test passes; deployed task run succeeds in the Trigger.dev dashboard.

### T1-8: Generation routes have no `maxDuration` — Vercel timeout mid-generation silently burns a trial credit 🔴 BLOCKER
- **Files:** `src/app/api/adstudio/campaigns/route.ts`, `src/app/api/adstudio/campaigns/[id]/generate/route.ts`, `src/app/api/adstudio/copy/route.ts`
- **Fix:** `export const maxDuration = 120;` on the two campaign routes, `60` on copy (mirrors `generate-image/route.ts:18`).
- **Accept:** Constants present; build green.

### T1-9: Research health endpoint is red right now — 264 blocked jobs 🔴 BLOCKER (ops, not code)
- **Problem (verified live):** `/api/health/research` returns 503; `research.v_health.blocked_job_count = 264` (threshold 100): 238 blocked `blockwise-ad-collector` jobs, 25 orphan `blockwise-page-recovery` jobs (no handler exists anywhere — grep verified), 1 content-run.
- **Fix:** (a) Delete the orphans: `delete from research.work_queue where job_type = 'blockwise-page-recovery';` and remove `HERMES_UNRESOLVED_PAGE_RECOVERY_LIMIT` from `infra/coolify/docker-compose.research.yml`. (b) Requeue recoverable ad-collector jobs via `POST /api/operator/research/jobs/<id>/requeue` or bulk-update obsolete ones to a terminal status. (c) Add an auto-expiry to the Hermes supervisor tick (`hermes/tools/research-runtime/bin/supabase-supervisor.mjs`): blocked jobs older than 7 days → archived.
- **Accept:** `/api/health/research` returns green/amber, not 503.

---

## Phase 2 — Honest product: publish flow, leads, and error messaging

The theme: never show the tester a state that is fake, dead, or unactionable.

### T2-1: Publish dead-end — env-flag checklist item is presented as user-resolvable 🔴 HIGH
- **Files:** `src/app/api/adstudio/publish-readiness/route.ts` (~63–68), `src/components/adstudio/panels/publish-panel.tsx` (~97, 209–216, 335–348)
- **Problem:** With `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` in prod (until Meta App Review), the checklist shows "Enable live publishing for this workspace" — un-completable by any user action — and the Publish button says "Resolve all readiness items above."
- **Fix:** When writes are disabled, return the item with `blocked: true` and copy "Live publishing is in final platform review — export your creatives, or we'll email you when it opens." Render blocked items as info (not amber warning); when it's the only unmet item, replace the hint with "Live publishing isn't available yet — use Export creatives to launch manually" and keep Export visually primary.
- **Accept:** With the flag off on Preview, the publish panel reads as an honest "coming soon + export" state, not a broken checklist.

### T2-2: "Published" success banner is dishonest; no plan status surface; failures invisible 🔴 HIGH
- **Files:** `src/components/adstudio/panels/publish-panel.tsx` (~172–175, 323–327), new `src/app/api/integrations/meta/publish-plans/[id]/route.ts`
- **Problem:** A non-null triggerRunId renders "Published", but the plan is only QUEUED; the worker creates everything PAUSED on Meta. No GET endpoint exists for plan status, nothing polls, worker failures never reach the tester. Dead client checks reference fields the route never returns.
- **Fix:** Add `GET /api/integrations/meta/publish-plans/[id]` returning `{status, lastError, reconciledObjects counts}`. In the panel: after queueing show "Queued — creating your paused Meta campaign", poll the GET, then "Live on Meta (paused) — activate after review" for `paused_live`, and surface `lastError` for failed. Delete the dead `body.status` checks.
- **Accept:** Panel reflects real plan state transitions; a forced worker failure surfaces in the UI.

### T2-3: Re-publish after approval wipes reconciliation state and double-publishes to Meta 🔴 HIGH
- **Files:** `src/app/api/adstudio/export-packages/[id]/publish/route.ts` (~92–129), `src/lib/providers/meta-publish-queue.ts`
- **Problem:** A second Publish click rebuilds the plan (resetting `reconciledObjects` to empty), upserts over the same row, and re-queues — the worker re-creates the full campaign tree on Meta.
- **Fix:** Before persisting, load the existing plan for the same idempotency key; if status is `approved`/`publishing`/`paused_live`, return it as-is. When rebuilding a draft, carry forward reconciled objects/logs. Pass `idempotencyKey: plan.idempotencyKey` to `tasks.trigger`.
- **Accept:** Unit test: double-publish returns the same plan, single queue dispatch.

### T2-4: Publish plans stuck in "publishing"/"applying" forever when a worker throws 🔴 HIGH
- **Files:** `src/lib/providers/meta-publish-worker.ts` (~41–57), `src/lib/providers/meta-mutation-worker.ts` (~40–49), `src/app/api/approvals/[id]/route.ts` (~70–96)
- **Fix:** try/catch around the worker bodies after marking `publishing`/`applying`: on throw, persist status `failed` + `lastError`, rethrow. In the approvals route, queue FIRST (in try/catch), only persist `approved` after `tasks.trigger` succeeds; on queue failure return 502 "Approved, but job dispatch failed — retry from Approvals."
- **Accept:** Forced token-missing failure leaves the plan `failed` with a readable lastError, not zombie `publishing`.

### T2-5: BLOCKWISE_ENABLE_PROVIDER_WRITES kill switch doesn't actually kill 🔴 HIGH
- **Files:** `src/lib/providers/meta-publish-worker.ts`, `src/lib/providers/meta-mutation-worker.ts`, `src/lib/providers/lead-delivery-worker.ts`, `src/app/api/approvals/[id]/route.ts`, `docs/runbooks/rollback.md`
- **Problem:** The rollback runbook claims workers short-circuit when the flag is false; grep shows the flag is only read in two Vercel routes. Approving a plan executes real Meta writes regardless.
- **Fix:** Guard at the top of each worker `executeXById`: flag !== "true" → persist "Provider writes are disabled" result without calling Meta (never leaving `publishing` status). Gate the queueing branches in the approvals route the same way. Update rollback.md to note the flag must be set in BOTH Vercel and the Trigger.dev project env.
- **Accept:** With flag off, approving a plan does not hit Meta and records a clear skipped state.

### T2-6: Approvals are invisible to everyone who needs them 🔴 HIGH
- **Files:** `src/app/(operator)/approvals/page.tsx`, `src/lib/publishing/approvals.ts` (~37–45), `src/components/approvals/approval-actions.tsx`, `src/components/sidebar-nav.tsx`, `src/components/adstudio/panels/publish-panel.tsx` (~177–187)
- **Problem (three parts):** (a) The operator `/approvals` page filters to the operator's own first workspace — the tester's publish-approval requests will never appear. (b) Customers (owner/admin are allowed by `SURFACE_RULES.approvals`) have no route to approvals at all — lead-delivery approvals stall forever. (c) The publish panel renders "approval pending" as a hard error.
- **Fix:** (a) When `access.isOperator`, list approvals across ALL workspaces (omit the workspace filter; pass each row's own `workspace_id` to `ApprovalActions`). Filter the queue/metric to `status='requested'`; map pill tones by status (requested=amber, approved=green, rejected=rose); add an empty state. (b) Add a customer-accessible approvals page (move out of the operator-gated layout, keep `requirePageSurfaceAccess('approvals')`) and a sidebar entry for owner/admin. (c) In the publish panel, when the response carries an approvalRequestId, show an amber "Submitted for review — your campaign will be queued once approved" state instead of a red error, keeping the checklist intact (also: render returned blockers in a separate list rather than overwriting the readiness checklist state).
- **Accept:** Tester publish creates an approval the operator sees from their own account; tester sees "submitted for review", not an error.

### T2-7: Readiness checklist omits approval + compliance gates (first Publish click surprise-fails) 🟠 MEDIUM
- **Files:** `src/app/api/adstudio/publish-readiness/route.ts`, `src/lib/publishing/readiness.ts`
- **Fix:** Add "Compliance check passed" and "Approval" entries to the readiness checklist (read campaign compliance status + latest approval).
- **Accept:** All-green checklist → Publish does not produce new unexpected blockers.

### T2-8: Dead controls in publish/settings — remove or wire 🟠 MEDIUM
- (a) **"Require approval before publishing" toggle does nothing** (`src/app/(customer)/settings/workspace-section.tsx` ~51–57; column read nowhere). Replace with static copy "All campaigns are reviewed before going live during early access."
- (b) **"Lead destination" selector in Ad settings does nothing** (`src/components/adstudio/panels/campaign-panel.tsx` ~145–151; local state only). Remove it; replace with a read-only link to Settings → Connections where the real one lives.
- (c) **Suburb targeting claim is false** (`publish-panel.tsx` ~250–256 says "local audience — {suburb}" but `buildControls` hardcodes country targeting). Change the copy to "Audience: Australia-wide (broad targeting recommended for housing ads)" until radius targeting ships.
- **Accept:** No visible control that has zero effect.

### T2-9: Meta OAuth cancel/failure lands on /results with zero feedback 🟠 MEDIUM
- **Files:** `src/app/(customer)/results/page.tsx` (`resolveOAuthNotice` ~27–40)
- **Fix:** Add a `missing_code` branch ("Meta connection was cancelled or didn't complete. Try again.") and a catch-all error branch with a generic safe message (never echo the raw error).
- **Accept:** Cancelling the Facebook consent dialog shows a notice on return.

### T2-10: Publish/readiness can pick a stale revoked Meta connection 🟠 MEDIUM
- **Files:** `src/lib/providers/provider-connections.ts` (~60–65), `src/app/api/adstudio/export-packages/[id]/publish/route.ts` (~71), `src/app/api/adstudio/publish-readiness/route.ts` (~34)
- **Fix:** Order `listProviderConnections` by `updated_at` desc; in both routes prefer `status === 'connected' || 'needs_attention'` rows.
- **Accept:** After disconnect+reconnect, publish readiness agrees with Settings.

### T2-11: Leads page hides the actual lead contact details and delivery state 🔴 HIGH
- **Files:** `src/app/(customer)/leads/page.tsx`, `src/lib/leads/rows.ts`
- **Problem:** Email/phone are in the row payload but never rendered — a real-estate tester cannot see the contact the product exists to capture. `manual_review` delivery state is invisible to customers (no surface reads `lead_delivery_attempts`).
- **Fix:** Add Email + Phone columns (table + mobile cards). Add a Delivery column from the latest `lead_delivery_attempts` row per lead (one extra query in `listLeadRowsWithDedupe`).
- **Accept:** A synced lead shows name, email, phone, delivery status on `/leads`.

### T2-12: Delete the dead duplicate-matches UI; make the duplicate pill real 🟠 MEDIUM
- **Files:** `src/app/(customer)/leads/page.tsx` (~106–126), `src/lib/leads/rows.ts`, `src/lib/providers/meta-leads-worker.ts` (~122–129)
- **Problem:** The "Duplicate matches" panel always renders zeros/none (dead `incoming` plumbing, would print raw UUIDs); the "Possible duplicate" pill can never appear (writer skips insert exactly when a duplicate IS found; unique constraint blocks it); "We merge duplicates" copy is false (nothing merges).
- **Fix:** Delete the panel + `incoming` plumbing. In `upsertLead`, when `duplicateOfLeadId` is non-null, insert the dedupe record with it set (migrate the unique constraint from `(workspace_id, dedupe_key)` to `(workspace_id, lead_id)`). "Duplicates merged" metric → count of `duplicateCandidate` rows; copy → "We flag duplicates". Metric grid cols-4 → cols-3.
- **Accept:** Second lead with the same email shows the "Possible duplicate" pill; no all-zero panel.

### T2-13: Valid-lead KPIs are permanently zero (no labelling write path) — hide or ship labelling 🔴 HIGH
- **Files:** `src/lib/meta-monitor/getMetaMonitorData.ts` (~231–247), `src/app/(customer)/leads/page.tsx` (~15, 28), `src/lib/leads/rows.ts` (~66), new `src/app/api/leads/[id]/quality/route.ts`
- **Problem:** Nothing anywhere writes `lead_quality_labels` — 4 of 6 KPI cards and 3 of 5 charts on `/results` are dead zeros for every live account; `/leads` quality is always "Unlabelled". The two readers even disagree on vocabulary ('High intent' vs 'valid').
- **Fix (smallest honest v1):** Add a quality dropdown on each `/leads` row backed by `PATCH /api/leads/[id]/quality` that upserts `lead_quality_labels` with ONE shared vocabulary (`valid` / `invalid` / `high_intent`); update both readers to that vocabulary. If this can't ship before the tester, instead hide the valid-lead cards/charts on `/results` and show leads-only KPIs.
- **Accept:** Labelling a lead "valid" moves the `/results` valid-lead KPIs; or the dead KPIs are gone.

### T2-14: Stop fabricating valid leads as 72% of platform leads 🟠 MEDIUM
- **Files:** `src/lib/providers/meta-reporting.ts` (line ~77)
- **Fix:** Delete the `Math.floor(leads * 0.72)` line; set validLeads 0 (or join real labels). Update affected tests.
- **Accept:** `reporting_snapshots` no longer stores invented numbers tagged "live".

### T2-15: Remove the fake "email" lead destination 🟠 MEDIUM
- **Files:** `src/app/(customer)/settings/connections-section.tsx` (~46, 344–366), `src/lib/providers/lead-delivery-worker.ts`
- **Problem:** "Email" destination just POSTs JSON to a URL; no email is ever sent; "crm" is indistinguishable from "webhook".
- **Fix:** Remove `email` from `META_LEAD_DESTINATION_TYPES` (merge crm into webhook or label both "Webhook / CRM endpoint") until real email delivery exists.
- **Accept:** Settings offers only destinations that work as labelled.

### T2-16: Raw machine codes and silent failures in the money paths 🟠 MEDIUM (batch)
- (a) **Trial limit errors:** map `credit_limit_reached` → "You've used all 10 free ad packs. Upgrade to keep generating." and `trial_expired` → "Your free trial has ended…" in `src/lib/adstudio/generation-trial.ts` (~143–147); keep the machine reason in a `code` field.
- (b) **"Manage billing" shows `billing_not_configured`:** in `src/app/(customer)/settings/billing-section.tsx` prefer `data.message`; better, hide the button when `stripeCustomerId` is null.
- (c) **Trial plan card shows "Up to 0 agent runs / mo":** in `billing-section.tsx` (~79), for plan.key 'trial' show "10 free ad packs · 7-day trial" and hide the agent-runs line when 0.
- (d) **Login swallows `?error=confirm_failed`:** in `src/app/login/page.tsx` read searchParams and render "That confirmation link is invalid or has expired…" above the form.
- (e) **Signup with an existing email claims "Check your email":** in `signup-form.tsx` (~119–140), when `data.user.identities?.length === 0`, show "An account with this email already exists" with /login + /forgot-password links.
- (f) **Reset-password success never communicated:** show a brief success state then `router.replace("/home")` (the /login redirect bounces straight into the app); lengthen the 8s "expired" timer to ~15s with softer copy.
- (g) **No-workspace users hit an infinite redirect loop:** `src/lib/auth/page-guards.ts` redirects failures to `/results?error=access_denied`, which itself guards. Redirect to a guard-free terminal page (e.g. `/login?error=no_workspace` after sign-out, or a minimal `/no-access` page).
- **Accept:** Each path shows a human sentence; no redirect loop (test with a user that has zero workspace_members rows).

### T2-17: Onboarding wizard's brand inputs are silently ignored by trial generation 🟠 MEDIUM
- **Files:** `src/lib/adstudio/trial-brand-kit.ts`, `src/components/onboarding/onboarding-wizard.tsx` (~224–263)
- **Problem:** The wizard saves the kit as `pending_user_review`; trial generation only looks for an APPROVED kit and falls back to a generic navy kit — the colour/tone/logo the tester entered never appears in their ads.
- **Fix:** Have the wizard save with `review_status 'approved'` (the user explicitly confirmed the values), or make `resolveAdStudioGenerationBrandKit` check the draft kit for trial workspaces before falling back.
- **Accept:** Brand colour set in onboarding shows up in the first generated pack.

### T2-18: Onboarding "Connect Meta" dumps the user out of the wizard onto /results 🟡 LOW
- **Files:** `src/components/onboarding/onboarding-wizard.tsx` (~114, 449), `src/app/api/integrations/meta/connect/route.ts` (~26)
- **Fix:** Pass `returnPath=/onboarding` through the connect URL into the OAuth state (allowlist-validate), or finish onboarding before navigating.
- **Accept:** Connecting Meta mid-wizard returns to the wizard.

### T2-19: Brand Studio demo-kit traps 🟠 MEDIUM
- **Files:** `src/app/(customer)/ad-studio/brand/page.tsx` (~16), `src/app/api/adstudio/brand-kits/[id]/route.ts` (~56–74), `src/components/adstudio/brand-studio.tsx`, `src/components/adstudio/use-brand-kit.ts` (~7–28), `src/components/adstudio/preview.tsx` (~227)
- **Problem:** Kit-less workspaces get the fictional "Northstar Realty" kit with no banner; Save → confusing 400 or a 500 TypeError (`rowToBrandKit(null)`); trial ad previews show the fictional domain `northstarrealty.com.au` under the tester's own ads.
- **Fix:** (a) PATCH route: `if (!data) return 404 "Brand kit not found."` before `rowToBrandKit`. (b) Brand page: when no kit exists, render a "Scan your website to create your brand kit" empty state instead of the demo kit in the editor (or disable Save/Approve until first extract). (c) `use-brand-kit.ts`: fallback domain → empty string (hide the `<small>` when empty), fallback name → `brandKit.identity.businessName ?? "Your agency"`.
- **Accept:** Fresh workspace cannot crash Brand Studio; no fictional domain in previews.

---

## Phase 3 — Delete the dead surface (≈45 orphaned/stub endpoints + dead jobs)

Per `AGENTS.md`: delete > simplify. Run `npm run check` after each batch; some tests read route source files — update or delete those assertions deliberately.

### T3-1: Delete the five fake/stub Ad Studio endpoints 🟠 MEDIUM
`src/app/api/adstudio/variants/[id]/score/route.ts` (501), `creatives/[id]/export/route.ts` (501), `export-packages/[id]/route.ts` (returns hardcoded "ready" for ANY id), `jobs/route.ts` (fabricates queued jobs that never run), `brand-kits/[id]/rescan/route.ts`, `creatives/[id]/render/route.ts`. Also remove the now-dead `rescanKit` from `src/components/adstudio/use-brand-kit.ts`.

### T3-2: Delete the 17 orphaned Ad Studio routes (parallel CRUD/compliance/creative pipeline with zero callers) 🟠 MEDIUM
List per review: `bulk-generate`, `campaigns/[id]/generate` + `regenerate` + `variants`, `compliance/check` + `fix` + `reports/[id]`, `creatives` (+`[id]`, `[id]/regenerate-background`), `export-packages` (root), `provider-runs`, `variants/[id]` (+`approve`), `brand-kits` (root GET). **Exception:** if you keep `campaigns/[id]/generate`, you must instead port its in-flight dedup guard to the real generation route — see T3-3. Update `tests/adstudio-generation-trial.test.ts:8` and `tests/adstudio-real-loop-regressions.test.ts:185` which read these files.

### T3-3: Port the server-side generation dedup guard to the route the UI actually calls 🔴 HIGH
- **Files:** `src/app/api/adstudio/campaigns/route.ts`
- **Problem:** The B5 dedup map guards `campaigns/[id]/generate` — which nothing calls. The real route (POST `/api/adstudio/campaigns`) has only a client-side useRef guard; duplicate fires each burn a trial credit.
- **Fix:** Copy the `inFlightGenerations` map + dedup key (workspaceId + body hash) into the campaigns POST; return 409 while in flight; delete in `finally`.
- **Accept:** Two concurrent identical POSTs → one generation, one 409.

### T3-4: Delete orphaned customer/operator routes and dead modules 🟡 LOW
- Customer: `/api/leads`, `/api/compliance` (hardcoded sample-sentence demo), `/api/approvals` GET, `/api/model-profiles` root GET, `/api/provider-sync`, `/api/operator/content-runs/[id]`, `/api/research/ads` + `[id]` (keep `export` only if you wire an "Export CSV" button).
- Operator research: `jobs/[id]/retry` (weaker duplicate of requeue) and the other server-rendered-console duplicates listed in the review, OR document the keepers as curl/ops endpoints in a runbook. Keep `/api/operator/research/health` (tested) — document it.
- Dead modules: `src/lib/research/supabase-writer.ts` (zero importers).
- Trigger: delete `trigger/adstudio.ts` (14 stub tasks, never triggered, several fabricate success), `runAgentWorkflow` in `trigger/agent-workforce.ts` (fakes completed agent runs with confidence 0.8), `syncProviderWorkspaceTask` (never triggered). Update rollback.md's task list.
- Repo debris: `git rm .write-test`; trim `.vercelignore` (drop `$null` and the deleted html files).
- **Accept:** `npm run check` green; grep confirms no imports of deleted files.

### T3-5: Swipe-file "Use in Ad Studio" is a false promise 🟠 MEDIUM
- **Files:** `src/components/research/ad-card-actions.tsx`, `src/app/api/research/swipe-file/[id]/send-to-adstudio/route.ts`, `src/components/adstudio/new-ad-dialog.tsx`
- **Fix:** Either wire the handoff (New Ad dialog offers `handoff_status='sent_to_adstudio'` ads as "From your swipe file" prefill) or merge "Use" into "Save" with copy "Saved — pick it up in Ad Studio → New ad → Ad Radar". Pick one; don't leave the promise.

### T3-6: Data-layer cleanup migration 🟡 LOW
- New migration: move `public.adstudio_performance_imports` to `legacy_archive`; drop the six unreferenced `v_operator_*` views; **ask the owner** about `research.target_manifest` + `research.source_fetch_log` (legal-register vocabulary, zero code references — almost certainly committed from the DraftCheck project) then archive them.
- Add a migration creating the `research-ad-creatives` public storage bucket (currently only created at Hermes runtime; `customer-meta-card.ts` builds public URLs to it).
- Fix `supabase/seed.sql` idempotency (reporting_snapshots insert duplicates on re-run).
- Fix the phantom column query: `src/lib/operator/overview.ts:279` selects `leads.name` which doesn't exist → silently blank recent-leads feed. Remove `name` from the select and from `LeadRow`.

---

## Phase 4 — Observability, CI, and deploy truth

### T4-1: Sentry is half-dead — client never initialized, Trigger.dev runtime never initialized 🔴 HIGH
- **Files:** `next.config.ts`, `sentry.client.config.ts` (dead), `sentry.server.config.ts` (dead), `src/instrumentation.ts`, new `src/instrumentation-client.ts`, `trigger.config.ts`
- **Fix:** (a) Move the client init into `src/instrumentation-client.ts` (Next 16 loads it natively); delete both dead `sentry.*.config.ts` files (server init already lives in `src/instrumentation.ts`). (b) Add a Sentry init hook in `trigger.config.ts` (`@sentry/node`, DSN from env) and set the DSN in the Trigger.dev project env — every `Sentry.captureException` in `trigger/` is currently a silent no-op.
- **Accept:** A thrown test error from (a) a client component and (b) a Trigger.dev task appears in Sentry on Preview.

### T4-2: Make GitHub CI actually run the test suite 🔴 HIGH
- **Files:** `.github/workflows/hard-reset-verification.yml`, `package.json`
- **Fix:** (a) Add an `npm test` step (or replace steps with `npm run check`) — CI currently runs only 18 hard-reset tests while Vercel's build runs all 418. (b) Include the orphaned `.mjs` suites: `"test": "node --test tests/*.test.ts tests/**/*.test.ts tests/**/*.test.mjs"` (68 passing Hermes/Apify spend-guard tests currently run nowhere) — total should rise to ~486. (c) Add `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to the test scripts to unbury output.
- **Accept:** CI green with ~486 tests; output readable.

### T4-3: The E2E layer is an illusion — fix the gate or remove it 🔴 HIGH
- **Files:** `.github/workflows/hard-reset-verification.yml` (e2e job), `playwright.config.ts`, `e2e/platform.spec.ts`
- **Problem:** 20/20 tests skip locally, 4/4 skip in the "green" CI job (no server is ever started; `BLOCKWISE_DEV_PASSWORD` secret unset); `e2e/platform.spec.ts` asserts UI deleted in the redesign.
- **Fix:** Point Playwright at the PR's Vercel Preview (wait-for-vercel-preview action → `PLAYWRIGHT_BASE_URL`), set the `BLOCKWISE_DEV_PASSWORD` repo secret, seed test users once against Preview's Supabase, add a fail-if-zero-tests-ran guard, and rewrite `platform.spec.ts` against the current UI. **If that can't be done now, delete the e2e CI job** so the checks list stops advertising a gate that tests nothing.
- **Accept:** e2e job either executes >0 real tests against a deployment, or is gone.

### T4-4: Trigger.dev deploys are manual and undocumented 🟠 MEDIUM
- **Fix:** Add a CI job running `npx trigger.dev deploy` on pushes to main (TRIGGER_ACCESS_TOKEN secret). Remove the `proj_blockwise_local` fallback in `trigger.config.ts` (missing TRIGGER_PROJECT_ID should fail loudly). Add a runbook section listing the env vars the Trigger.dev project needs (Supabase URL + service key, META_APP_ID/SECRET, TOKEN_ENCRYPTION_KEY, BLOCKWISE_ENABLE_PROVIDER_WRITES, Sentry DSN).

### T4-5: Fix Vercel Preview env + the red PR checks 🟠 MEDIUM (owner-assisted)
- **Problem:** `verify-env` hard-fails Preview builds until all 11 required vars exist in Preview scope — every PR shows a red Vercel check and no preview URL (known issue, see memory).
- **Fix:** Add the missing required vars to Preview scope via the Vercel REST API workaround; or change buildCommand to hard-fail only when `VERCEL_ENV === 'production'` (warn-only on Preview).
- **Accept:** A test PR gets a green Vercel check and a preview URL.

### T4-6: .env.example / verify-env truth sweep 🟡 LOW
- Remove dead vars: `SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET`, `SENTRY_AUTH_TOKEN`, PostHog pair (nothing reads them; no posthog-js dep — also delete the PostHog mentions in `docs/deployment/vercel.md` and `docs/runbooks/paid-service-alerts.md`), `AGENT_ALLOWED_OUTBOUND_DOMAINS` + `SECURITY_AUDIT_LOG_DRAIN_URL` from RECOMMENDED_SECURITY_ENV_KEYS (+ tests).
- Add vars code actually reads: `CLOUDFLARE_AI_GATEWAY_URL/TOKEN`, `OPERATOR_EMAILS`, `BLOCKWISE_DEV_PASSWORD`, `GOOGLE_ADS_ENABLED`, `META_MONITOR_BUDGET_AUD`, sample-data knob.
- Fix the watchdog comment (it's a Vercel cron, not a Trigger.dev schedule) in `.env.example` and `rollback.md`; note CRON_SECRET as required for the watchdog + health detail.
- Reword the misleading TURNSTILE_SECRET_KEY comment (it lives in the Supabase dashboard, not the app).

### T4-7: Login/forgot-password may be missing the Turnstile captchaToken 🟠 MEDIUM (verify first)
- **Files:** `src/components/login-form.tsx`, `src/app/forgot-password/page.tsx`
- **Problem:** Signup sends `captchaToken`; Supabase captcha protection is project-wide — if enabled, login and reset break.
- **Fix:** First TEST login on production. If it fails (or the owner confirms captcha is enabled in Supabase), render Turnstile on both forms and pass `captchaToken`, reusing the signup form's logic.
- **Accept:** signup → confirm → logout → login works on production.

### T4-8: Supabase project reproducibility 🟡 LOW
- Run `supabase init`, commit `supabase/config.toml` with `[api] schemas = ["public","research","graphql_public"]`; document `supabase db reset` + `npm run seed:test-users` as the fresh-environment recipe in README.

---

## Phase 5 — Operator console (the owner's cockpit during the test)

### T5-1: Operator surfaces are scoped to the operator's own workspace — the tester is invisible 🔴 HIGH
- **Files:** `src/app/(operator)/model-control/page.tsx` (~28), `src/app/(operator)/workforce/page.tsx` (~15), `src/app/(operator)/model-control/runs/[id]/page.tsx`, `src/lib/operator/overview.ts`
- **Fix:** For operators, omit the workspaceId filter in `listAiLedgerRows` and `listAgentRunRows` (show a workspace column); in the run-trace page load by id without the workspace filter, then scope follow-ups by the run's own workspace_id. (The /approvals half of this is T2-6.)
- **Accept:** With the tester active, their AI ledger rows and runs appear in operator views.

### T5-2: Six operator research endpoints fail with permission-denied (session client vs service-role tables) 🟠 MEDIUM
- **Files:** `src/app/api/operator/research/jobs/route.ts` (+`[id]`, `[id]/retry` if kept), `runs/[id]/raw`, `ads/[id]/display-state`, `files/route.ts`
- **Fix:** Use `createSupabaseServiceClient().schema("research")` (the pattern refresh-now/kill-switch/requeue already use); `requireOperator()` already gates.

### T5-3: Hermes skills are not bundled on Vercel — empty list / 500s 🟠 MEDIUM
- **Files:** `next.config.ts`, `src/lib/operator/hermes-assets.ts`, `src/app/api/operator/research/skills/[slug]/route.ts`
- **Fix:** Add `outputFileTracingIncludes` mapping the skills routes + `/operator/research` to `./hermes/skills/**`; wrap `readHermesSkill` in try/catch → 404. Verify the Skills tab lists 27 skills on Preview.

### T5-4: Fake numbers and dead status in the cockpit 🟠 MEDIUM (batch)
- `workforce/page.tsx`: "Open runs 27" and "Schedules 6" are hardcoded — compute from `agent_runs`/`agent_schedules`. Fix the non-unique React row key (`run.id`).
- `approvals/page.tsx`: hardcoded "Budget changes: 1 / Client sends: 0" — compute or delete (overlaps T2-6).
- `model-control/page.tsx`: hardcoded provider count — derive from configured providers.
- `app-shell.tsx`: permanent "Hermes Engine Operational" sidebar badge — drive from the ingest heartbeat age (already computed in loadHeartbeat) or remove.
- Chat agent buried below the console: wrap ResearchConsole + OperatorAssistant in the intended two-column grid (the sticky-sidebar CSS already exists; it's dead today).
- Chat `refresh postcode` bypasses the census-source guard refresh-now enforces — extract the shared guard and use it in `executeRefreshPostcode`, returning the honest "no census source for NSW yet" answer.
- Research console error paths return raw JSON pages on form posts — redirect 303 with `?error=<code>` + banner; add `pattern="\d{4}"` to the postcode input.
- Coverage-defect flood: make Hermes upsert defects keyed on (subject, reason) with an occurrences counter + auto-resolve on later success; one-off SQL to collapse the existing 5,716 rows. (Pairs with T1-9.)
- `operator/content-runs/[id]` 500s on unknown ids → try/catch + `notFound()`.
- Operator pages hard-crash when `SUPABASE_SERVICE_ROLE_KEY` is absent → guarded friendly message.
- `ensureOperatorSession` rejects workspace-role operators the pages admit → use the shared `hasOperatorAccessFromRows` logic in the model-profiles PATCH/test routes.

---

## Phase 6 — Polish & truth in docs

### T6-1: SEO/metadata batch 🟡 LOW
- Legal pages: drop the hardcoded "· Blockwise" suffix (root template appends it — currently doubled, verified live).
- Canonicals: delete `alternates: { canonical: "/" }` from the root layout; add per-page canonicals on public pages.
- `robots.ts`: add `/home`, `/settings`, `/pwa`, `/reset-password`, `/forgot-password` to disallow.
- `not-found.tsx`: primary CTA → "Back to home" (`/`); keep dashboard link secondary (anonymous visitors currently get dumped at /login).

### T6-2: Copy/UX crumbs 🟡 LOW
- Sample monitor ads link to example.com — set `landingPageUrl` null in `sampleMetaMonitorData.ts` (disabled state already exists).
- "Set META_MONITOR_BUDGET_AUD" env-var name shown to customers (`MetaMonitorDashboard.tsx` ~191, `BudgetPacingChart.tsx` ~131) → "No monthly budget set".
- Per-variant "Regenerate" silently replaces the whole pack and burns a credit — add a confirm dialog stating that, or scope it to the variant.
- `resolveHomePath` doc comment says `/results` but returns `/self-serve` — fix comment; drop the unread `onboarding_status` select or use it.
- Ad Radar "Longest running" sort is a no-op — pass `sort` through `doSearch` and the search route, or remove the toggle.
- Meta Graph version fallback drift: `disconnect/route.ts` says v19.0, everywhere else v23.0 — export one constant.
- Operator prompt "Test" endpoints return "Phase 1" stub JSON — relabel "Preview" and render styled, or implement the dry-run.
- `hermes/skills/blockwise-operator-chat/SKILL.md` still says "stub — Phase 9" about the live shipped agent — rewrite.

### T6-3: Docs truth sweep 🟡 LOW
- `docs/research-engine/README.md` links 11 documents that don't exist and misstates runtime rules (location ad search is enabled, not forbidden) — rewrite to list only real docs; recreate at minimum an `env.md` for the HERMES_*/APIFY_*/META_* vars the supervisor reads.
- `docs/runbooks/production-readiness.md`: reconcile every checkbox against reality (many are done; some reference scripts that don't exist — `audit:repo`, `lint`). Either add a real `lint` script or delete those references.
- Mark `docs/LAUNCH_PLAN.md` superseded by this file (one line at top).
- Update `rollback.md` per T2-5/T4-4 outcomes.

---

## Phase 7 — Owner actions (Steven — not agent work)

1. **Decide pricing:** PR #29 raises $500 → $799/month and is green but unmerged; prod shows $500. Merge it or close it before the tester sees the price.
2. **Vercel Preview env vars** (unblocks T4-5 and green PR checks).
3. **Trigger.dev:** confirm project env vars (incl. `BLOCKWISE_ENABLE_PROVIDER_WRITES`, Sentry DSN) and enable failure alerts in the dashboard.
4. **Demo-request notifications:** set `RESEND_API_KEY` / `DEMO_NOTIFY_FROM` / `DEMO_NOTIFY_TO`, verify sender domain, test the live form (LAUNCH_PLAN A-6, still open).
5. **Confirm Supabase captcha setting** (T4-7) and test login on prod.
6. **Canonical domain decision:** 308-redirect `blockwise-tan.vercel.app` → `blockwise.sale` (or vice versa).
7. **Meta App Review** (gates `BLOCKWISE_ENABLE_PROVIDER_WRITES=true`; until then T2-1's honest "export" posture is the product).
8. **Confirm the two foreign research tables** (T3-6) really belong to the other project before archiving.
9. **PWA:** verify install/offline on prod or hide the PWA affordances (LAUNCH_PLAN O-5, still open).

---

## Final verification gate (run before inviting the tester)

1. `npm run check` and `npm run build` green; CI green including the new unit-test step.
2. Fresh-user run on PRODUCTION: signup → Turnstile renders → confirm email → land on `/self-serve` (same origin, one hop) → onboarding (brand colour persists into ads) → first ad generates → edit + autosave works (no "Campaign not found") → trial pill decrements → Ad Radar search (no duplicates, media renders) → publish panel shows the honest export/coming-soon state → Settings shows no raw enums/jargon.
3. Lead path (if Meta connected): lead appears with email/phone, delivery state visible, no approval flood after 30+ minutes.
4. `/api/health` returns generic JSON; `/api/health/research` not red.
5. Force one error in a client component, an API route, and a Trigger.dev task — all three appear in Sentry.
6. Operator account: sees the tester's workspace in /approvals, AI ledger, and runs.
7. Pricing page shows the decided price; legal pages titled correctly.
