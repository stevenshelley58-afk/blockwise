-- Additive Apify cost-control schema support.
-- Keeps Apify as a capped fallback provider and exposes paid-spend health.

create table if not exists research.runtime_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  description text,
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now(),
  constraint runtime_settings_key_not_blank check (btrim(setting_key) <> '')
);

create table if not exists research.capture_actors (
  actor_id text primary key,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'rejected', 'banned')),
  price_per_1k_usd numeric(12, 6)
    check (price_per_1k_usd is null or price_per_1k_usd >= 0),
  pricing_checked_at timestamptz,
  schema_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schema_map) = 'object'),
  last_benchmark jsonb not null default '{}'::jsonb
    check (jsonb_typeof(last_benchmark) = 'object'),
  notes text,
  updated_at timestamptz not null default now(),
  constraint capture_actors_actor_id_not_blank check (btrim(actor_id) <> '')
);

drop trigger if exists trg_runtime_settings_updated_at on research.runtime_settings;
create trigger trg_runtime_settings_updated_at
  before update on research.runtime_settings
  for each row execute function research.set_updated_at();

drop trigger if exists trg_capture_actors_updated_at on research.capture_actors;
create trigger trg_capture_actors_updated_at
  before update on research.capture_actors
  for each row execute function research.set_updated_at();

insert into research.runtime_settings (setting_key, setting_value, description)
values
  ('apify_enabled', 'true'::jsonb, 'Allows the runtime to consider Apify as a paid fallback when budget and actor checks pass.'),
  ('apify_state', to_jsonb('ready'::text), 'Current Apify circuit state; circuit_open blocks paid dispatch.'),
  ('apify_monthly_cap_usd', '25'::jsonb, 'Blockwise soft monthly Apify cap, below the account hard limit.'),
  ('apify_per_run_cap_usd', '1.00'::jsonb, 'Required maxTotalChargeUsd cap for each Apify run.'),
  ('apify_account_limit_usd', '30'::jsonb, 'Expected Apify account monthly hard limit.'),
  ('apify_actor_id', 'null'::jsonb, 'Selected approved Apify actor; null until a capped benchmark promotes an actor.'),
  ('apify_result_limit', '250'::jsonb, 'Default result cap for paid fallback runs.'),
  ('apify_canary_max_results', '50'::jsonb, 'Maximum results for capped Apify canary benchmark runs.'),
  ('apify_canary_per_run_cap_usd', '0.25'::jsonb, 'Maximum charge for capped Apify canary benchmark runs.')
on conflict (setting_key) do nothing;

insert into research.capture_actors (
  actor_id,
  status,
  schema_map,
  last_benchmark,
  notes
)
values
  (
    'automly/facebook-ad-library-scraper',
    'candidate',
    '{}'::jsonb,
    '{}'::jsonb,
    'Candidate for capped Apify benchmark; do not run uncapped.'
  ),
  (
    'constructive_calm/facebook-ad-library-pro',
    'candidate',
    '{}'::jsonb,
    '{}'::jsonb,
    'Candidate for capped Apify benchmark; do not run uncapped.'
  ),
  (
    'curious_coder/facebook-ads-library-scraper',
    'candidate',
    '{}'::jsonb,
    '{}'::jsonb,
    'Candidate for capped Apify benchmark; do not run uncapped.'
  )
on conflict (actor_id) do nothing;

insert into research.capture_actors (
  actor_id,
  status,
  price_per_1k_usd,
  pricing_checked_at,
  schema_map,
  last_benchmark,
  notes
)
values (
  'apify/facebook-ads-scraper',
  'banned',
  4.30,
  '2026-06-08 00:00:00+00'::timestamptz,
  '{}'::jsonb,
  '{}'::jsonb,
  'Banned: official actor is too expensive for fallback capture.'
)
on conflict (actor_id) do update
  set status = 'banned',
      price_per_1k_usd = coalesce(research.capture_actors.price_per_1k_usd, excluded.price_per_1k_usd),
      pricing_checked_at = coalesce(research.capture_actors.pricing_checked_at, excluded.pricing_checked_at),
      notes = case
        when research.capture_actors.notes is null or btrim(research.capture_actors.notes) = '' then excluded.notes
        else research.capture_actors.notes
      end,
      updated_at = now()
  where research.capture_actors.status <> 'banned';

alter table research.runtime_settings enable row level security;
alter table research.capture_actors enable row level security;

revoke all on research.runtime_settings from public, anon, authenticated;
revoke all on research.capture_actors from public, anon, authenticated;

grant select, insert, update, delete on research.runtime_settings to service_role;
grant select, insert, update, delete on research.capture_actors to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'research'
      and tablename = 'runtime_settings'
      and policyname = 'runtime_settings_service_role_all'
  ) then
    create policy runtime_settings_service_role_all
      on research.runtime_settings
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'research'
      and tablename = 'capture_actors'
      and policyname = 'capture_actors_service_role_all'
  ) then
    create policy capture_actors_service_role_all
      on research.capture_actors
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

create or replace view research.v_health as
with apify_spend as (
  select coalesce(sum(coalesce(afr.cost_usd, 0)), 0)::numeric(12, 6) as apify_mtd_spend_usd
  from research.ad_fetch_runs afr
  where afr.source_provider like 'apify:%'
    and afr.started_at >= date_trunc('month', now())
),
paid_apify_24h as (
  select
    afr.source_provider,
    sum(coalesce(afr.cost_usd, 0)) as cost_usd
  from research.ad_fetch_runs afr
  where afr.source_provider like 'apify:%'
    and afr.started_at >= now() - interval '24 hours'
  group by afr.source_provider
  having sum(coalesce(afr.cost_usd, 0)) > 0
),
ingested_apify_24h as (
  select
    oa.first_seen_provider as source_provider,
    count(*) as ingested_ads
  from research.observed_ads oa
  where oa.first_seen_provider like 'apify:%'
    and oa.first_seen_at >= now() - interval '24 hours'
  group by oa.first_seen_provider
),
queue_health as (
  select
    count(*) filter (where status = 'pending' and available_at <= now()) as due_backlog_size,
    count(*) filter (where status = 'blocked') as blocked_job_count
  from research.work_queue
),
open_reports as (
  select count(*) filter (where status = 'open') as open_report_count
  from research.build_run_reports
),
last_activity as (
  select
    (select max(started_at) from research.ad_fetch_runs) as latest_fetch_started_at,
    (select max(created_at) from research.ingest_events) as latest_ingest_at
),
apify_setting as (
  select trim(both '"' from setting_value::text) as apify_state
  from research.runtime_settings
  where setting_key = 'apify_state'
  limit 1
)
select
  now() as checked_at,
  last_activity.latest_fetch_started_at,
  last_activity.latest_ingest_at,
  coalesce(queue_health.due_backlog_size, 0)::bigint as due_backlog_size,
  coalesce(queue_health.blocked_job_count, 0)::bigint as blocked_job_count,
  coalesce(open_reports.open_report_count, 0)::bigint as open_report_count,
  apify_spend.apify_mtd_spend_usd,
  coalesce(apify_setting.apify_state, 'unknown') as apify_state,
  exists (
    select 1
    from paid_apify_24h paid
    left join ingested_apify_24h ingested on ingested.source_provider = paid.source_provider
    where coalesce(ingested.ingested_ads, 0) = 0
  ) as paid_spend_without_ingest
from apify_spend
cross join queue_health
cross join open_reports
cross join last_activity
left join apify_setting on true;

grant select on research.v_health to authenticated, service_role;

notify pgrst, 'reload schema';
