-- Ad Radar v2 repair follow-ups (post-review fixes; do not edit 2026090500*).
--
-- 1. Fix research.mark_missing_ads_inactive (the _seen_ads temp table used an
--    invalid SELECT aliasing pattern and never worked).
-- 2. Stop inventing source delivery dates when an ad merely disappears.
-- 3. Two complete comparable misses remain the inactivity rule (unchanged).
-- 4. slug:* placeholder page_ids become NULL unresolved identifiers;
--    page_id must be a real numeric Meta Page ID or NULL.
-- 5. ad_fetch_attempts: one row per external provider request.
-- 6. provider_credit_budgets + atomic reserve/settle functions.
-- 7. schema_migration_ledger + records for the migrations applied manually.
-- 8. Reset scrapingbee runs stuck in 'running'.

-- ---------------------------------------------------------------------------
-- 1-3. Lifecycle function (full replacement)
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
  v_marked_inactive int := 0;
  v_reactivated int := 0;
  v_checked_at timestamptz := now();
begin
  select * into v_run from research.ad_fetch_runs where id = p_run_id;
  if not found then
    raise exception 'ad_fetch_run % not found', p_run_id;
  end if;

  -- Hard rule: only a successful run recorded as coverage_complete AND
  -- pagination_exhausted (page_info has_next_page = false downstream) may
  -- change lifecycle state. Anything else is absence-of-evidence only.
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
    select distinct x as external_ad_id
    from unnest(p_seen_external_ad_ids) as x
    where x is not null;

  -- First miss: stamp missing_since and count the miss. Lifecycle-neutral.
  update research.observed_ads oa
  set missing_successive_checks = least(99, coalesce(oa.missing_successive_checks, 0) + 1),
      missing_since = coalesce(oa.missing_since, v_checked_at),
      last_checked_at = v_checked_at
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and not exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  get diagnostics v_active_checked = row_count;

  -- Flip to inactive only after 2 consecutive complete comparable misses.
  -- Delivery dates come from the source only; an ad disappearing from a scan
  -- never invents a stopped date.
  update research.observed_ads oa
  set active_status = 'inactive',
      inactive_at = v_checked_at
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and oa.missing_successive_checks >= 2
    and not exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  get diagnostics v_marked_inactive = row_count;

  -- Seen again: reset miss counters and record the active observation.
  update research.observed_ads oa
  set last_checked_at = v_checked_at,
      last_seen_active_at = v_checked_at,
      missing_successive_checks = 0,
      missing_since = null
  where oa.advertiser_page_id = v_page_id
    and oa.active_status = 'active'
    and exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);

  -- Inactive ads that reappeared in this complete run become active again.
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
    and exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  get diagnostics v_reactivated = row_count;

  return jsonb_build_object(
    'allowed', true,
    'page_id', v_page_id,
    'active_ads_checked', v_active_checked,
    'marked_inactive', v_marked_inactive,
    'reactivated', v_reactivated
  );
end;
$$;

grant execute on function research.mark_missing_ads_inactive(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. slug:* page_ids -> NULL unresolved identifiers
-- ---------------------------------------------------------------------------
alter table research.advertiser_pages
  add column if not exists page_vanity text;

-- Unresolved pages must be representable: page_id becomes nullable and the
-- numeric-only check below keeps real Meta Page IDs the only values.
alter table research.advertiser_pages
  alter column page_id drop not null;

update research.advertiser_pages
set page_vanity = substring(page_id from 7),
    page_id = null
where page_id like 'slug:%';

-- page_id is a real numeric Meta Page ID or NULL (unresolved).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'advertiser_pages_page_id_numeric'
      and conrelid = 'research.advertiser_pages'::regclass
  ) then
    execute $ddl$alter table research.advertiser_pages
      add constraint advertiser_pages_page_id_numeric
      check (page_id is null or page_id ~ '^[0-9]+$') not valid$ddl$;
  end if;
end $$;

alter table research.advertiser_pages
  validate constraint advertiser_pages_page_id_numeric;

create index if not exists advertiser_pages_page_vanity_idx
  on research.advertiser_pages (page_vanity)
  where page_vanity is not null;

comment on column research.advertiser_pages.page_id is
  'Real numeric Meta Page ID, or NULL while unresolved. Vanity/slug handles '
  'live in page_vanity and never satisfy the acquisition spine.';

-- ---------------------------------------------------------------------------
-- 5. ad_fetch_attempts: one row per external provider request
-- ---------------------------------------------------------------------------
create table if not exists research.ad_fetch_attempts (
  id uuid primary key default gen_random_uuid(),
  ad_fetch_run_id uuid references research.ad_fetch_runs (id) on delete cascade,
  advertiser_page_id uuid,
  provider text not null,
  attempt_index int not null default 1,
  idempotency_key text unique,
  tier text,
  request_url_host text,
  request_params jsonb not null default '{}'::jsonb,
  http_status int,
  provider_http_status int,
  spb_cost numeric(12, 4),
  spb_auto_cost numeric(12, 4),
  spb_request_id text,
  credits_charged numeric(12, 4) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  outcome text not null
    check (outcome in ('success', 'blocked', 'unparseable', 'error')),
  response_bytes int,
  duration_ms int,
  error text,
  raw_evidence_ref text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ad_fetch_attempts_run_idx
  on research.ad_fetch_attempts (ad_fetch_run_id);
create index if not exists ad_fetch_attempts_provider_started_idx
  on research.ad_fetch_attempts (provider, started_at desc);

comment on table research.ad_fetch_attempts is
  'One row per external provider HTTP request, written regardless of outcome. '
  'Paid failed attempts are never dropped. credits_charged comes from '
  'Spb-cost (auto tier) and reconciles against provider_credit_budgets.';

-- ---------------------------------------------------------------------------
-- 6. Atomic provider credit budget
-- ---------------------------------------------------------------------------
create table if not exists research.provider_credit_budgets (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  period_start date not null,
  max_credits numeric(12, 4) not null,
  reserved_credits numeric(12, 4) not null default 0,
  spent_credits numeric(12, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, period_start)
);

comment on table research.provider_credit_budgets is
  'DB-side atomic credit ceiling, the spending authority. ScrapingBee''s '
  '/usage endpoint is rate-limited (6 calls/min) and used only for '
  'reconciliation, never as the gate. Reserve before each request; settle '
  'with the actual Spb-cost afterwards.';

-- Seed the current ScrapingBee period. 950 of 1000 credits were already spent
-- during pilot/review (renewal 2026-09-20).
insert into research.provider_credit_budgets (provider, period_start, max_credits, spent_credits)
values ('scrapingbee', date '2026-08-20', 1000, 950)
on conflict (provider, period_start) do nothing;

create or replace function research.reserve_provider_credits(
  p_provider text,
  p_credits numeric
)
returns uuid
language plpgsql
security definer
set search_path = research, pg_temp
as $$
declare
  v_budget_id uuid;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'reserve amount must be positive';
  end if;
  -- Single atomic UPDATE: the row lock makes the check-and-reserve
  -- indivisible. No matching row means the budget is exhausted.
  update research.provider_credit_budgets b
  set reserved_credits = b.reserved_credits + p_credits,
      updated_at = now()
  where b.id = (
    select id from research.provider_credit_budgets
    where provider = p_provider
    order by period_start desc
    limit 1
    for update
  )
    and b.max_credits - b.reserved_credits - b.spent_credits >= p_credits
  returning b.id into v_budget_id;

  if v_budget_id is null then
    raise exception 'credit_budget_exhausted: provider % cannot reserve % credits', p_provider, p_credits;
  end if;
  return v_budget_id;
end;
$$;

create or replace function research.settle_provider_credits(
  p_budget_id uuid,
  p_reserved numeric,
  p_actual numeric
)
returns void
language plpgsql
security definer
set search_path = research, pg_temp
as $$
begin
  update research.provider_credit_budgets
  set reserved_credits = greatest(0, reserved_credits - coalesce(p_reserved, 0)),
      spent_credits = spent_credits + coalesce(p_actual, 0),
      updated_at = now()
  where id = p_budget_id;
end;
$$;

grant execute on function research.reserve_provider_credits(text, numeric) to service_role;
grant execute on function research.settle_provider_credits(uuid, numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Migration ledger
-- ---------------------------------------------------------------------------
create table if not exists research.schema_migration_ledger (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default 'manual',
  note text
);

comment on table research.schema_migration_ledger is
  'Checksum ledger for research-schema migrations applied outside a managed '
  'migrator. Every future migration must record its row (version, name, '
  'sha256) as its final statement via scripts/research/record-migration-ledger.mjs.';

insert into research.schema_migration_ledger (version, name, checksum, applied_by, note) values
  ('202609050001', '202609050001_page_scan_spine.sql', 'cd502bf48d9d05157c0eb0c45d5fcf26869c2a4fc2340532809b8633d2dc6868', 'manual', 'page scan spine; applied directly 2026-09-05'),
  ('202609050002', '202609050002_search_and_media.sql', '310571049cd30f0c46a0c6f6d970cf2bddd634c91f725f94fbbd25a4f6aad5a9', 'manual', 'creative/media canonicalization + search documents; applied directly 2026-09-05'),
  ('202609050003', '202609050003_disable_slug_placeholder_scans.sql', 'a2da29ea31184a1809bd248dbdd1dd400896bfc54104d0bd65cf077485dad091', 'manual', 'slug placeholder scan pause; applied directly 2026-09-05'),
  ('202609050004', '202609050004_search_docs_rls_media_object_key.sql', '8e3d2f45d93e3a47c33141b950df69c49a5e74d116113b1d4dad4ce647a8c4f4', 'manual', 'search docs RLS + object_key backfill; applied directly 2026-09-05')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Reset runs stuck in 'running'
-- ---------------------------------------------------------------------------
update research.ad_fetch_runs
set status = 'failed',
    error = coalesce(error, 'stuck_running_reset: no completion recorded'),
    completed_at = now(),
    result_summary = result_summary || jsonb_build_object('reset_reason', 'stuck_running_reset')
where status = 'running'
  and started_at < now() - interval '2 hours';

notify pgrst, 'reload schema';
