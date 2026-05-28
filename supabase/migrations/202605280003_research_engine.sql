-- Hermes Research Engine — Phase 1
-- Creates the `research` schema and all tables, indexes, RLS policies, and
-- the curated v_* views that the Blockwise app reads from.
--
-- Design rules baked into this schema (do not relax without thought):
--
-- 1. PROVENANCE — every row in research.observed_ads is traceable back to a
--    specific ad_fetch_run and a stored source_document with the raw payload
--    we received from the provider. If a customer says "you missed this ad,"
--    we can prove what we saw and when.
--
-- 2. IDEMPOTENCY — observed_ads is unique on (advertiser_page_id, external_ad_id).
--    Re-ingesting the same payload upserts; it never duplicates. Payload hashes
--    on snapshots mean unchanged ads do not create new snapshot rows.
--
-- 3. ABSENCE CONFIRMATION — an ad is only marked inactive after
--    missing_successive_checks >= 2 consecutive successful runs of its page
--    fail to see it. A single provider blip never silently flips active->inactive.
--    `last_checked_at` advances only on SUCCESSFUL runs.
--
-- 4. PROVIDER FAILURE IS LOUD — ad_fetch_runs with status='failed' never
--    overwrite observed_ads. Coverage for that postcode is recorded as stale,
--    not "no ads."
--
-- 5. APPEND-ONLY HISTORY — ad_snapshots is append-only. Every change to an
--    observed ad's payload writes a new snapshot. Deletions never happen.
--
-- 6. CONFIGURABLE CADENCE — refresh_policies is the single source of truth
--    for "how often do we re-check postcode X." The operator console writes
--    to it; Hermes reads it.
--
-- 7. AGENT DECISIONS ARE FIRST-CLASS — Hermes' page-resolution, agent-match,
--    and audit decisions are logged as structured rows in agent_decisions.
--    Memory is part of the product data, not an external service. (mem0 is
--    used in addition for fuzzy recall; it is not the system of record.)
--
-- 8. SERVICE-ROLE WRITES ONLY — RLS is restrictive by default. Only the
--    service role writes; curated v_* views are what Blockwise customer
--    surfaces read. No direct table access from the anon/authenticated roles.

create extension if not exists pgcrypto;

create schema if not exists research;

comment on schema research is
  'Hermes-driven research engine: agency/agent census, advertiser pages, '
  'observed ads with provenance, coverage audits, refresh policy, and the '
  'curated views Blockwise reads. Writes happen only via the service role '
  'through the ingest worker and Hermes skills.';

-- ---------------------------------------------------------------------------
-- Source documents (raw evidence)
-- ---------------------------------------------------------------------------
-- Every external fetch (Apify run, Scrapling crawl, REIWA scrape, etc.) that
-- returns a payload we care about is recorded here with a content hash and
-- a Supabase Storage path to the raw blob. Higher-level rows reference this.
create table research.source_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  -- source examples: 'apify_leadsbrary', 'apify_automly', 'scrapling_self',
  -- 'browserbase', 'metapi', 'demirs_register', 'reiwa', 'domain', 'rea',
  -- 'google_business_profile', 'meta_ad_library_ui', 'operator_upload'
  source_url text,
  source_external_id text,
  fetched_at timestamptz not null default now(),
  storage_bucket text,
  storage_path text,
  content_hash text not null,
  mime_type text,
  byte_size bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index source_documents_source_fetched_idx
  on research.source_documents (source, fetched_at desc);
create unique index source_documents_content_hash_idx
  on research.source_documents (source, content_hash);

-- ---------------------------------------------------------------------------
-- Agencies and agents (the census)
-- ---------------------------------------------------------------------------
create table research.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  trading_name text,
  licence_number text,
  abn text,
  state text not null default 'WA',
  primary_suburb text,
  primary_postcode text,
  website_url text,
  status text not null default 'market_seen_unverified'
    check (status in ('licensed_verified', 'market_seen_unverified', 'licensed_unresolved', 'inactive')),
  review_status text not null default 'ready'
    check (review_status in ('ready', 'needs_review')),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index agencies_normalized_state_idx
  on research.agencies (normalized_name, state);
create index agencies_licence_idx
  on research.agencies (licence_number)
  where licence_number is not null;
create index agencies_postcode_idx
  on research.agencies (primary_postcode);

create table research.agents (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  normalized_name text not null,
  given_name text,
  family_name text,
  licence_number text,
  agency_id uuid references research.agencies (id) on delete set null,
  agency_role text,
  -- agency_role examples: 'principal', 'director', 'sales', 'property_manager',
  -- 'leasing', 'admin', 'unknown'
  state text not null default 'WA',
  primary_suburb text,
  primary_postcode text,
  email text,
  phone text,
  website_url text,
  status text not null default 'market_seen_unverified'
    check (status in ('licensed_verified', 'market_seen_unverified', 'licensed_unresolved', 'inactive')),
  review_status text not null default 'ready'
    check (review_status in ('ready', 'needs_review')),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agents_agency_idx on research.agents (agency_id);
create index agents_normalized_idx on research.agents (normalized_name);
create index agents_licence_idx
  on research.agents (licence_number)
  where licence_number is not null;
create index agents_postcode_idx on research.agents (primary_postcode);

-- ---------------------------------------------------------------------------
-- Service areas (which postcodes each agent/agency covers)
-- ---------------------------------------------------------------------------
create table research.agent_service_areas (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references research.agents (id) on delete cascade,
  agency_id uuid references research.agencies (id) on delete cascade,
  postcode text not null,
  suburb text not null,
  state text not null default 'WA',
  match_type text not null
    check (match_type in (
      'office_postcode',
      'listing_attribution',
      'service_suburb',
      'agent_profile_listing',
      'ad_targeting_observed',
      'manual',
      'nearby_market'
    )),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  source_document_id uuid references research.source_documents (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Either an agent_id OR an agency_id (or both) must be set. Coverage areas
  -- describe who serves where; an area row without a subject is meaningless.
  constraint agent_service_areas_subject_required
    check (agent_id is not null or agency_id is not null)
);

create index agent_service_areas_postcode_idx
  on research.agent_service_areas (postcode, suburb);
create index agent_service_areas_agent_idx
  on research.agent_service_areas (agent_id);
create index agent_service_areas_agency_idx
  on research.agent_service_areas (agency_id);

-- ---------------------------------------------------------------------------
-- Advertiser pages (Meta / Instagram pages tied to agents/agencies)
-- ---------------------------------------------------------------------------
create table research.advertiser_pages (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('facebook', 'instagram', 'meta_ad_library')),
  page_id text not null,
  page_name text not null,
  page_url text,
  agent_id uuid references research.agents (id) on delete set null,
  agency_id uuid references research.agencies (id) on delete set null,
  status text not null default 'unresolved'
    check (status in ('resolved', 'unresolved', 'duplicate', 'needs_review', 'inactive')),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  resolution_decision_id uuid, -- forward-declared FK to research.agent_decisions, added below
  -- Operational state for the ad refresh loop:
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  consecutive_failed_checks int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index advertiser_pages_platform_page_idx
  on research.advertiser_pages (platform, page_id);
create index advertiser_pages_agent_idx
  on research.advertiser_pages (agent_id);
create index advertiser_pages_agency_idx
  on research.advertiser_pages (agency_id);
create index advertiser_pages_status_idx
  on research.advertiser_pages (status);
create index advertiser_pages_check_due_idx
  on research.advertiser_pages (last_checked_at nulls first);

-- ---------------------------------------------------------------------------
-- Ad fetch runs (the audit log of every provider call we made)
-- ---------------------------------------------------------------------------
create table research.ad_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null,
  -- source_provider: which provider/actor produced this run
  role text not null default 'primary'
    check (role in ('primary', 'verifier', 'backfill', 'manual')),
  -- primary = main ingestion source; verifier = secondary cross-check;
  -- backfill = historical backfill; manual = operator-triggered
  trigger text not null default 'scheduled'
    check (trigger in ('scheduled', 'manual', 'defect_investigation', 'audit', 'discovery')),
  target_kind text not null
    check (target_kind in ('advertiser_page', 'postcode', 'suburb', 'agent', 'agency', 'search_query', 'ad_id')),
  target_value text not null,
  -- e.g. target_kind='advertiser_page' / target_value='<page_id>',
  --      target_kind='postcode'        / target_value='6008'
  input_payload jsonb not null default '{}'::jsonb,
  input_hash text not null,
  source_document_id uuid references research.source_documents (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  result_summary jsonb not null default '{}'::jsonb,
  -- result_summary holds: { ads_observed, ads_new, ads_updated, ads_missing,
  --                         credits_spent, error_count, warnings }
  error text,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index ad_fetch_runs_provider_started_idx
  on research.ad_fetch_runs (source_provider, started_at desc);
create index ad_fetch_runs_status_started_idx
  on research.ad_fetch_runs (status, started_at desc);
create index ad_fetch_runs_target_idx
  on research.ad_fetch_runs (target_kind, target_value, started_at desc);

-- ---------------------------------------------------------------------------
-- Observed ads (canonical record of an ad we've seen)
-- ---------------------------------------------------------------------------
create table research.observed_ads (
  id uuid primary key default gen_random_uuid(),
  external_ad_id text not null,
  -- Meta Ad Library 'id' field. Across providers this normalises to the
  -- same value for the same underlying ad.
  advertiser_page_id uuid not null references research.advertiser_pages (id) on delete cascade,
  first_seen_provider text not null,
  -- Which provider first surfaced this ad
  platform text not null
    check (platform in ('facebook', 'instagram', 'audience_network', 'messenger', 'unknown')),
  active_status text not null default 'unknown'
    check (active_status in ('active', 'inactive', 'unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  -- last_checked_at advances only on a SUCCESSFUL run that checked this ad's page.
  missing_successive_checks int not null default 0,
  -- Increments by 1 each successful page check that does NOT see this ad.
  -- Resets to 0 each time the ad is seen.
  -- active_status flips to 'inactive' only when missing_successive_checks >= 2.
  meta_publisher_platforms text[] not null default '{}',
  -- Subset of facebook/instagram/audience_network/messenger
  ad_delivery_started_at timestamptz,
  ad_delivery_stopped_at timestamptz,
  ad_creation_date date,
  raw_payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  -- Hash of the canonicalised payload — if unchanged on next observation,
  -- last_seen_at advances but no new snapshot is written.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index observed_ads_page_external_idx
  on research.observed_ads (advertiser_page_id, external_ad_id);
create index observed_ads_active_idx
  on research.observed_ads (active_status, last_seen_at desc);
create index observed_ads_last_seen_idx
  on research.observed_ads (last_seen_at desc);
create index observed_ads_page_idx
  on research.observed_ads (advertiser_page_id);

-- ---------------------------------------------------------------------------
-- Ad snapshots (append-only history)
-- ---------------------------------------------------------------------------
create table research.ad_snapshots (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_fetch_run_id uuid not null references research.ad_fetch_runs (id) on delete restrict,
  source_provider text not null,
  payload jsonb not null,
  payload_hash text not null,
  changes_from_prior jsonb not null default '{}'::jsonb,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index ad_snapshots_ad_snapshot_idx
  on research.ad_snapshots (observed_ad_id, snapshot_at desc);
create index ad_snapshots_run_idx
  on research.ad_snapshots (ad_fetch_run_id);
create unique index ad_snapshots_ad_hash_idx
  on research.ad_snapshots (observed_ad_id, payload_hash);

-- ---------------------------------------------------------------------------
-- Ad creatives (extracted creative content)
-- ---------------------------------------------------------------------------
create table research.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_snapshot_id uuid references research.ad_snapshots (id) on delete set null,
  format text not null
    check (format in ('image', 'video', 'carousel', 'dco', 'unknown')),
  headline text,
  body text,
  cta text,
  cta_url text,
  primary_image_url text,
  image_urls text[] not null default '{}',
  video_url text,
  video_thumbnail_url text,
  landing_url text,
  locale text,
  language text,
  creative_hash text not null,
  -- Hash of (headline + body + primary_image_url + video_url) for dedupe across ads.
  -- Two different ads that share creative will share creative_hash.
  classification jsonb not null default '{}'::jsonb,
  -- Hermes' ad-classifier skill writes structured classification here:
  -- { type: 'listing'|'brand'|'just_sold'|'open_home'|'recruitment'|'lead_magnet',
  --   hooks: ['scarcity', 'social_proof', ...],
  --   tone: 'professional'|'casual'|'urgent'|...,
  --   style: 'photo_focused'|'video_walkthrough'|'graphic'|...,
  --   target_signal: { suburb, postcode, price_band, audience },
  --   confidence: 0-100 }
  classified_at timestamptz,
  classified_by_decision_id uuid, -- FK added below to research.agent_decisions
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ad_creatives_observed_ad_idx on research.ad_creatives (observed_ad_id);
create index ad_creatives_creative_hash_idx on research.ad_creatives (creative_hash);
create index ad_creatives_classification_gin_idx
  on research.ad_creatives using gin (classification);
create index ad_creatives_headline_trgm_idx
  on research.ad_creatives using gin (headline gin_trgm_ops)
  where headline is not null;
create index ad_creatives_body_trgm_idx
  on research.ad_creatives using gin (body gin_trgm_ops)
  where body is not null;

-- Enable trigram extension for fuzzy text search on headlines/bodies.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Ad area matches (which postcodes/suburbs each ad targets or is relevant to)
-- ---------------------------------------------------------------------------
create table research.ad_area_matches (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  postcode text not null,
  suburb text not null,
  state text not null default 'WA',
  match_type text not null
    check (match_type in (
      'meta_targeting',
      'copy_mention',
      'agent_service_area',
      'agency_service_area',
      'landing_url',
      'manual'
    )),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index ad_area_matches_unique_idx
  on research.ad_area_matches (observed_ad_id, postcode, suburb, match_type);
create index ad_area_matches_postcode_idx
  on research.ad_area_matches (postcode, suburb);

-- ---------------------------------------------------------------------------
-- Coverage audits + defects
-- ---------------------------------------------------------------------------
create table research.coverage_audits (
  id uuid primary key default gen_random_uuid(),
  postcode text not null,
  suburb text not null,
  state text not null default 'WA',
  audited_at timestamptz not null default now(),
  audit_method text not null default 'sampled_manual_browse'
    check (audit_method in (
      'sampled_manual_browse',
      'license_register_diff',
      'provider_cross_check',
      'operator_review'
    )),
  status text not null
    check (status in ('covered', 'watch', 'needs_work', 'unknown')),
  score numeric(5, 2) not null default 0,
  agents_known int not null default 0,
  agents_estimated int not null default 0,
  ads_known int not null default 0,
  ads_sampled_external int not null default 0,
  sample_evidence jsonb not null default '{}'::jsonb,
  decided_by_decision_id uuid, -- FK added below to research.agent_decisions
  source_document_id uuid references research.source_documents (id) on delete set null,
  created_at timestamptz not null default now()
);

create index coverage_audits_postcode_audited_idx
  on research.coverage_audits (postcode, audited_at desc);
create index coverage_audits_status_idx
  on research.coverage_audits (status, audited_at desc);

create table research.coverage_defects (
  id uuid primary key default gen_random_uuid(),
  postcode text,
  suburb text,
  state text default 'WA',
  agent_name text,
  agency_name text,
  platform text,
  evidence_url text,
  notes text not null,
  reported_by text not null default 'auditor'
    check (reported_by in ('auditor', 'operator', 'customer', 'investigator', 'system')),
  reporter_identity text,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  resolution jsonb not null default '{}'::jsonb,
  resolution_decision_id uuid, -- FK added below
  resolved_agent_id uuid references research.agents (id) on delete set null,
  resolved_agency_id uuid references research.agencies (id) on delete set null,
  resolved_advertiser_page_id uuid references research.advertiser_pages (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coverage_defects_status_idx
  on research.coverage_defects (status, created_at desc);
create index coverage_defects_postcode_idx
  on research.coverage_defects (postcode)
  where postcode is not null;

-- ---------------------------------------------------------------------------
-- Refresh policies (configurable cadence per postcode — operator-editable)
-- ---------------------------------------------------------------------------
create table research.refresh_policies (
  id uuid primary key default gen_random_uuid(),
  postcode text not null,
  state text not null default 'WA',
  priority int not null default 3
    check (priority between 1 and 5),
  -- 1 = critical (refresh as fast as cadence allows)
  -- 5 = lazy (never auto-refresh, manual only)
  refresh_cadence_minutes int not null default 1440,
  -- 1440 = once per day
  last_refreshed_at timestamptz,
  next_refresh_at timestamptz not null default now(),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index refresh_policies_postcode_idx
  on research.refresh_policies (postcode, state);
create index refresh_policies_next_idx
  on research.refresh_policies (active, next_refresh_at)
  where active = true;

-- Seed refresh policy for Perth metro postcodes (priority 2, daily).
-- This is the WA-first scope for v1. Operator console can edit any of these.
insert into research.refresh_policies (postcode, state, priority, refresh_cadence_minutes)
values
  ('6000', 'WA', 2, 1440),
  ('6005', 'WA', 2, 1440),
  ('6006', 'WA', 2, 1440),
  ('6007', 'WA', 2, 1440),
  ('6008', 'WA', 1, 720),  -- Subiaco — priority demo postcode, refresh 12h
  ('6009', 'WA', 2, 1440),
  ('6010', 'WA', 2, 1440),
  ('6011', 'WA', 2, 1440),
  ('6014', 'WA', 2, 1440),
  ('6015', 'WA', 2, 1440),
  ('6016', 'WA', 2, 1440),
  ('6017', 'WA', 2, 1440),
  ('6018', 'WA', 2, 1440),
  ('6019', 'WA', 2, 1440),
  ('6020', 'WA', 2, 1440),
  ('6050', 'WA', 2, 1440),
  ('6051', 'WA', 2, 1440),
  ('6052', 'WA', 2, 1440),
  ('6151', 'WA', 2, 1440),
  ('6152', 'WA', 2, 1440),
  ('6153', 'WA', 2, 1440),
  ('6158', 'WA', 2, 1440),
  ('6159', 'WA', 2, 1440),
  ('6160', 'WA', 2, 1440)
on conflict (postcode, state) do nothing;

-- ---------------------------------------------------------------------------
-- Agent decisions (Hermes' structured memory)
-- ---------------------------------------------------------------------------
create table research.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_type text not null
    check (decision_type in (
      'page_resolution',
      'agent_match',
      'agency_match',
      'duplicate_merge',
      'coverage_audit',
      'defect_investigation',
      'ad_classification',
      'area_match',
      'cadence_change',
      'operator_chat'
    )),
  subject_type text not null
    check (subject_type in (
      'advertiser_page',
      'agent',
      'agency',
      'observed_ad',
      'ad_creative',
      'postcode',
      'coverage_defect',
      'operator_query'
    )),
  subject_id text not null,
  -- text rather than uuid because some subjects (postcode, operator_query) are not uuids
  decided_at timestamptz not null default now(),
  decision jsonb not null,
  rationale text,
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  source_document_ids uuid[] not null default '{}',
  -- Hermes runtime metadata:
  hermes_session_id text,
  hermes_skill text,
  -- e.g. 'blockwise-page-resolver', 'blockwise-coverage-auditor'
  model text,
  cost_usd numeric(12, 6),
  duration_ms int,
  superseded_by uuid references research.agent_decisions (id) on delete set null,
  -- When a decision is revised, the new row references the prior via superseded_by.
  created_at timestamptz not null default now()
);

create index agent_decisions_subject_idx
  on research.agent_decisions (subject_type, subject_id, decided_at desc);
create index agent_decisions_type_decided_idx
  on research.agent_decisions (decision_type, decided_at desc);
create index agent_decisions_session_idx
  on research.agent_decisions (hermes_session_id)
  where hermes_session_id is not null;

-- Back-fill the forward-declared FKs to agent_decisions
alter table research.advertiser_pages
  add constraint advertiser_pages_resolution_decision_fk
  foreign key (resolution_decision_id)
  references research.agent_decisions (id) on delete set null;

alter table research.ad_creatives
  add constraint ad_creatives_classified_by_decision_fk
  foreign key (classified_by_decision_id)
  references research.agent_decisions (id) on delete set null;

alter table research.coverage_audits
  add constraint coverage_audits_decided_by_decision_fk
  foreign key (decided_by_decision_id)
  references research.agent_decisions (id) on delete set null;

alter table research.coverage_defects
  add constraint coverage_defects_resolution_decision_fk
  foreign key (resolution_decision_id)
  references research.agent_decisions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Ingest events (provenance log — every write that lands in research.*)
-- ---------------------------------------------------------------------------
create table research.ingest_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    check (event_type in ('insert', 'update', 'upsert', 'mark_inactive', 'delete', 'merge', 'split')),
  table_name text not null,
  row_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  diff jsonb,
  source_provider text,
  ad_fetch_run_id uuid references research.ad_fetch_runs (id) on delete set null,
  agent_decision_id uuid references research.agent_decisions (id) on delete set null,
  source_document_id uuid references research.source_documents (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ingest_events_table_row_idx
  on research.ingest_events (table_name, row_id, created_at desc);
create index ingest_events_run_idx
  on research.ingest_events (ad_fetch_run_id)
  where ad_fetch_run_id is not null;
create index ingest_events_decision_idx
  on research.ingest_events (agent_decision_id)
  where agent_decision_id is not null;

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------
create or replace function research.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_agencies_updated_at
  before update on research.agencies
  for each row execute function research.set_updated_at();
create trigger trg_agents_updated_at
  before update on research.agents
  for each row execute function research.set_updated_at();
create trigger trg_advertiser_pages_updated_at
  before update on research.advertiser_pages
  for each row execute function research.set_updated_at();
create trigger trg_observed_ads_updated_at
  before update on research.observed_ads
  for each row execute function research.set_updated_at();
create trigger trg_ad_creatives_updated_at
  before update on research.ad_creatives
  for each row execute function research.set_updated_at();
create trigger trg_coverage_defects_updated_at
  before update on research.coverage_defects
  for each row execute function research.set_updated_at();
create trigger trg_refresh_policies_updated_at
  before update on research.refresh_policies
  for each row execute function research.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: service-role writes only by default. Curated views handle reads.
-- ---------------------------------------------------------------------------
-- We do NOT grant table-level access to anon / authenticated. They read
-- through research.v_* views (defined in the views migration) which are
-- explicitly granted.
revoke all on schema research from public;
grant usage on schema research to service_role;
grant usage on schema research to authenticated;
grant usage on schema research to anon;

-- All tables: service role full access; everyone else nothing direct.
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'research'
  loop
    execute format('alter table research.%I enable row level security', t.tablename);
    execute format('revoke all on research.%I from public', t.tablename);
    execute format('revoke all on research.%I from anon', t.tablename);
    execute format('revoke all on research.%I from authenticated', t.tablename);
    execute format('grant all on research.%I to service_role', t.tablename);
    -- A permissive policy for service_role; the GRANT alone is enough but
    -- making the policy explicit avoids surprises if a future role inherits.
    execute format(
      'create policy "%s_service_role_all" on research.%I '
      'as permissive for all to service_role using (true) with check (true)',
      t.tablename, t.tablename
    );
  end loop;
end $$;

-- Make service_role the default owner so future generated objects inherit
-- correctly.
alter default privileges in schema research grant all on tables to service_role;
alter default privileges in schema research grant all on sequences to service_role;
alter default privileges in schema research grant all on functions to service_role;
