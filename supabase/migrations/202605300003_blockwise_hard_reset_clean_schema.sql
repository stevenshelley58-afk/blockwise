-- Blockwise research hard reset: clean schema contract.
--
-- This is a forward-only reset migration. It archives existing research.*
-- tables plus retired public research tables into research_archive, drops the
-- active research schema, and recreates the approved clean schema. It uses only
-- SQL and does not depend on live secrets.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Archive current research data before the hard reset.
-- ---------------------------------------------------------------------------
create schema if not exists research_archive;

create table if not exists research_archive.hard_reset_manifests (
  migration_name text primary key,
  archived_at timestamptz not null default now(),
  table_counts jsonb not null default '{}'::jsonb,
  notes text
);

do $$
declare
  t record;
  archive_table text;
  legacy_public_table text;
  legacy_public_tables text[] := array[
    'competitors',
    'competitor_watchlists',
    'observed_ads',
    'ad_screenshots',
    'landing_captures',
    'market_signals',
    'pattern_classifications',
    'source_evidence',
    'campaign_ideas',
    'lead_magnets',
    'hooks'
  ];
  row_count bigint;
  counts jsonb := '{}'::jsonb;
begin
  if to_regnamespace('research') is not null then
    for t in
      select tablename
      from pg_tables
      where schemaname = 'research'
      order by tablename
    loop
      archive_table := 'hard_reset_202605300003_' || t.tablename;

      if to_regclass(format('research_archive.%I', archive_table)) is null then
        execute format('create table research_archive.%I as table research.%I', archive_table, t.tablename);
        execute format('alter table research_archive.%I add column _archived_at timestamptz not null default now()', archive_table);
      end if;

      execute format('select count(*) from research.%I', t.tablename) into row_count;
      counts := counts || jsonb_build_object(t.tablename, row_count);
    end loop;
  end if;

  foreach legacy_public_table in array legacy_public_tables
  loop
    if to_regclass(format('public.%I', legacy_public_table)) is not null then
      archive_table := 'hard_reset_202605300003_public_' || legacy_public_table;

      if to_regclass(format('research_archive.%I', archive_table)) is null then
        execute format('create table research_archive.%I as table public.%I', archive_table, legacy_public_table);
        execute format('alter table research_archive.%I add column _archived_at timestamptz not null default now()', archive_table);
      end if;

      execute format('select count(*) from public.%I', legacy_public_table) into row_count;
      counts := counts || jsonb_build_object('public.' || legacy_public_table, row_count);
      execute format('drop table if exists public.%I cascade', legacy_public_table);
    end if;
  end loop;

  insert into research_archive.hard_reset_manifests (
    migration_name,
    archived_at,
    table_counts,
    notes
  )
  values (
    '202605300003_blockwise_hard_reset_clean_schema',
    now(),
    counts,
    'Forward hard reset archive captured before dropping research schema and retired public research tables.'
  )
  on conflict (migration_name) do nothing;
end $$;

drop schema if exists research cascade;

create schema research;

comment on schema research is
  'Blockwise research engine: evidence-backed real-estate advertiser pages, Meta Ad Library observations, queueing, build reports, diagnostics, and customer-safe curated views.';

revoke all on schema research from public;
grant usage on schema research to service_role;
grant usage on schema research to authenticated;
grant usage on schema research to anon;

-- ---------------------------------------------------------------------------
-- Raw evidence and canonical entities.
-- ---------------------------------------------------------------------------
create table research.source_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
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
  is_real_estate boolean not null default false,
  status text not null default 'market_seen_unverified'
    check (status in ('licensed_verified', 'market_seen_unverified', 'licensed_unresolved', 'inactive', 'rejected')),
  review_status text not null default 'ready'
    check (review_status in ('ready', 'needs_review', 'rejected')),
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
create index agencies_real_estate_idx
  on research.agencies (is_real_estate, status);

create table research.agents (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  normalized_name text not null,
  given_name text,
  family_name text,
  licence_number text,
  agency_id uuid references research.agencies (id) on delete set null,
  agency_role text,
  state text not null default 'WA',
  primary_suburb text,
  primary_postcode text,
  email text,
  phone text,
  website_url text,
  status text not null default 'market_seen_unverified'
    check (status in ('licensed_verified', 'market_seen_unverified', 'licensed_unresolved', 'inactive', 'rejected')),
  review_status text not null default 'ready'
    check (review_status in ('ready', 'needs_review', 'rejected')),
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
  constraint agent_service_areas_subject_required
    check (agent_id is not null or agency_id is not null)
);

create index agent_service_areas_postcode_idx
  on research.agent_service_areas (postcode, suburb);
create index agent_service_areas_agent_idx
  on research.agent_service_areas (agent_id);
create index agent_service_areas_agency_idx
  on research.agent_service_areas (agency_id);

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
      'operator_chat',
      'real_estate_verification',
      'media_capture',
      'watchdog',
      'queue_operation'
    )),
  subject_type text not null
    check (subject_type in (
      'advertiser_page',
      'agent',
      'agency',
      'observed_ad',
      'ad_creative',
      'media_asset',
      'postcode',
      'coverage_defect',
      'work_queue',
      'build_run',
      'real_estate_verification',
      'operator_query'
    )),
  subject_id text not null,
  decided_at timestamptz not null default now(),
  decision jsonb not null,
  rationale text,
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  evidence jsonb not null default '{}'::jsonb,
  source_document_ids uuid[] not null default '{}',
  hermes_session_id text,
  hermes_skill text,
  model text,
  cost_usd numeric(12, 6),
  duration_ms int,
  superseded_by uuid references research.agent_decisions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index agent_decisions_subject_idx
  on research.agent_decisions (subject_type, subject_id, decided_at desc);
create index agent_decisions_type_decided_idx
  on research.agent_decisions (decision_type, decided_at desc);
create index agent_decisions_session_idx
  on research.agent_decisions (hermes_session_id)
  where hermes_session_id is not null;

create table research.advertiser_pages (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('facebook', 'instagram', 'meta_ad_library')),
  page_id text not null,
  page_name text not null,
  page_url text,
  agent_id uuid references research.agents (id) on delete set null,
  agency_id uuid references research.agencies (id) on delete set null,
  status text not null default 'candidate'
    check (status in (
      'candidate',
      'rejected_non_real_estate',
      'verified_real_estate_unresolved',
      'resolved_collectable',
      'no_ads_confirmed',
      'blocked_login_or_rate_limit',
      'failed_retrying',
      'stale_needs_review'
    )),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  resolution_decision_id uuid references research.agent_decisions (id) on delete set null,
  resolved_at timestamptz,
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
-- Work queue and build/run reporting.
-- ---------------------------------------------------------------------------
create table research.work_queue (
  id uuid primary key default gen_random_uuid(),
  queue_name text not null default 'default',
  job_type text not null,
  dedupe_key text,
  advertiser_page_id uuid references research.advertiser_pages (id) on delete cascade,
  priority int not null default 100,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'complete', 'failed', 'blocked')),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  claim_token uuid,
  claim_expires_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts > 0),
  last_error text,
  blocked_reason text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint work_queue_claim_fields
    check (status <> 'claimed' or (claimed_at is not null and claimed_by is not null and claim_expires_at is not null))
);

create index work_queue_due_idx
  on research.work_queue (queue_name, priority, available_at, created_at)
  where status = 'pending';
create index work_queue_status_idx
  on research.work_queue (status, updated_at desc);
create index work_queue_advertiser_page_idx
  on research.work_queue (advertiser_page_id)
  where advertiser_page_id is not null;
create unique index work_queue_active_dedupe_idx
  on research.work_queue (queue_name, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'claimed', 'failed', 'blocked');

create table research.build_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'maintain'
    check (mode in ('build', 'maintain')),
  market text,
  target_postcodes text[] not null default '{}',
  source_provider text,
  trigger text not null default 'scheduled'
    check (trigger in ('scheduled', 'manual', 'defect_investigation', 'audit', 'watchdog', 'backfill')),
  work_queue_id uuid references research.work_queue (id) on delete set null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'cancelled', 'blocked')),
  target_agency_count int not null default 0 check (target_agency_count >= 0),
  verified_agency_count int not null default 0 check (verified_agency_count >= 0),
  resolved_page_count int not null default 0 check (resolved_page_count >= 0),
  rejected_page_count int not null default 0 check (rejected_page_count >= 0),
  collectable_page_count int not null default 0 check (collectable_page_count >= 0),
  ads_seen_count int not null default 0 check (ads_seen_count >= 0),
  active_ads_count int not null default 0 check (active_ads_count >= 0),
  media_complete_count int not null default 0 check (media_complete_count >= 0),
  classification_complete_count int not null default 0 check (classification_complete_count >= 0),
  open_defect_count int not null default 0 check (open_defect_count >= 0),
  input_payload jsonb not null default '{}'::jsonb,
  input_hash text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result_summary jsonb not null default '{}'::jsonb,
  error text,
  spend_usd numeric(12, 6) not null default 0 check (spend_usd >= 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index build_runs_mode_started_idx
  on research.build_runs (mode, started_at desc);
create index build_runs_status_started_idx
  on research.build_runs (status, started_at desc);
create index build_runs_work_queue_idx
  on research.build_runs (work_queue_id)
  where work_queue_id is not null;

create table research.build_run_reports (
  id uuid primary key default gen_random_uuid(),
  build_run_id uuid references research.build_runs (id) on delete set null,
  report_type text not null
    check (report_type in (
      'summary',
      'diagnostic',
      'watchdog',
      'provider_failure',
      'zero_ad_anomaly',
      'missing_media',
      'unclassified_creative',
      'page_verification_gap'
    )),
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'error', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),
  title text not null,
  report jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences int not null default 1 check (occurrences > 0),
  source_document_id uuid references research.source_documents (id) on delete set null,
  created_at timestamptz not null default now()
);

create index build_run_reports_type_status_idx
  on research.build_run_reports (report_type, status, last_seen_at desc);
create index build_run_reports_build_run_idx
  on research.build_run_reports (build_run_id)
  where build_run_id is not null;

-- ---------------------------------------------------------------------------
-- Evidence-backed real-estate verification.
-- ---------------------------------------------------------------------------
create table research.real_estate_verifications (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null
    check (subject_type in ('advertiser_page', 'agent', 'agency')),
  subject_id uuid not null,
  advertiser_page_id uuid references research.advertiser_pages (id) on delete cascade,
  agent_id uuid references research.agents (id) on delete cascade,
  agency_id uuid references research.agencies (id) on delete cascade,
  verification_status text not null default 'needs_review'
    check (verification_status in ('verified', 'rejected', 'needs_review', 'expired')),
  evidence_type text not null default 'other'
    check (evidence_type in ('licence_register', 'agency_website', 'listing_portal', 'meta_page', 'operator_review', 'other')),
  evidence_url text,
  evidence jsonb not null default '{}'::jsonb,
  source_document_id uuid references research.source_documents (id) on delete set null,
  verified_by text,
  verified_at timestamptz,
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_estate_verifications_subject_fk_hint
    check (
      (subject_type = 'advertiser_page' and (advertiser_page_id = subject_id or advertiser_page_id is null))
      or (subject_type = 'agent' and (agent_id = subject_id or agent_id is null))
      or (subject_type = 'agency' and (agency_id = subject_id or agency_id is null))
    )
);

create index real_estate_verifications_subject_idx
  on research.real_estate_verifications (subject_type, subject_id, verification_status);
create index real_estate_verifications_page_idx
  on research.real_estate_verifications (advertiser_page_id, verification_status)
  where advertiser_page_id is not null;
create index real_estate_verifications_agent_idx
  on research.real_estate_verifications (agent_id, verification_status)
  where agent_id is not null;
create index real_estate_verifications_agency_idx
  on research.real_estate_verifications (agency_id, verification_status)
  where agency_id is not null;

-- ---------------------------------------------------------------------------
-- Provider runs, observations, snapshots, creatives, media, and area matches.
-- ---------------------------------------------------------------------------
create table research.ad_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  build_run_id uuid references research.build_runs (id) on delete set null,
  work_queue_id uuid references research.work_queue (id) on delete set null,
  source_provider text not null,
  role text not null default 'primary'
    check (role in ('primary', 'verifier', 'backfill', 'manual')),
  trigger text not null default 'scheduled'
    check (trigger in ('scheduled', 'manual', 'defect_investigation', 'audit', 'watchdog', 'backfill')),
  target_kind text not null
    check (target_kind in ('advertiser_page', 'agent', 'agency', 'ad_id')),
  target_value text not null,
  input_payload jsonb not null default '{}'::jsonb,
  input_hash text not null,
  source_document_id uuid references research.source_documents (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  result_summary jsonb not null default '{}'::jsonb,
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
create index ad_fetch_runs_build_run_idx
  on research.ad_fetch_runs (build_run_id)
  where build_run_id is not null;

create table research.observed_ads (
  id uuid primary key default gen_random_uuid(),
  external_ad_id text not null check (btrim(external_ad_id) <> ''),
  advertiser_page_id uuid not null references research.advertiser_pages (id) on delete cascade,
  first_seen_provider text not null,
  platform text not null default 'unknown'
    check (platform in ('facebook', 'instagram', 'audience_network', 'messenger', 'unknown')),
  active_status text not null default 'unknown'
    check (active_status in ('active', 'inactive', 'unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  missing_successive_checks int not null default 0,
  meta_publisher_platforms text[] not null default '{}',
  ad_delivery_started_at timestamptz,
  ad_delivery_stopped_at timestamptz,
  ad_creation_date date,
  raw_payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
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

create table research.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_snapshot_id uuid references research.ad_snapshots (id) on delete set null,
  format text not null default 'unknown'
    check (format in ('image', 'video', 'carousel', 'dco', 'unknown')),
  headline text,
  body text,
  cta text,
  cta_url text,
  primary_image_url text,
  image_urls text[] not null default '{}',
  image_storage_path text,
  video_url text,
  video_storage_path text,
  video_thumbnail_url text,
  landing_url text,
  locale text,
  language text,
  creative_hash text not null,
  media_assets jsonb not null default '[]'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  classification_status text not null default 'unclassified'
    check (classification_status in ('unclassified', 'classified', 'needs_review', 'failed')),
  classified_at timestamptz,
  classified_by_decision_id uuid references research.agent_decisions (id) on delete set null,
  ad_type text,
  primary_intent text,
  display_state text not null default 'pending_review'
    check (display_state in ('pending_review', 'displayable', 'hidden', 'blocked', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_creatives_media_assets_array
    check (jsonb_typeof(media_assets) = 'array')
);

create unique index ad_creatives_observed_ad_unique_idx
  on research.ad_creatives (observed_ad_id);
create index ad_creatives_creative_hash_idx on research.ad_creatives (creative_hash);
create index ad_creatives_display_state_idx
  on research.ad_creatives (display_state, classified_at desc);
create index ad_creatives_classification_gin_idx
  on research.ad_creatives using gin (classification);
create index ad_creatives_headline_trgm_idx
  on research.ad_creatives using gin (headline gin_trgm_ops)
  where headline is not null;
create index ad_creatives_body_trgm_idx
  on research.ad_creatives using gin (body gin_trgm_ops)
  where body is not null;

create table research.media_assets (
  id uuid primary key default gen_random_uuid(),
  ad_creative_id uuid not null references research.ad_creatives (id) on delete cascade,
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_snapshot_id uuid references research.ad_snapshots (id) on delete set null,
  external_asset_id text,
  kind text not null default 'unknown'
    check (kind in ('image', 'video', 'thumbnail', 'document', 'unknown')),
  source_url text,
  storage_bucket text,
  storage_path text,
  content_type text,
  byte_size bigint,
  width int,
  height int,
  duration_ms int,
  checksum text,
  capture_status text not null default 'pending'
    check (capture_status in ('pending', 'captured', 'failed', 'blocked', 'missing')),
  captured_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_has_location
    check (source_url is not null or storage_path is not null or capture_status in ('pending', 'failed', 'blocked', 'missing'))
);

create index media_assets_creative_idx
  on research.media_assets (ad_creative_id, kind);
create index media_assets_observed_idx
  on research.media_assets (observed_ad_id);
create index media_assets_status_idx
  on research.media_assets (capture_status, updated_at desc);
create unique index media_assets_creative_source_idx
  on research.media_assets (ad_creative_id, source_url)
  where source_url is not null;
create unique index media_assets_creative_storage_idx
  on research.media_assets (ad_creative_id, storage_bucket, storage_path)
  where storage_path is not null;

create table research.ad_creative_versions (
  id uuid primary key default gen_random_uuid(),
  ad_creative_id uuid not null references research.ad_creatives (id) on delete cascade,
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_snapshot_id uuid references research.ad_snapshots (id) on delete set null,
  version int not null check (version > 0),
  creative_hash text not null,
  format text not null,
  headline text,
  body text,
  cta text,
  cta_url text,
  primary_image_url text,
  image_urls text[] not null default '{}',
  video_url text,
  video_thumbnail_url text,
  landing_url text,
  classification jsonb not null default '{}'::jsonb,
  classification_status text not null default 'unclassified',
  display_state text not null default 'pending_review',
  ad_type text,
  primary_intent text,
  media_asset_ids uuid[] not null default '{}',
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index ad_creative_versions_unique_idx
  on research.ad_creative_versions (ad_creative_id, version);
create index ad_creative_versions_observed_idx
  on research.ad_creative_versions (observed_ad_id, created_at desc);

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
-- Coverage and refresh policy.
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
      'operator_review',
      'watchdog'
    )),
  status text not null
    check (status in ('covered', 'watch', 'needs_work', 'unknown')),
  score numeric(5, 2) not null default 0,
  agents_known int not null default 0,
  agents_estimated int not null default 0,
  ads_known int not null default 0,
  ads_sampled_external int not null default 0,
  sample_evidence jsonb not null default '{}'::jsonb,
  decided_by_decision_id uuid references research.agent_decisions (id) on delete set null,
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
    check (reported_by in ('auditor', 'operator', 'customer', 'investigator', 'system', 'watchdog')),
  reporter_identity text,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'dismissed', 'blocked')),
  resolution jsonb not null default '{}'::jsonb,
  resolution_decision_id uuid references research.agent_decisions (id) on delete set null,
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

create table research.refresh_policies (
  id uuid primary key default gen_random_uuid(),
  postcode text not null,
  state text not null default 'WA',
  priority int not null default 3
    check (priority between 1 and 5),
  refresh_cadence_minutes int not null default 1440,
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

insert into research.refresh_policies (postcode, state, priority, refresh_cadence_minutes)
values
  ('6000', 'WA', 2, 1440),
  ('6005', 'WA', 2, 1440),
  ('6006', 'WA', 2, 1440),
  ('6007', 'WA', 2, 1440),
  ('6008', 'WA', 1, 720),
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
  ('6160', 'WA', 2, 1440),
  ('6166', 'WA', 2, 1440)
on conflict (postcode, state) do nothing;

-- ---------------------------------------------------------------------------
-- Ingest event ledger.
-- ---------------------------------------------------------------------------
create table research.ingest_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    check (event_type in (
      'insert',
      'update',
      'upsert',
      'mark_inactive',
      'delete',
      'merge',
      'split',
      'classify',
      'media_captured',
      'verify',
      'archive',
      'reset',
      'claim',
      'complete',
      'fail',
      'block',
      'watchdog'
    )),
  schema_name text not null default 'research',
  table_name text not null,
  row_id uuid,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  diff jsonb,
  source_provider text,
  ad_fetch_run_id uuid references research.ad_fetch_runs (id) on delete set null,
  build_run_id uuid references research.build_runs (id) on delete set null,
  work_queue_id uuid references research.work_queue (id) on delete set null,
  agent_decision_id uuid references research.agent_decisions (id) on delete set null,
  source_document_id uuid references research.source_documents (id) on delete set null,
  created_at timestamptz not null default now()
);

create index ingest_events_table_row_idx
  on research.ingest_events (table_name, row_id, created_at desc);
create index ingest_events_run_idx
  on research.ingest_events (ad_fetch_run_id)
  where ad_fetch_run_id is not null;
create index ingest_events_build_run_idx
  on research.ingest_events (build_run_id)
  where build_run_id is not null;
create index ingest_events_work_queue_idx
  on research.ingest_events (work_queue_id)
  where work_queue_id is not null;
create index ingest_events_decision_idx
  on research.ingest_events (agent_decision_id)
  where agent_decision_id is not null;

-- ---------------------------------------------------------------------------
-- Utility functions and triggers.
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
create trigger trg_work_queue_updated_at
  before update on research.work_queue
  for each row execute function research.set_updated_at();
create trigger trg_build_runs_updated_at
  before update on research.build_runs
  for each row execute function research.set_updated_at();
create trigger trg_real_estate_verifications_updated_at
  before update on research.real_estate_verifications
  for each row execute function research.set_updated_at();
create trigger trg_observed_ads_updated_at
  before update on research.observed_ads
  for each row execute function research.set_updated_at();
create trigger trg_ad_creatives_updated_at
  before update on research.ad_creatives
  for each row execute function research.set_updated_at();
create trigger trg_media_assets_updated_at
  before update on research.media_assets
  for each row execute function research.set_updated_at();
create trigger trg_coverage_defects_updated_at
  before update on research.coverage_defects
  for each row execute function research.set_updated_at();
create trigger trg_refresh_policies_updated_at
  before update on research.refresh_policies
  for each row execute function research.set_updated_at();

create or replace function research.record_ad_creative_version()
returns trigger
language plpgsql
set search_path = research, public
as $$
declare
  next_version int;
  media_ids uuid[];
begin
  if tg_op = 'UPDATE'
    and old.creative_hash is not distinct from new.creative_hash
    and old.classification is not distinct from new.classification
    and old.classification_status is not distinct from new.classification_status
    and old.display_state is not distinct from new.display_state
    and old.ad_type is not distinct from new.ad_type
    and old.primary_intent is not distinct from new.primary_intent
    and old.headline is not distinct from new.headline
    and old.body is not distinct from new.body
  then
    return new;
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from research.ad_creative_versions
  where ad_creative_id = new.id;

  select coalesce(array_agg(id order by created_at), array[]::uuid[])
  into media_ids
  from research.media_assets
  where ad_creative_id = new.id;

  insert into research.ad_creative_versions (
    ad_creative_id,
    observed_ad_id,
    ad_snapshot_id,
    version,
    creative_hash,
    format,
    headline,
    body,
    cta,
    cta_url,
    primary_image_url,
    image_urls,
    video_url,
    video_thumbnail_url,
    landing_url,
    classification,
    classification_status,
    display_state,
    ad_type,
    primary_intent,
    media_asset_ids,
    diff
  )
  values (
    new.id,
    new.observed_ad_id,
    new.ad_snapshot_id,
    next_version,
    new.creative_hash,
    new.format,
    new.headline,
    new.body,
    new.cta,
    new.cta_url,
    new.primary_image_url,
    new.image_urls,
    new.video_url,
    new.video_thumbnail_url,
    new.landing_url,
    new.classification,
    new.classification_status,
    new.display_state,
    new.ad_type,
    new.primary_intent,
    media_ids,
    case
      when tg_op = 'INSERT' then '{}'::jsonb
      else jsonb_build_object(
        'creative_hash_changed', old.creative_hash is distinct from new.creative_hash,
        'classification_changed', old.classification is distinct from new.classification,
        'display_state_changed', old.display_state is distinct from new.display_state
      )
    end
  );

  return new;
end;
$$;

create trigger trg_ad_creatives_version
  after insert or update on research.ad_creatives
  for each row execute function research.record_ad_creative_version();

create or replace function research.jsonb_int(p_doc jsonb, p_keys text[], p_default int default 0)
returns int
language plpgsql
immutable
as $$
declare
  k text;
  v text;
begin
  foreach k in array p_keys loop
    v := p_doc ->> k;
    if v is not null and v ~ '^-?[0-9]+$' then
      return v::int;
    end if;
  end loop;

  return p_default;
end;
$$;

create or replace function research.valid_external_ad_id(p_external_ad_id text)
returns boolean
language sql
immutable
as $$
  select p_external_ad_id is not null
    and length(btrim(p_external_ad_id)) > 0
    and lower(btrim(p_external_ad_id)) not in ('0', 'unknown', 'null', 'none', 'n/a', 'na', 'undefined');
$$;

create or replace function research.creative_is_real_estate(
  p_classification jsonb,
  p_ad_type text,
  p_primary_intent text
)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_classification ->> 'industry', p_classification ->> 'vertical', '')) in ('real_estate', 'real estate', 'property')
    or lower(coalesce(p_primary_intent, p_classification ->> 'primary_intent', p_classification ->> 'intent', '')) in (
      'appraisal',
      'listing',
      'just_sold',
      'open_home',
      'market_update',
      'property_management',
      'lead_magnet',
      'agent_branding',
      'agency_brand',
      'real_estate'
    )
    or lower(coalesce(p_ad_type, p_classification ->> 'type', p_classification ->> 'ad_type', '')) in (
      'appraisal',
      'listing',
      'just_sold',
      'open_home',
      'market_update',
      'property_management',
      'lead_magnet',
      'brand',
      'agent_branding',
      'agency_brand',
      'real_estate'
    );
$$;

create or replace function research.page_is_verified_real_estate(p_advertiser_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = research, public
as $$
  select exists (
    select 1
    from research.advertiser_pages ap
    left join research.agents agent on agent.id = ap.agent_id
    where ap.id = p_advertiser_page_id
      and exists (
        select 1
        from research.real_estate_verifications rv
        where rv.verification_status = 'verified'
          and rv.confidence >= 60
          and (rv.valid_from is null or rv.valid_from <= now())
          and (rv.expires_at is null or rv.expires_at > now())
          and (
            rv.source_document_id is not null
            or nullif(btrim(coalesce(rv.evidence_url, '')), '') is not null
            or rv.evidence <> '{}'::jsonb
          )
          and (
            rv.advertiser_page_id = ap.id
            or rv.agent_id = ap.agent_id
            or rv.agency_id = coalesce(agent.agency_id, ap.agency_id)
            or (rv.subject_type = 'advertiser_page' and rv.subject_id = ap.id)
            or (rv.subject_type = 'agent' and rv.subject_id = ap.agent_id)
            or (rv.subject_type = 'agency' and rv.subject_id = coalesce(agent.agency_id, ap.agency_id))
          )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Work queue RPCs.
-- ---------------------------------------------------------------------------
create or replace function research.claim_work_queue_jobs(
  p_worker_id text,
  p_queue_name text default null,
  p_job_types text[] default null,
  p_limit int default 1,
  p_claim_ttl_seconds int default 900
)
returns setof research.work_queue
language plpgsql
security definer
set search_path = research, public
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'p_worker_id is required';
  end if;

  return query
  with candidates as (
    select q.id
    from research.work_queue q
    where q.status = 'pending'
      and q.available_at <= now()
      and (p_queue_name is null or q.queue_name = p_queue_name)
      and (p_job_types is null or q.job_type = any(p_job_types))
    order by q.priority asc, q.available_at asc, q.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 100))
  )
  update research.work_queue q
  set
    status = 'claimed',
    claimed_at = now(),
    claimed_by = p_worker_id,
    claim_token = gen_random_uuid(),
    claim_expires_at = now() + make_interval(secs => greatest(1, coalesce(p_claim_ttl_seconds, 900))),
    attempts = q.attempts + 1,
    updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Watchdog RPCs.
-- ---------------------------------------------------------------------------
create or replace function research.watchdog_requeue_stale_jobs(p_limit int default 100)
returns table (
  work_queue_id uuid,
  old_status text,
  new_status text,
  attempts int,
  reason text
)
language plpgsql
security definer
set search_path = research, public
as $$
begin
  return query
  with stale as (
    select q.id, q.status, q.attempts, q.max_attempts
    from research.work_queue q
    where q.status = 'claimed'
      and q.claim_expires_at < now()
    order by q.claim_expires_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
  ),
  updated as (
    update research.work_queue q
    set
      status = case when q.attempts >= q.max_attempts then 'blocked' else 'pending' end,
      blocked_reason = case when q.attempts >= q.max_attempts then coalesce(q.blocked_reason, 'claim_expired_max_attempts') else null end,
      last_error = coalesce(q.last_error, 'claim expired'),
      claimed_at = null,
      claimed_by = null,
      claim_token = null,
      claim_expires_at = null,
      available_at = case when q.attempts >= q.max_attempts then q.available_at else now() end,
      updated_at = now()
    from stale s
    where q.id = s.id
    returning q.id, s.status as old_status, q.status as new_status, q.attempts, coalesce(q.blocked_reason, q.last_error, 'claim expired') as reason
  )
  select updated.id, updated.old_status, updated.new_status, updated.attempts, updated.reason
  from updated;
end;
$$;

create or replace function research.watchdog_record_provider_failures(
  p_since interval default interval '24 hours',
  p_failure_threshold int default 3
)
returns table (
  source_provider text,
  failed_runs bigint,
  latest_failed_at timestamptz,
  report_id uuid
)
language plpgsql
security definer
set search_path = research, public
as $$
declare
  r record;
  v_report_id uuid;
begin
  for r in
    select
      afr.source_provider,
      count(*)::bigint as failed_runs,
      max(afr.completed_at) as latest_failed_at
    from research.ad_fetch_runs afr
    where afr.status = 'failed'
      and afr.started_at >= now() - coalesce(p_since, interval '24 hours')
    group by afr.source_provider
    having count(*) >= greatest(1, coalesce(p_failure_threshold, 3))
  loop
    insert into research.build_run_reports as brr (
      report_type,
      severity,
      title,
      report,
      dedupe_key
    )
    values (
      'provider_failure',
      'error',
      'Provider failure threshold exceeded',
      jsonb_build_object(
        'source_provider', r.source_provider,
        'failed_runs', r.failed_runs,
        'latest_failed_at', r.latest_failed_at
      ),
      'provider_failure:' || r.source_provider
    )
    on conflict (dedupe_key) do update
      set last_seen_at = now(),
          occurrences = brr.occurrences + 1,
          status = 'open',
          severity = excluded.severity,
          report = excluded.report
    returning id into v_report_id;

    source_provider := r.source_provider;
    failed_runs := r.failed_runs;
    latest_failed_at := r.latest_failed_at;
    report_id := v_report_id;
    return next;
  end loop;
end;
$$;

create or replace function research.watchdog_record_zero_ad_anomalies(
  p_since interval default interval '24 hours',
  p_limit int default 100
)
returns table (
  ad_fetch_run_id uuid,
  target_kind text,
  target_value text,
  report_id uuid
)
language plpgsql
security definer
set search_path = research, public
as $$
declare
  r record;
  v_report_id uuid;
begin
  for r in
    select
      afr.id,
      afr.target_kind,
      afr.target_value,
      afr.source_provider,
      afr.started_at,
      afr.result_summary
    from research.ad_fetch_runs afr
    where afr.status in ('success', 'partial')
      and afr.started_at >= now() - coalesce(p_since, interval '24 hours')
      and afr.result_summary <> '{}'::jsonb
      and research.jsonb_int(afr.result_summary, array['ads_observed', 'adsObserved', 'itemCount'], 0) = 0
    order by afr.started_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    insert into research.build_run_reports as brr (
      build_run_id,
      report_type,
      severity,
      title,
      report,
      dedupe_key
    )
    select
      afr.build_run_id,
      'zero_ad_anomaly',
      'warning',
      'Successful provider run returned zero ads',
      jsonb_build_object(
        'ad_fetch_run_id', r.id,
        'target_kind', r.target_kind,
        'target_value', r.target_value,
        'source_provider', r.source_provider,
        'started_at', r.started_at,
        'result_summary', r.result_summary
      ),
      'zero_ad:' || r.target_kind || ':' || r.target_value
    from research.ad_fetch_runs afr
    where afr.id = r.id
    on conflict (dedupe_key) do update
      set last_seen_at = now(),
          occurrences = brr.occurrences + 1,
          status = 'open',
          report = excluded.report
    returning id into v_report_id;

    ad_fetch_run_id := r.id;
    target_kind := r.target_kind;
    target_value := r.target_value;
    report_id := v_report_id;
    return next;
  end loop;
end;
$$;

create or replace function research.watchdog_record_missing_media(
  p_since interval default interval '7 days',
  p_limit int default 100
)
returns table (
  ad_creative_id uuid,
  observed_ad_id uuid,
  report_id uuid
)
language plpgsql
security definer
set search_path = research, public
as $$
declare
  r record;
  v_report_id uuid;
begin
  for r in
    select
      ac.id as ad_creative_id,
      oa.id as observed_ad_id,
      oa.external_ad_id,
      ap.page_name
    from research.ad_creatives ac
    join research.observed_ads oa on oa.id = ac.observed_ad_id
    join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
    where oa.active_status = 'active'
      and ac.created_at >= now() - coalesce(p_since, interval '7 days')
      and ac.display_state in ('displayable', 'pending_review')
      and coalesce(ac.primary_image_url, ac.video_url, ac.image_storage_path, ac.video_storage_path) is null
      and jsonb_array_length(ac.media_assets) = 0
      and not exists (
        select 1
        from research.media_assets ma
        where ma.ad_creative_id = ac.id
          and ma.capture_status = 'captured'
      )
    order by ac.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    insert into research.build_run_reports as brr (
      report_type,
      severity,
      title,
      report,
      dedupe_key
    )
    values (
      'missing_media',
      'warning',
      'Creative has no captured or provider media',
      jsonb_build_object(
        'ad_creative_id', r.ad_creative_id,
        'observed_ad_id', r.observed_ad_id,
        'external_ad_id', r.external_ad_id,
        'page_name', r.page_name
      ),
      'missing_media:' || r.ad_creative_id::text
    )
    on conflict (dedupe_key) do update
      set last_seen_at = now(),
          occurrences = brr.occurrences + 1,
          status = 'open',
          report = excluded.report
    returning id into v_report_id;

    ad_creative_id := r.ad_creative_id;
    observed_ad_id := r.observed_ad_id;
    report_id := v_report_id;
    return next;
  end loop;
end;
$$;

create or replace function research.watchdog_record_unclassified_creatives(
  p_since interval default interval '7 days',
  p_limit int default 100
)
returns table (
  ad_creative_id uuid,
  observed_ad_id uuid,
  report_id uuid
)
language plpgsql
security definer
set search_path = research, public
as $$
declare
  r record;
  v_report_id uuid;
begin
  for r in
    select
      ac.id as ad_creative_id,
      oa.id as observed_ad_id,
      oa.external_ad_id,
      ap.page_name
    from research.ad_creatives ac
    join research.observed_ads oa on oa.id = ac.observed_ad_id
    join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
    where oa.active_status = 'active'
      and ac.created_at >= now() - coalesce(p_since, interval '7 days')
      and (
        ac.classified_at is null
        or ac.classification_status in ('unclassified', 'failed')
        or ac.classification = '{}'::jsonb
        or lower(coalesce(ac.classification ->> 'type', ac.ad_type, ac.primary_intent, 'unknown')) in ('unknown', 'unclassified', 'other')
      )
    order by ac.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    insert into research.build_run_reports as brr (
      report_type,
      severity,
      title,
      report,
      dedupe_key
    )
    values (
      'unclassified_creative',
      'warning',
      'Creative is missing a usable classification',
      jsonb_build_object(
        'ad_creative_id', r.ad_creative_id,
        'observed_ad_id', r.observed_ad_id,
        'external_ad_id', r.external_ad_id,
        'page_name', r.page_name
      ),
      'unclassified_creative:' || r.ad_creative_id::text
    )
    on conflict (dedupe_key) do update
      set last_seen_at = now(),
          occurrences = brr.occurrences + 1,
          status = 'open',
          report = excluded.report
    returning id into v_report_id;

    ad_creative_id := r.ad_creative_id;
    observed_ad_id := r.observed_ad_id;
    report_id := v_report_id;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer-safe and operator diagnostic views.
-- ---------------------------------------------------------------------------
create or replace view research.v_customer_meta_ad_library_cards as
select
  oa.id::text as card_id,
  oa.external_ad_id as library_id,
  ap.page_id,
  ap.page_name,
  ap.page_url,
  coalesce(ap.metadata ->> 'page_image_url', ap.metadata ->> 'profile_image_url') as page_image_url,
  oa.active_status,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.meta_publisher_platforms as publisher_platforms,
  am.postcode,
  am.suburb,
  am.state,
  coalesce(postcodes.postcodes, array[am.postcode]) as postcodes,
  ac.headline,
  ac.body,
  coalesce(ac.metadata ->> 'description', ac.classification ->> 'description') as description,
  ac.cta,
  ac.cta_url,
  coalesce(ac.landing_url, ac.cta_url) as destination_url,
  null::text as primary_image_url,
  '{}'::text[] as image_urls,
  coalesce(ac.image_storage_path, media.image_storage_path) as image_storage_path,
  null::text as video_url,
  coalesce(ac.video_storage_path, media.video_storage_path) as video_storage_path,
  coalesce(ac.video_thumbnail_url, media.video_thumbnail_storage_path) as video_thumbnail_url,
  case
    when jsonb_typeof(ac.media_assets) = 'array' and jsonb_array_length(ac.media_assets) > 0 then ac.media_assets
    else coalesce(media.assets, '[]'::jsonb)
  end as media_assets,
  oa.last_seen_at,
  ('https://www.facebook.com/ads/library/?id=' || oa.external_ad_id) as ad_library_url
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
left join lateral (
  select array_agg(distinct asa.postcode order by asa.postcode) as postcodes
  from research.agent_service_areas asa
  where asa.postcode is not null
    and (
      asa.agent_id = ap.agent_id
      or asa.agency_id = ap.agency_id
    )
) postcodes on true
left join lateral (
  select
    max(ma.storage_path) filter (where ma.kind = 'image' and ma.storage_path is not null) as image_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'video' and ma.storage_path is not null) as video_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'thumbnail' and ma.storage_path is not null) as video_thumbnail_storage_path,
    jsonb_agg(
      jsonb_build_object(
        'kind', ma.kind,
        'storagePath', ma.storage_path,
        'contentType', ma.content_type,
        'byteSize', ma.byte_size,
        'capturedAt', ma.captured_at
      )
      order by ma.created_at
    ) filter (where ma.id is not null) as assets
  from research.media_assets ma
  where ma.ad_creative_id = ac.id
    and ma.capture_status = 'captured'
) media on true
where oa.active_status = 'active'
  and ap.status = 'resolved_collectable'
  and research.valid_external_ad_id(oa.external_ad_id)
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable';

create or replace view research.v_active_ads_by_postcode as
select
  postcode,
  suburb,
  state,
  card_id as observed_ad_id,
  library_id as external_ad_id,
  active_status,
  last_seen_at,
  page_id,
  page_name,
  page_url,
  headline,
  body,
  cta,
  cta_url,
  primary_image_url,
  image_urls,
  image_storage_path,
  video_url,
  ad_delivery_started_at,
  ad_delivery_stopped_at,
  video_storage_path,
  video_thumbnail_url,
  media_assets
from research.v_customer_meta_ad_library_cards;

create or replace view research.v_competitors_by_postcode as
select
  postcode,
  suburb,
  state,
  page_id,
  page_name,
  page_url,
  'meta_ad_library'::text as platform,
  count(distinct card_id) as active_ads,
  max(last_seen_at) as newest_active_ad_at
from research.v_customer_meta_ad_library_cards
group by postcode, suburb, state, page_id, page_name, page_url;

create or replace view research.v_ad_hooks_by_suburb as
select
  am.postcode,
  am.suburb,
  am.state,
  hook.value as hook,
  count(distinct ac.id) as creatives_using_hook,
  count(distinct oa.id) as active_ads_using_hook
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
cross join lateral jsonb_array_elements_text(coalesce(ac.classification -> 'hooks', '[]'::jsonb)) hook(value)
where ap.status = 'resolved_collectable'
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable'
group by am.postcode, am.suburb, am.state, hook.value;

create or replace view research.v_agent_ad_history as
select
  agency.id as agency_id,
  agency.name as agency_name,
  agent.id as agent_id,
  agent.full_name as agent_name,
  ap.id as advertiser_page_id,
  ap.page_name,
  ap.platform,
  oa.id as observed_ad_id,
  oa.external_ad_id,
  oa.active_status,
  oa.first_seen_at,
  oa.last_seen_at,
  oa.last_checked_at,
  ac.headline,
  ac.body,
  ac.cta,
  ac.primary_image_url,
  ac.video_url,
  ac.format,
  ac.classification,
  (select count(*) from research.ad_snapshots s where s.observed_ad_id = oa.id) as snapshot_count,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.media_assets,
  ac.ad_type,
  ac.primary_intent,
  ac.display_state
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
where ap.status = 'resolved_collectable'
  and research.page_is_verified_real_estate(ap.id);

create or replace view research.v_recent_creative_patterns as
select
  ac.id as ad_creative_id,
  oa.id as observed_ad_id,
  oa.active_status,
  ac.format,
  ac.headline,
  ac.body,
  ac.cta,
  ac.primary_image_url,
  ac.video_url,
  ac.classification,
  ac.classified_at,
  ap.page_name,
  agency.name as agency_name,
  agent.full_name as agent_name,
  oa.first_seen_at,
  oa.last_seen_at,
  array_agg(distinct am.postcode) as postcodes,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.image_urls,
  ac.image_storage_path,
  ac.video_storage_path,
  ac.video_thumbnail_url,
  ac.media_assets,
  ac.ad_type,
  ac.primary_intent
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_area_matches am on am.observed_ad_id = oa.id
where ap.status = 'resolved_collectable'
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable'
group by ac.id, oa.id, oa.active_status, ac.format, ac.headline, ac.body, ac.cta,
         ac.primary_image_url, ac.video_url, ac.classification, ac.classified_at,
         ap.page_name, agency.name, agent.full_name, oa.first_seen_at, oa.last_seen_at,
         oa.ad_delivery_started_at, oa.ad_delivery_stopped_at, oa.ad_creation_date,
         ac.image_urls, ac.image_storage_path, ac.video_storage_path, ac.video_thumbnail_url,
         ac.media_assets, ac.ad_type, ac.primary_intent
order by oa.last_seen_at desc;

create or replace view research.v_coverage_status as
with latest_audit as (
  select distinct on (postcode, state) *
  from research.coverage_audits
  order by postcode, state, audited_at desc
),
postcode_counts as (
  select
    am.postcode,
    am.state,
    count(distinct oa.id) as active_ads,
    count(distinct ap.id) as advertiser_pages,
    count(distinct ap.agent_id) filter (where ap.agent_id is not null) as agents,
    count(distinct coalesce(agent.agency_id, ap.agency_id)) filter (where coalesce(agent.agency_id, ap.agency_id) is not null) as agencies
  from research.observed_ads oa
  join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
  left join research.agents agent on agent.id = ap.agent_id
  join research.ad_creatives ac on ac.observed_ad_id = oa.id
  join research.ad_area_matches am on am.observed_ad_id = oa.id
  where oa.active_status = 'active'
    and ap.status = 'resolved_collectable'
    and research.page_is_verified_real_estate(ap.id)
    and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
    and ac.display_state = 'displayable'
  group by am.postcode, am.state
)
select
  rp.postcode,
  rp.state,
  rp.priority,
  rp.refresh_cadence_minutes,
  rp.last_refreshed_at,
  rp.next_refresh_at,
  rp.active as policy_active,
  la.status as last_audit_status,
  la.score as last_audit_score,
  la.audited_at as last_audited_at,
  la.agents_known,
  la.agents_estimated,
  la.ads_known,
  la.ads_sampled_external,
  coalesce(pc.active_ads, 0) as live_active_ads,
  coalesce(pc.advertiser_pages, 0) as live_advertiser_pages,
  coalesce(pc.agents, 0) as live_agents,
  coalesce(pc.agencies, 0) as live_agencies,
  case
    when la.audited_at is null then 'never_audited'
    when la.audited_at < now() - interval '14 days' then 'audit_overdue'
    when la.status = 'needs_work' then 'gap_known'
    when rp.next_refresh_at < now() - interval '6 hours' then 'refresh_overdue'
    else 'healthy'
  end as health
from research.refresh_policies rp
left join latest_audit la on la.postcode = rp.postcode and la.state = rp.state
left join postcode_counts pc on pc.postcode = rp.postcode and pc.state = rp.state;

create or replace view research.v_missing_competitors as
select
  cd.id,
  cd.postcode,
  cd.suburb,
  cd.state,
  cd.agent_name,
  cd.agency_name,
  cd.platform,
  cd.evidence_url,
  cd.notes,
  cd.reported_by,
  cd.status,
  cd.created_at,
  cd.updated_at,
  cd.resolved_at,
  cd.resolved_agent_id,
  cd.resolved_agency_id,
  cd.resolved_advertiser_page_id
from research.coverage_defects cd
where cd.status in ('open', 'investigating', 'blocked');

create or replace view research.v_operator_work_queue_diagnostics as
select
  q.id,
  q.queue_name,
  q.job_type,
  q.dedupe_key,
  q.status,
  q.priority,
  q.available_at,
  q.claimed_at,
  q.claimed_by,
  q.claim_expires_at,
  q.attempts,
  q.max_attempts,
  q.last_error,
  q.blocked_reason,
  q.created_at,
  q.updated_at,
  q.completed_at,
  q.status = 'claimed' and q.claim_expires_at < now() as is_stale_claim
from research.work_queue q;

create or replace view research.v_operator_work_queue_summary as
select
  queue_name,
  job_type,
  status,
  count(*) as jobs,
  min(available_at) as oldest_available_at,
  max(updated_at) as newest_update_at,
  count(*) filter (where status = 'claimed' and claim_expires_at < now()) as stale_claims
from research.work_queue
group by queue_name, job_type, status;

create or replace view research.v_operator_provider_failures as
select
  afr.id as ad_fetch_run_id,
  afr.source_provider,
  afr.role,
  afr.trigger,
  afr.target_kind,
  afr.target_value,
  afr.started_at,
  afr.completed_at,
  afr.status,
  afr.error,
  afr.result_summary,
  afr.cost_usd
from research.ad_fetch_runs afr
where afr.status = 'failed'
order by afr.started_at desc;

create or replace view research.v_operator_zero_ad_anomalies as
select
  afr.id as ad_fetch_run_id,
  afr.source_provider,
  afr.target_kind,
  afr.target_value,
  afr.started_at,
  afr.completed_at,
  afr.result_summary,
  research.jsonb_int(afr.result_summary, array['ads_observed', 'adsObserved', 'itemCount'], 0) as ads_observed
from research.ad_fetch_runs afr
where afr.status in ('success', 'partial')
  and afr.result_summary <> '{}'::jsonb
  and research.jsonb_int(afr.result_summary, array['ads_observed', 'adsObserved', 'itemCount'], 0) = 0
order by afr.started_at desc;

create or replace view research.v_operator_missing_media as
select
  ac.id as ad_creative_id,
  oa.id as observed_ad_id,
  oa.external_ad_id,
  ap.id as advertiser_page_id,
  ap.page_name,
  ac.display_state,
  ac.created_at,
  ac.updated_at
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
where oa.active_status = 'active'
  and coalesce(ac.primary_image_url, ac.video_url, ac.image_storage_path, ac.video_storage_path) is null
  and jsonb_array_length(ac.media_assets) = 0
  and not exists (
    select 1
    from research.media_assets ma
    where ma.ad_creative_id = ac.id
      and ma.capture_status = 'captured'
  );

create or replace view research.v_operator_unclassified_creatives as
select
  ac.id as ad_creative_id,
  oa.id as observed_ad_id,
  oa.external_ad_id,
  ap.id as advertiser_page_id,
  ap.page_name,
  ac.classification_status,
  ac.classification,
  ac.ad_type,
  ac.primary_intent,
  ac.created_at,
  ac.updated_at
from research.ad_creatives ac
join research.observed_ads oa on oa.id = ac.observed_ad_id
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
where oa.active_status = 'active'
  and (
    ac.classified_at is null
    or ac.classification_status in ('unclassified', 'failed')
    or ac.classification = '{}'::jsonb
    or lower(coalesce(ac.classification ->> 'type', ac.ad_type, ac.primary_intent, 'unknown')) in ('unknown', 'unclassified', 'other')
  );

create or replace view research.v_operator_page_verification_gaps as
select
  ap.id as advertiser_page_id,
  ap.platform,
  ap.page_id,
  ap.page_name,
  ap.page_url,
  ap.status,
  agent.id as agent_id,
  agent.full_name as agent_name,
  agency.id as agency_id,
  agency.name as agency_name,
  ap.created_at,
  ap.updated_at
from research.advertiser_pages ap
left join research.agents agent on agent.id = ap.agent_id
left join research.agencies agency on agency.id = coalesce(agent.agency_id, ap.agency_id)
where ap.status in ('resolved_collectable', 'verified_real_estate_unresolved', 'stale_needs_review')
  and not research.page_is_verified_real_estate(ap.id);

create or replace view research.v_operator_build_reports as
select
  brr.id,
  brr.build_run_id,
  br.mode,
  br.market,
  br.target_postcodes,
  br.source_provider,
  brr.report_type,
  brr.severity,
  brr.status,
  brr.title,
  brr.report,
  brr.dedupe_key,
  brr.first_seen_at,
  brr.last_seen_at,
  brr.occurrences,
  brr.created_at
from research.build_run_reports brr
left join research.build_runs br on br.id = brr.build_run_id
order by brr.last_seen_at desc;

-- ---------------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'research'
    order by tablename
  loop
    execute format('alter table research.%I enable row level security', t.tablename);
    execute format('revoke all on research.%I from public', t.tablename);
    execute format('revoke all on research.%I from anon', t.tablename);
    execute format('revoke all on research.%I from authenticated', t.tablename);
    execute format('grant all on research.%I to service_role', t.tablename);
    execute format(
      'create policy "%s_service_role_all" on research.%I as permissive for all to service_role using (true) with check (true)',
      t.tablename,
      t.tablename
    );
  end loop;
end $$;

-- Narrow operator policies for the existing operator API. Customer surfaces
-- still read through curated views only.
grant select on research.ad_fetch_runs to authenticated;
create policy ad_fetch_runs_operator_select
  on research.ad_fetch_runs
  for select
  to authenticated
  using (public.is_operator());

grant select, insert, update on research.refresh_policies to authenticated;
create policy refresh_policies_operator_select
  on research.refresh_policies
  for select
  to authenticated
  using (public.is_operator());
create policy refresh_policies_operator_insert
  on research.refresh_policies
  for insert
  to authenticated
  with check (public.is_operator());
create policy refresh_policies_operator_update
  on research.refresh_policies
  for update
  to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant select, update on research.advertiser_pages to authenticated;
create policy advertiser_pages_operator_select
  on research.advertiser_pages
  for select
  to authenticated
  using (public.is_operator());
create policy advertiser_pages_operator_update
  on research.advertiser_pages
  for update
  to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant select, insert, update on research.coverage_defects to authenticated;
create policy coverage_defects_operator_select
  on research.coverage_defects
  for select
  to authenticated
  using (public.is_operator());
create policy coverage_defects_operator_insert
  on research.coverage_defects
  for insert
  to authenticated
  with check (public.is_operator());
create policy coverage_defects_operator_update
  on research.coverage_defects
  for update
  to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant insert, select on research.agent_decisions to authenticated;
create policy agent_decisions_operator_insert
  on research.agent_decisions
  for insert
  to authenticated
  with check (public.is_operator());
create policy agent_decisions_operator_select
  on research.agent_decisions
  for select
  to authenticated
  using (public.is_operator());

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;
grant select on research.v_active_ads_by_postcode to authenticated, anon, service_role;
grant select on research.v_competitors_by_postcode to authenticated, anon, service_role;
grant select on research.v_ad_hooks_by_suburb to authenticated, service_role;
grant select on research.v_recent_creative_patterns to authenticated, service_role;
grant select on research.v_agent_ad_history to authenticated, service_role;
grant select on research.v_coverage_status to authenticated, service_role;
grant select on research.v_missing_competitors to authenticated, service_role;

grant select on research.v_operator_work_queue_diagnostics to authenticated, service_role;
grant select on research.v_operator_work_queue_summary to authenticated, service_role;
grant select on research.v_operator_provider_failures to authenticated, service_role;
grant select on research.v_operator_zero_ad_anomalies to authenticated, service_role;
grant select on research.v_operator_missing_media to authenticated, service_role;
grant select on research.v_operator_unclassified_creatives to authenticated, service_role;
grant select on research.v_operator_page_verification_gaps to authenticated, service_role;
grant select on research.v_operator_build_reports to authenticated, service_role;

revoke execute on function research.claim_work_queue_jobs(text, text, text[], int, int) from public;
revoke execute on function research.watchdog_requeue_stale_jobs(int) from public;
revoke execute on function research.watchdog_record_provider_failures(interval, int) from public;
revoke execute on function research.watchdog_record_zero_ad_anomalies(interval, int) from public;
revoke execute on function research.watchdog_record_missing_media(interval, int) from public;
revoke execute on function research.watchdog_record_unclassified_creatives(interval, int) from public;

grant execute on function research.page_is_verified_real_estate(uuid) to authenticated, anon, service_role;
grant execute on function research.claim_work_queue_jobs(text, text, text[], int, int) to service_role;
grant execute on function research.watchdog_requeue_stale_jobs(int) to service_role;
grant execute on function research.watchdog_record_provider_failures(interval, int) to service_role;
grant execute on function research.watchdog_record_zero_ad_anomalies(interval, int) to service_role;
grant execute on function research.watchdog_record_missing_media(interval, int) to service_role;
grant execute on function research.watchdog_record_unclassified_creatives(interval, int) to service_role;

alter default privileges in schema research grant all on tables to service_role;
alter default privileges in schema research grant all on sequences to service_role;
alter default privileges in schema research grant all on functions to service_role;
