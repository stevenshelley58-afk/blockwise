-- Forward migration: (re)create research work-queue + watchdog RPCs.
-- They were added to 202605300003 after that migration had already been applied
-- to the blockwise project, so the live supervisor 404'd on them. Idempotent.

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

notify pgrst, 'reload schema';
