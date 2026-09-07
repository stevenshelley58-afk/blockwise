-- Page-scan spine repair (Ad Radar v2)
--
-- Central change: research.advertiser_pages.page_id is the entire acquisition
-- spine. Agent/agency rows become optional metadata. Page-level scan state is
-- first-class and ad_fetch_runs must reference a real page row for any new
-- scan.
--
-- Parts:
--   1. advertiser_pages scan-state columns
--   2. ad_fetch_runs repair (page FK, scan_mode, idempotency, provider cost
--      telemetry incl. ScrapingBee headers) + backfill from target_value
--   3. observed_ads lifecycle columns + backfill
--   4. Safe inactivation: a partial/failed scan can never mark ads inactive;
--      inactivation happens only via research.mark_missing_ads_inactive()
--      for complete comparable runs.

-- ---------------------------------------------------------------------------
-- 1. advertiser_pages: page-level scan state
-- ---------------------------------------------------------------------------
alter table research.advertiser_pages
  add column if not exists owner_type text not null default 'unknown'
    check (owner_type in ('agent', 'agency', 'unknown')),
  add column if not exists scan_enabled boolean not null default true,
  add column if not exists scan_state text not null default 'needs_first_fill'
    check (scan_state in ('needs_first_fill', 'queued', 'scanning', 'healthy', 'zero_ads', 'failing', 'paused')),
  add column if not exists initial_fill_completed_at timestamptz,
  add column if not exists last_scan_started_at timestamptz,
  add column if not exists last_scan_completed_at timestamptz,
  add column if not exists last_successful_scan_at timestamptz,
  add column if not exists next_scan_at timestamptz not null default now(),
  add column if not exists has_ever_run_ads boolean not null default false,
  add column if not exists current_active_ad_count int not null default 0,
  add column if not exists last_active_ad_seen_at timestamptz,
  add column if not exists consecutive_failures int not null default 0,
  add column if not exists backoff_until timestamptz;

-- Derive owner_type from existing descriptive relationships (never used to
-- gate scanning).
update research.advertiser_pages ap
set owner_type = case
  when ap.agent_id is not null then 'agent'
  when ap.agency_id is not null then 'agency'
  else 'unknown'
end
where ap.owner_type = 'unknown';

-- Seed has_ever_run_ads / active counts from observed ads.
update research.advertiser_pages ap
set has_ever_run_ads = true,
    current_active_ad_count = stats.active_count,
    last_active_ad_seen_at = stats.last_active_seen_at
from (
  select
    oa.advertiser_page_id,
    count(*) filter (where oa.active_status = 'active') as active_count,
    max(oa.last_seen_at) filter (where oa.active_status = 'active') as last_active_seen_at
  from research.observed_ads oa
  group by oa.advertiser_page_id
) stats
where stats.advertiser_page_id = ap.id;

-- Pages that have already had at least one successful check are out of the
-- first-fill queue; never-checked pages stay in it (next_scan_at = now()).
update research.advertiser_pages ap
set scan_state = case
      when ap.backoff_until is not null and ap.backoff_until > now() then 'failing'
      when ap.has_ever_run_ads and ap.current_active_ad_count > 0 then 'healthy'
      when ap.last_successful_check_at is not null then 'zero_ads'
      else 'needs_first_fill'
    end,
    last_successful_scan_at = ap.last_successful_check_at,
    last_scan_completed_at = ap.last_checked_at
where ap.scan_state = 'needs_first_fill' and ap.last_checked_at is not null;

create index if not exists advertiser_pages_scan_due_idx
  on research.advertiser_pages (next_scan_at asc)
  where scan_enabled = true
    and scan_state <> 'paused';
create index if not exists advertiser_pages_scan_state_idx
  on research.advertiser_pages (scan_state);
create index if not exists advertiser_pages_owner_type_idx
  on research.advertiser_pages (owner_type);

comment on column research.advertiser_pages.scan_enabled is
  'Scheduling gate. Scanning never depends on agent/agency resolution or approval.';

-- ---------------------------------------------------------------------------
-- 2. ad_fetch_runs: page reference + scan mode + provider telemetry
-- ---------------------------------------------------------------------------
alter table research.ad_fetch_runs
  add column if not exists advertiser_page_id uuid references research.advertiser_pages (id) on delete set null,
  add column if not exists scan_mode text
    check (scan_mode in ('initial_fill', 'refresh', 'manual')),
  add column if not exists idempotency_key text,
  add column if not exists scraper_run_id text,
  add column if not exists provider_request_count int,
  add column if not exists provider_credits numeric(12, 4),
  add column if not exists provider_cost_usd numeric(12, 6),
  add column if not exists scrapingbee_tier text,
  add column if not exists coverage_complete boolean,
  add column if not exists pagination_exhausted boolean,
  add column if not exists stop_reason text,
  add column if not exists dataset_checksum text;

-- New scans must reject runs without a valid Page FK. Old rows keep
-- scan_mode null and pass this check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ad_fetch_runs_scan_requires_page'
      and conrelid = 'research.ad_fetch_runs'::regclass
  ) then
    execute $ddl$alter table research.ad_fetch_runs
      add constraint ad_fetch_runs_scan_requires_page
      check (scan_mode is null or advertiser_page_id is not null) not valid$ddl$;
  end if;
end $$;

-- Backfill: collector runs store the internal page UUID in target_value.
update research.ad_fetch_runs afr
set advertiser_page_id = ap.id,
    scan_mode = 'refresh'
from research.advertiser_pages ap
where afr.target_kind = 'advertiser_page'
  and afr.advertiser_page_id is null
  and ap.id::text = afr.target_value;

alter table research.ad_fetch_runs
  validate constraint ad_fetch_runs_scan_requires_page;

create unique index if not exists ad_fetch_runs_idempotency_key_idx
  on research.ad_fetch_runs (idempotency_key)
  where idempotency_key is not null;
create index if not exists ad_fetch_runs_page_started_idx
  on research.ad_fetch_runs (advertiser_page_id, started_at desc);
create index if not exists ad_fetch_runs_scan_mode_idx
  on research.ad_fetch_runs (scan_mode, started_at desc);

-- ---------------------------------------------------------------------------
-- 3. observed_ads: lifecycle timestamps
-- ---------------------------------------------------------------------------
alter table research.observed_ads
  add column if not exists source_created_at timestamptz,
  add column if not exists source_delivery_started_at timestamptz,
  add column if not exists source_delivery_stopped_at timestamptz,
  add column if not exists first_seen_active_at timestamptz,
  add column if not exists last_seen_active_at timestamptz,
  add column if not exists missing_since timestamptz,
  add column if not exists inactive_at timestamptz,
  add column if not exists reactivated_at timestamptz;

update research.observed_ads oa
set source_created_at = oa.ad_creation_date::timestamptz,
    source_delivery_started_at = oa.ad_delivery_started_at,
    source_delivery_stopped_at = oa.ad_delivery_stopped_at,
    first_seen_active_at = case when oa.active_status = 'active' then oa.first_seen_at end,
    last_seen_active_at = case when oa.active_status = 'active' then oa.last_seen_at end,
    inactive_at = case when oa.active_status = 'inactive' then oa.updated_at end;

comment on column research.observed_ads.missing_since is
  'First time a complete comparable scan did not see this ad. Only meaningful when the causing run was coverage_complete.';
comment on column research.observed_ads.inactive_at is
  'When active_status flipped to inactive. Set only by research.mark_missing_ads_inactive() from a complete comparable run.';

-- ---------------------------------------------------------------------------
-- 4. Safe inactivation (partial/failed scans never flip lifecycle)
-- ---------------------------------------------------------------------------
create or replace function research.mark_missing_ads_inactive(
  p_run_id uuid,
  p_seen_external_ad_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = research, pg_temp
as $$
declare
  v_run research.ad_fetch_runs;
  v_page_id uuid;
  v_active_checked int := 0;
  v_marked_missing int := 0;
  v_marked_inactive int := 0;
  v_reactivated int := 0;
  v_checked_at timestamptz := now();
  v_seen text;
begin
  select * into v_run from research.ad_fetch_runs where id = p_run_id;
  if not found then
    raise exception 'ad_fetch_run % not found', p_run_id;
  end if;

  -- Hard rule: only a successful, coverage-complete, pagination-exhausted run
  -- may change lifecycle state. Anything else is absence-of-evidence only.
  if v_run.status <> 'success'
     or coalesce(v_run.coverage_complete, false) <> true
     or coalesce(v_run.pagination_exhausted, false) <> true
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'run_not_complete_comparable',
      'run_status', v_run.status,
      'coverage_complete', v_run.coverage_complete,
      'pagination_exhausted', v_run.pagination_exhausted
    );
  end if;

  v_page_id := v_run.advertiser_page_id;
  if v_page_id is null then
    raise exception 'run % has no advertiser_page_id', p_run_id;
  end if;

  create temp table _seen_ads on commit drop as
    select distinct unnest(p_seen_external_ad_ids) as external_ad_id where external_ad_id is not null;

  -- First miss: stamp missing_since; count the miss. These updates are
  -- lifecycle-neutral (they never change active_status).
  update research.observed_ads oa
  set missing_successive_checks = least(99, coalesce(oa.missing_successive_checks, 0) + 1),
      missing_since = coalesce(oa.missing_since, v_checked_at),
      last_checked_at = v_checked_at
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and oa.external_ad_id not in (select external_ad_id from _seen_ads);
  get diagnostics v_marked_missing = row_count;

  -- Flip to inactive only after 2 consecutive complete comparable misses.
  update research.observed_ads oa
  set active_status = 'inactive',
      inactive_at = v_checked_at,
      source_delivery_stopped_at = coalesce(oa.source_delivery_stopped_at, oa.ad_delivery_stopped_at, v_checked_at),
      ad_delivery_stopped_at = coalesce(oa.ad_delivery_stopped_at, v_checked_at)
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and oa.missing_successive_checks >= 2
    and oa.external_ad_id not in (select external_ad_id from _seen_ads);
  get diagnostics v_marked_inactive = row_count;

  -- Seen again: reset miss counters and record active observation.
  update research.observed_ads oa
  set last_checked_at = v_checked_at,
      last_seen_active_at = v_checked_at,
      missing_successive_checks = 0,
      missing_since = null
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and oa.external_ad_id in (select external_ad_id from _seen_ads);

  -- Ads of this page that were inactive but reappeared in this run become
  -- active again with reactivated_at stamped.
  update research.observed_ads oa
  set active_status = 'active',
      reactivated_at = v_checked_at,
      last_seen_active_at = v_checked_at,
      inactive_at = null,
      missing_successive_checks = 0,
      missing_since = null,
      last_checked_at = v_checked_at
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'inactive'
    and oa.external_ad_id in (select external_ad_id from _seen_ads);
  get diagnostics v_reactivated = row_count;

  select count(*) into v_active_checked
  from research.observed_ads
  where advertiser_page_id = v_page_id and active_status = 'active';

  return jsonb_build_object(
    'allowed', true,
    'page_id', v_page_id,
    'active_ads_checked', v_active_checked,
    'missing_seen', v_marked_missing,
    'marked_inactive', v_marked_inactive,
    'reactivated', v_reactivated
  );
end;
$$;

grant execute on function research.mark_missing_ads_inactive(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Durable page-scan scheduling (replaces refresh_policies as scheduler input)
-- ---------------------------------------------------------------------------
-- Cadence per repair plan:
--   active ads        -> every 24 hours
--   historical ads    -> every 72 hours
--   no ads            -> every 7 days
--   failed            -> exponential backoff (1h * 2^n, capped at 7 days)
--   never scanned     -> first-fill queue (immediately due)
create or replace function research.schedule_page_after_scan(
  p_page_id uuid,
  p_success boolean,
  p_coverage_complete boolean default null
)
returns timestamptz
language plpgsql
security definer
set search_path = research, pg_temp
as $$
declare
  v_page research.advertiser_pages;
  v_next timestamptz;
  v_now timestamptz := now();
begin
  select * into v_page from research.advertiser_pages where id = p_page_id;
  if not found then
    raise exception 'advertiser_page % not found', p_page_id;
  end if;

  update research.advertiser_pages ap
  set current_active_ad_count = sub.active_count,
      last_active_ad_seen_at = coalesce(sub.last_active_seen_at, ap.last_active_ad_seen_at),
      has_ever_run_ads = ap.has_ever_run_ads or sub.total_count > 0
  from (
    select
      oa.advertiser_page_id,
      count(*) filter (where oa.active_status = 'active') as active_count,
      max(oa.last_seen_at) filter (where oa.active_status = 'active') as last_active_seen_at,
      count(*) as total_count
    from research.observed_ads oa
    where oa.advertiser_page_id = p_page_id
    group by oa.advertiser_page_id
  ) sub
  where sub.advertiser_page_id = ap.id;

  select * into v_page from research.advertiser_pages where id = p_page_id;

  if not p_success then
    v_next := v_now + least(
      interval '168 hours',
      interval '1 hour' * power(2, least(coalesce(v_page.consecutive_failures, 0), 10))
    );
    update research.advertiser_pages
    set backoff_until = v_next,
        next_scan_at = v_next,
        scan_state = case when scan_state <> 'paused' then 'failing' else scan_state end
    where id = p_page_id;
    return v_next;
  end if;

  -- Success: clear backoff and pick cadence from observed-ad state.
  if v_page.current_active_ad_count > 0 then
    v_next := v_now + interval '24 hours';
  elsif v_page.has_ever_run_ads then
    v_next := v_now + interval '72 hours';
  else
    v_next := v_now + interval '7 days';
  end if;

  update research.advertiser_pages
  set backoff_until = null,
      next_scan_at = v_next,
      consecutive_failures = 0,
      last_successful_scan_at = v_now,
      scan_state = case
        when scan_state in ('paused') then scan_state
        when current_active_ad_count > 0 then 'healthy'
        when has_ever_run_ads then 'healthy'
        else 'zero_ads'
      end,
      initial_fill_completed_at = coalesce(initial_fill_completed_at, v_now)
  where id = p_page_id;

  return v_next;
end;
$$;

grant execute on function research.schedule_page_after_scan(uuid, boolean, boolean) to service_role;

-- Apply the new schedule to every page right now.
do $$
declare
  v_page record;
begin
  for v_page in
    select ap.id,
           (ap.backoff_until > now()) as backoff_pending,
           (ap.last_successful_check_at is not null) as ever_ok
    from research.advertiser_pages ap
  loop
    if v_page.backoff_pending then
      update research.advertiser_pages
      set next_scan_at = backoff_until,
          scan_state = case when scan_state = 'paused' then 'paused' else 'failing' end
      where id = v_page.id;
    elsif not v_page.ever_ok then
      update research.advertiser_pages
      set next_scan_at = now(), scan_state = case when scan_state = 'paused' then 'paused' else 'needs_first_fill' end
      where id = v_page.id;
    else
      perform research.schedule_page_after_scan(v_page.id, true, true);
    end if;
  end loop;
end $$;

comment on table research.refresh_policies is
  'DEPRECATED 2026-09-05: postcode-based refresh scheduling is retired. The '
  'Ad Radar scheduler reads scan state from research.advertiser_pages '
  '(scan_enabled, next_scan_at, backoff_until, scan_state) instead. Kept for '
  'migration safety and historical coverage views; no new scheduling input.';

alter table research.refresh_policies
  add column if not exists deprecated_at timestamptz;

update research.refresh_policies
set deprecated_at = coalesce(deprecated_at, now())
where deprecated_at is null;

notify pgrst, 'reload schema';
