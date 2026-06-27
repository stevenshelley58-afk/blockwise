-- Keep Apify accounting actor-qualified.
--
-- The collector temporarily wrote Apify page captures as source_provider='apify'
-- while the actor-qualified provider lived in result_summary.metadata.provider.
-- Health and circuit checks expect apify:<actor_id>, so backfill the rows and
-- make the health view tolerate both shapes.

begin;

update research.ad_fetch_runs
set source_provider = result_summary #>> '{metadata,provider}'
where source_provider = 'apify'
  and result_summary #>> '{metadata,provider}' like 'apify:%';

create or replace view research.v_health as
with apify_spend as (
  select coalesce(sum(coalesce(afr.cost_usd, 0)), 0)::numeric(12, 6) as apify_mtd_spend_usd
  from research.ad_fetch_runs afr
  where (afr.source_provider = 'apify' or afr.source_provider like 'apify:%')
    and afr.started_at >= date_trunc('month', now())
),
apify_setting as (
  select trim(both '"' from setting_value::text) as apify_state
  from research.runtime_settings
  where setting_key = 'apify_state'
  limit 1
),
active_apify_provider as (
  select
    case
      when actor_id is null or btrim(actor_id) = '' then null
      else 'apify:' || actor_id
    end as source_provider
  from (
    select nullif(trim(both '"' from (
      select rs.setting_value::text
      from research.runtime_settings rs
      where rs.setting_key = 'apify_actor_id'
      limit 1
    )), 'null') as actor_id
  ) selected_actor
),
active_paid_apify_24h as (
  select
    afr.source_provider,
    sum(coalesce(afr.cost_usd, 0)) as cost_usd
  from research.ad_fetch_runs afr
  cross join active_apify_provider active
  where active.source_provider is not null
    and (afr.source_provider = active.source_provider or afr.source_provider = 'apify')
    and afr.started_at >= now() - interval '24 hours'
  group by afr.source_provider
  having sum(coalesce(afr.cost_usd, 0)) > 0
),
active_positive_apify_24h as (
  select afr.source_provider, count(*) as positive_runs
  from research.ad_fetch_runs afr
  cross join active_apify_provider active
  where active.source_provider is not null
    and (afr.source_provider = active.source_provider or afr.source_provider = 'apify')
    and afr.started_at >= now() - interval '24 hours'
    and afr.status in ('success', 'partial')
    and greatest(
      research.jsonb_int(afr.result_summary, array['ingested_count', 'ads_ingested', 'adsIngested'], 0),
      research.jsonb_int(afr.result_summary, array['item_count', 'valid_ad_count', 'ads_observed', 'adsObserved', 'itemCount'], 0)
    ) > 0
  group by afr.source_provider
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
    from active_paid_apify_24h paid
    left join active_positive_apify_24h positive on positive.source_provider = paid.source_provider
    where coalesce(positive.positive_runs, 0) = 0
  ) as paid_spend_without_ingest
from apify_spend
cross join queue_health
cross join open_reports
cross join last_activity
left join apify_setting on true;

grant select on research.v_health to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
