# Ad Radar collector and scheduler runbook

## Current status and scope

As observed on 2026-09-08, the runtime is ACTIVE at exact SHA
7b11172024c6050bd1c27b2b671278598028b495 and the product is LIVE at exact
SHA 674b512139961927191f3659a64737a2e0db1cdd. Product health is verified
after two pagination canary and two public normal TLS passes. WA first-fill
remains RUNNING and NOT COMPLETE. This document records the observed evidence
and the release procedure; it is not a claim of complete WA coverage.

The isolated research database is authoritative for page scan state. Apply
research migrations in filename order, including the signup-owned
202609080001_research_ad_radar_customer_interests.sql, then
202609080002_ad_radar_scan_truth.sql. Do not put either research migration in
the customer product migration list.

The known WA first-fill scope is 389 eligible numeric Facebook pages, not
the whole WA directory. Of those 389 pages, 370 do not yet have a latest
comparable baseline. This is a known-page scope, not a claim of complete WA
agent coverage. A fresh DEMIRS audit recorded 11,832 licenses, with 205 agents
and 35 agencies appended from safe evidence; the current WA directory reports
12,349 agents and 2,907 agencies. Its 181 identity ambiguities remain explicit,
and a repeat audit found zero missing records. These counts do not turn the
known-page fill into full directory coverage. Existing and future customer
interests are synced from the product signup/profile source every five minutes. The research table contains only a
pseudonymous customer_key and target/linkage fields; it does not contain
customer PII, tokens, or account credentials.

A signed-up customer's explicitly connected own page is a direct daily target,
including a zero-ad page. A customer postcode also keeps all known eligible
pages in that postcode on the daily cadence. An unresolved own-page mapping
must not block the postcode interest. The collector never mutates
agent_service_areas to represent a signup. Other active pages remain daily;
quiet pages use the collector's 3, 7, 14, and 30 day backoff.

## Evidence and scan truth

New scheduler truth requires all of the following on the same
ad_fetch_runs row:

- status = success
- completed_at is not null
- coverage_complete = true
- pagination_exhausted = true
- result_summary.active_ads is a non-negative integer

The SQL scheduler function requires active_ads in addition to the completion,
coverage, and pagination predicates. The runtime writes active_ads for new
runs. Historical preexisting baseline rows may instead expose
Historical last_successful_scan timestamps alone do not count as a full fill.
result_summary.item_count or result_summary.ads_seen, or may lack an
active-count field; those fields are descriptive historical evidence only and
must never substitute for active_ads in the new scheduler truth.

A partial pagination run, even when it saw active ads, schedules another
attempt within 24 hours and retains coverage as unknown. It must not mark the
page fully exhausted or complete first-fill. Failed, partial, timed-out, and
malformed-provider responses remain retryable through durable failure/backoff
state and cannot advance initial_fill_completed_at.

The only post-run scheduling RPC is
research.schedule_ad_radar_after_run(p_run_id uuid). It reads the recorded run
and locks the page before scheduling; repeated run IDs are idempotent. Delayed
older runs are marked handled without regressing newer page truth. A historical
baseline that lacks active_ads remains useful for reporting but is not new
scheduler completion evidence.

## Customer-interest and page identity rules

research.ad_radar_customer_interests is a service-side export keyed by
customer_key. The signup adapter reads the authoritative product customer
snapshot and writes research target rows only after the product response is
valid. A product HTTP error, timeout, malformed JSON, or non-array response
causes no research writes and no stale-interest deactivation. Stale active
interests are deactivated only after a complete successful product snapshot;
the adapter's batched writes are not a database transaction.

Use an explicit verified Meta assignment or other exact stable page ID. Never
guess an owner from a name, slug, postcode, or a directory profile that merely
surfaced an agency link. An exact assigned Meta page absent from the research
directory may be registered idempotently as a Facebook page with
owner_type=unknown and source evidence customer_meta_assignment; preserve
existing agent/agency ownership when the page already exists. Agency/team
evidence may assign an agency only when the source itself proves that agency;
metadata.agent_id alone never proves an agent-owned page.

The adapter normalizes only AU state codes (WA, NSW, VIC, QLD, SA, TAS, ACT,
and NT). A country or market value of AU is not a state. A later verified
profile/brand postcode supersedes the original signup postcode, except where
an explicit manual value is authoritative. Postcode extraction must prefer a
state-qualified or trailing Australian four-digit postcode over a street
number.

## Queue and fairness contract

There is one canonical research queue and one --ad-db-worker process; do
not start a second queue or parallel worker definition. The upcoming parallel
lane plan is directory fanout 1, discovery entity 4, collector 4 by default,
media 4, and deterministic classifier 1. Collector concurrency may be raised
to 8 only after bounded acceptance evidence. The scheduler polls every 10
seconds while idle and drains busy queues independently; slow paid captures
must not stall directory, discovery, media, classification, or scheduling.
Each lane claims only its marked job type and canonical dedupe prefix. Legacy
census/resolver/classifier rows are not consumed by the narrow worker.

Directory maintenance runs weekly, with durable continuation checkpoints and
batches of 50 entity jobs. Exact stable page IDs only are accepted: no
name-only or slug-only guesses, and existing page ownership is preserved.
Signed-up customer own/local pages and postcode-known pages remain daily;
other active pages follow normal cadence, and quiet pages use 3, 7, 14, and
30-day backoff. Customer-interest targets are eligible again after 24 hours.
Disabled pages are never restarted by scheduler recovery. Media capture is a
separate archive child job and rule-based classification is a separate display
refresh; classification makes no LLM call. Provider/raw responses and
verified media archives are distinct evidence. Media failure remains retryable
and cannot report a fully successful media job. There is no fixed item-count
ceiling that can silently truncate provider pagination; a provider stop,
credit guard, timeout, or other bounded stop is recorded as partial with
coverage unknown.

The parallel lane source is not yet deployed; its immutable full SHA will be
recorded after parent integration. The active runtime SHA above describes the
currently verified service, not this upcoming lane change.
## Capture journal and charge safety

Before writing a research source document, the capture path atomically stores
the raw response body and its receipt in the capture journal. A same-run
replay reads that raw journal entry and uses the same parser; it does not
fetch a different response. Fetch-run creation is idempotent and a POST
conflict reuses the existing run.

Credit settlement is idempotent. A confirmed provider response may be settled
once and a known failed request may be reconciled according to its recorded
state. An unknown charge or a request with no response must not trigger a
blind repay or automatic second paid request; reconcile the provider/run state
first. Do not create a paid request merely to prove queue health.

## Request and database budget

The provider request limit is 25 credits per request. The database subscription
maximum is 75,000, with 74,700 remaining at the current rehearsal snapshot.
These are operational observations, not permission to purchase credits. Do
not add another overall ceiling, and do not purchase or top up provider
credits. A bounded stop caused by these controls is recorded with its actual
stop reason and unknown coverage.

## Observed launch evidence

The first paid GLC Residential capture confirmed zero ads using 25 credits
and scheduled the next scan in 3 days. Same-job raw replay took 192 ms with
one attempt; provider-used remained 325 before and after, with no extra
credits. The launch budget snapshot was a 75,000 subscription maximum with
74,675 remaining. These observations do not waive the release gates below.

## Rehearsal and release procedure

Before cutover, rehearse both research migrations and the post-run scheduling
function against the schema-only candidate research database. Verify that
failed and partial runs do not set initial_fill_completed_at, complete zero-ad
runs advance through the 3/7/14/30 cadence, active pages remain daily, and a
customer postcode produces postcode targets without changing service areas.
Verify the 389-page known scope and the 370 pages without a latest comparable
baseline. For new scheduler truth, test a successful run with a non-negative
active_ads value and test that missing, negative, or non-integer active_ads
does not advance completion. Historical item_count/ads_seen rows may be
reported separately but must not pass the new truth gate.

Build and validate only from a merged immutable full Git SHA. Production
activation is deliberately a two-step operation:

1. From the clean checkout, run
   scripts/vps/ad-radar-worker-deploy.sh FULL_40_CHARACTER_SHA --stage.
   Confirm that the release archive, dependency check, and JavaScript syntax
   checks pass, and record the staged release path.
2. Run exactly one bounded pass from that staged release using the production
   environment file without printing it, with HERMES_RESEARCH_RUN_ONCE=true
   and --ad-db-worker. Confirm the pass uses only the canonical queue, honors
   the batch bound, records customer-sync/scheduler/worker outcomes, and
   produces no credential output or unbounded pagination claim.
3. Only after that evidence is reviewed, run the same deploy script for the
   exact same SHA without --stage. Verify the systemd unit is active, points
   to that SHA's runtime directory, and the service starts with
   --ad-db-worker. Record the revision and health checks. Do not claim
   production deployed before this activation and verification complete.

Rollback uses the previously verified immutable release and its retained unit;
never roll back to a moving checkout or introduce a second queue.
## Deterministic saved-creative classification

The classifier stage uses the canonical deterministic helper classifyCreativeFromSavedEvidence(creative) for saved-ad first-fill and backfill work. It reads persisted creative evidence only and makes no paid provider request, media download, network call, or LLM call. It runs in its own lane (concurrency 1) apart from media/archive refresh. Strong existing classifications must be preserved by the supervisor; replacement is for stale creative hash or classifier version, or unclassified/other status. Weak evidence remains industry=unknown, ad_type=other, and primary_intent=other.

This source is implemented in the un-deployed branch and is not production activation evidence until the parent integration is merged and deployed at an immutable full SHA.