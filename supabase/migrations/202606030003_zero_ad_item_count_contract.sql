-- Keep zero-ad diagnostics aligned with the Hermes runtime result_summary keys.
-- The runtime writes item_count; older diagnostics only checked itemCount and
-- ads_observed, which reopened false zero-ad anomalies.

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
      and coalesce((afr.result_summary->>'confirmed_absence')::boolean, false) = false
      and research.jsonb_int(afr.result_summary, array['item_count', 'ads_observed', 'adsObserved', 'itemCount'], 0) = 0
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

create or replace view research.v_operator_zero_ad_anomalies as
select
  afr.id as ad_fetch_run_id,
  afr.source_provider,
  afr.target_kind,
  afr.target_value,
  afr.started_at,
  afr.completed_at,
  afr.result_summary,
  research.jsonb_int(afr.result_summary, array['item_count', 'ads_observed', 'adsObserved', 'itemCount'], 0) as ads_observed
from research.ad_fetch_runs afr
where afr.status in ('success', 'partial')
  and afr.result_summary <> '{}'::jsonb
  and coalesce((afr.result_summary->>'confirmed_absence')::boolean, false) = false
  and research.jsonb_int(afr.result_summary, array['item_count', 'ads_observed', 'adsObserved', 'itemCount'], 0) = 0
order by afr.started_at desc;

grant select on research.v_operator_zero_ad_anomalies to authenticated, service_role;
revoke execute on function research.watchdog_record_zero_ad_anomalies(interval, int) from public;
grant execute on function research.watchdog_record_zero_ad_anomalies(interval, int) to service_role;
