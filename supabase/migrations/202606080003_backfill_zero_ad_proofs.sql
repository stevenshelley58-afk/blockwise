-- Backfill canonical zero-ad proof flags for runs written before the runtime
-- exposed confirmed_absence and count_only at the top level of result_summary.

update research.ad_fetch_runs
set result_summary = result_summary || jsonb_build_object('confirmed_absence', true)
where status in ('success', 'partial')
  and coalesce((result_summary->>'confirmed_absence')::boolean, false) = false
  and coalesce((result_summary->'metadata'->>'confirmed_absence')::boolean, false) = true;

update research.ad_fetch_runs
set result_summary = result_summary || jsonb_build_object('count_only', true)
where status in ('success', 'partial')
  and coalesce((result_summary->>'count_only')::boolean, false) = false
  and coalesce((result_summary->'metadata'->>'count_only')::boolean, false) = true;

update research.build_run_reports brr
set status = 'resolved',
    report = brr.report || jsonb_build_object(
      'resolved_by', '202606080003_backfill_zero_ad_proofs',
      'resolved_reason', 'confirmed_absence_or_count_only'
    ),
    last_seen_at = now()
where brr.report_type = 'zero_ad_anomaly'
  and brr.status <> 'resolved'
  and (brr.report->>'ad_fetch_run_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from research.ad_fetch_runs afr
    where afr.id = (brr.report->>'ad_fetch_run_id')::uuid
      and (
        coalesce((afr.result_summary->>'confirmed_absence')::boolean, false) = true
        or coalesce((afr.result_summary->>'count_only')::boolean, false) = true
      )
  );
