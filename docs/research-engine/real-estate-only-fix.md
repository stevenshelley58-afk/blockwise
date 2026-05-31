# Research Engine — "Real-Estate Agents Only" Fix

Date: 2026-05-30

## Symptom

The `/research` page was showing ads that are **not real-estate** and not from
real-estate agents — e.g. "SoudCoh / Google Ads Done Properly" targeting
electricians, plumbers, and cleaners. They were genuine Meta (Facebook/Instagram)
ads, but from a digital-marketing agency, not a real-estate office.

## Root cause

There are two discovery paths and the wrong one filled the database:

- **Intended (agent-first):** `blockwise-agent-census` discovers *real-estate*
  agencies/agents from authoritative sources (WA licence register, REIWA,
  Domain, REA, agency team pages), verifies them, `blockwise-page-resolver`
  links them to their Meta pages, then the collector pulls *their* ads.
- **What actually ran (ad-first):** an `apify-discovery` job searched the Meta
  Ad Library **by location** (state/postcode) and ingested **every advertiser**
  running ads there, filing them under placeholder agencies literally named
  `Discovered WA`, `Discovered NSW`, etc. There was no "is this a real-estate
  agent?" gate on the way in.

Evidence at time of fix:

- 1,551 of 1,729 advertiser pages (90%) came from `apify-discovery`.
- 753 of 869 ads (87%) sat under `Discovered <state>` placeholder agencies.
- 0 agencies/agents had a licence number (nothing was verified).
- The ad classifier never ran (`classification = {}` on every creative;
  `ad_type` / `primary_intent` all null), so there was no secondary filter
  either.

## What was fixed in the database (done — 2026-05-30)

1. **Hard-deleted** the 6 placeholder agencies and everything under them:
   1,551 pages, 753 observed ads, their creatives, snapshots, area-matches,
   and 1 stray service-area row. A pre-delete export (advertiser + ad
   identifiers, headlines, and Meta `external_ad_id`s so anything can be
   re-fetched) is saved at:
   `research-junk-deletion-backup-2026-05-30.json`.

2. **Added a durable real-estate gate** — migration
   `supabase/migrations/202605300002_research_real_estate_gate.sql`:
   - New column `research.agencies.is_real_estate boolean not null default false`.
   - New helper `research.page_is_real_estate(agent_id, page_agency_id)`.
   - The 61 surviving (verified real-estate) agencies were flagged `true`.
   - The five ad-surfacing views now require it:
     `v_active_ads_by_postcode`, `v_recent_creative_patterns`,
     `v_agent_ad_history`, `v_competitors_by_postcode`, `v_ad_hooks_by_suburb`.

   Effect: even if a future source re-creates junk advertisers, they default to
   `is_real_estate = false` and **can never appear in the app** until the census
   verifies them. This is the safety net that makes the rest of the fix
   low-risk.

After the fix the active view shows only genuine brands: Ray White, Belle
Property, Harcourts, LJ Hooker, Realmark, The Agency, William Porteous,
Dethridge Groves, Edison Property. Agencies with no ads are retained on purpose
(an agent with no current ads is valid).

## What still must change on the VPS (Hermes) — action required

The discovery/ingestion code that created the `Discovered <state>` buckets is
**not in this repo**; it runs on the Hostinger VPS (Hermes worker + the apify
job). The repo's writer only handles ads/snapshots/creatives, never agencies.
So these steps must be applied on the VPS:

1. **Retire the location-based apify dump as a source of record.** Either turn
   it off, or downgrade it to a *lead list only*: it may suggest candidate
   pages, but it must never create an agency/agent that is treated as real or
   set `is_real_estate = true`. Any agency it creates must stay
   `is_real_estate = false`.

2. **Make `blockwise-agent-census` the roster owner.** It is the only path
   allowed to set `is_real_estate = true`, and only with evidence that meets the
   keep-bar: a licence-register match, OR a confirmed agency listing, OR another
   real-estate proof, each citing a `source_documents.id` and writing an
   `agent_decisions` row (per the skill's own Output Rules). The census is
   currently barely populated (25 agents, 0 licensed) — it needs to actually run
   per postcode in `research.refresh_policies`.

3. **Wire `blockwise-page-resolver`.** Right now 0 advertiser pages link to an
   agent (`advertiser_pages.agent_id` is null everywhere), so agent names never
   show. The resolver must match each real page to a census agent/agency and set
   `agent_id` / `agency_id` with a decision + confidence.

4. **Only collect from resolved real-estate pages.** `blockwise-ad-collector`
   should take `advertiser_page_id`s that belong to verified real-estate
   agencies/agents — not raw postcode sweeps. (Postcode-level sweeps are fine for
   the *coverage auditor* to detect gaps, but their output is a defect to chase,
   not ads to display.)

5. **Run `blockwise-ad-classifier`.** It must write `classification`, `ad_type`,
   and `primary_intent` on each creative (the columns and views already support
   them). This gives a second real-estate relevance signal and real intent labels
   instead of the current raw-format fallback ("image"/"video").

### Deploy steps (run on the VPS)

```bash
cd /opt/blockwise
# 1. Pull the repo changes (gate migration + this runbook)
git pull
# 2. Apply the new migration to the linked Supabase project
supabase db push        # or: psql "$SUPABASE_DB_URL" -f supabase/migrations/202605300002_research_real_estate_gate.sql
# 3. Sync the updated hermes/skills to the Hermes volume, then restart
docker compose up -d --build hermes
# 4. Kick a census-first run for a known postcode and confirm no placeholder agencies appear
```

### Verify (Supabase SQL)

```sql
-- No placeholder agencies should ever come back:
select count(*) from research.agencies where name ilike 'Discovered %';        -- expect 0
-- Everything surfaced is flagged real-estate:
select count(*) from research.v_active_ads_by_postcode
  where agency_id not in (select id from research.agencies where is_real_estate); -- expect 0
-- Census progress (should grow, and licensed > 0 once the register check runs):
select count(*) filter (where licence_number is not null) as licensed,
       count(*) as agencies from research.agencies;
-- Page resolution progress (should grow above 0):
select count(*) filter (where agent_id is not null) as pages_linked_to_agent,
       count(*) as pages from research.advertiser_pages;
```

## One-line summary

The database is now clean and gated to real-estate-only at the view layer. To
make Hermes itself stop producing junk, switch discovery from "scrape every
advertiser in a postcode" to "verify a real-estate roster first, then collect
their ads," and let only the census flip `is_real_estate = true` with evidence.
