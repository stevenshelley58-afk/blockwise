-- Ad Radar scan truth. Depends on the signup-owned customer interest table migration.
-- The scheduler is driven by a completed ad_fetch_runs row; it never infers
-- current truth by counting historical observed_ads.
alter table research.advertiser_pages
  add column if not exists confirmed_zero_scans integer not null default 0,
  add column if not exists last_confirmed_zero_at timestamptz,
  add column if not exists last_scheduled_scan_run_id uuid references research.ad_fetch_runs(id);
alter table research.ad_fetch_runs
  add column if not exists ad_radar_scheduled_at timestamptz;
drop function if exists research.schedule_page_after_scan(uuid, boolean, boolean);
drop function if exists research.schedule_page_after_scan(uuid, boolean);
create or replace function research.schedule_ad_radar_after_run(p_run_id uuid)
returns timestamptz language plpgsql security definer set search_path = research, pg_temp as $$
declare
  v_run research.ad_fetch_runs%rowtype;
  v_page research.advertiser_pages%rowtype;
  v_now timestamptz := now(); v_next timestamptz;
  v_failure_count integer; v_zero_scans integer;
  v_active_text text; v_active_count integer; v_customer_daily boolean := false;
begin
  select * into v_run from research.ad_fetch_runs where id = p_run_id for update;
  if not found then raise exception 'ad_fetch_run % not found', p_run_id; end if;
  if v_run.advertiser_page_id is null then raise exception 'ad_fetch_run % has no advertiser_page_id', p_run_id; end if;
  select * into v_page from research.advertiser_pages where id = v_run.advertiser_page_id for update;
  if not found then raise exception 'advertiser_page % not found', v_run.advertiser_page_id; end if;
  if v_run.ad_radar_scheduled_at is not null then return v_page.next_scan_at; end if;
  -- A delayed older run may be delivered after a newer run. Mark it handled
  -- but never regress the page truth established by the newer completion.
  if v_page.last_scheduled_scan_run_id is not null
     and v_run.completed_at is not null
     and v_page.last_scan_completed_at is not null
     and v_run.completed_at <= v_page.last_scan_completed_at then
    update research.ad_fetch_runs set ad_radar_scheduled_at = v_now where id = p_run_id;
    return v_page.next_scan_at;
  end if;
  v_active_text := nullif(btrim(v_run.result_summary ->> 'active_ads'), '');
  if v_active_text is not null and v_active_text ~ '^[0-9]+$' then v_active_count := v_active_text::integer; else v_active_count := null; end if;
  -- Failed, partial, non-comparable, or missing active_ads evidence remains unknown.
  if v_run.status <> 'success' or v_run.completed_at is null
     or coalesce(v_run.coverage_complete, false) is not true
     or coalesce(v_run.pagination_exhausted, false) is not true
     or v_active_count is null then
    v_failure_count := least(99, coalesce(v_page.consecutive_failures, 0) + 1);
    v_next := v_now + least(interval '168 hours', interval '1 hour' * power(2, least(v_failure_count - 1, 10)));
    if v_active_count > 0 and v_run.stop_reason in ('pagination_unresolved', 'partial_evidence') then
      v_next := v_now + interval '24 hours';
    end if;
    update research.advertiser_pages set
      last_scan_completed_at = coalesce(v_run.completed_at, v_now), consecutive_failures = v_failure_count,
      backoff_until = v_next, next_scan_at = v_next, last_scheduled_scan_run_id = p_run_id,
      scan_state = case when scan_state = 'paused' then 'paused' else 'failing' end
    where id = v_page.id;
    update research.ad_fetch_runs set ad_radar_scheduled_at = v_now where id = p_run_id;
    return v_next;
  end if;
  -- Active customer-owned pages and pages in requested postcodes refresh daily.
  select exists (
    select 1 from research.ad_radar_customer_interests i where i.active and (
      i.advertiser_page_id = v_page.id or i.agent_id = v_page.agent_id
      or exists (select 1 from research.agents a where a.id = v_page.agent_id and i.postcode = a.primary_postcode and (i.state is null or upper(i.state) = upper(a.state)))
      or exists (select 1 from research.agencies g where g.id = v_page.agency_id and i.postcode = g.primary_postcode and (i.state is null or upper(i.state) = upper(g.state)))
      or exists (select 1 from research.agent_service_areas asa where (asa.agent_id = v_page.agent_id or asa.agency_id = v_page.agency_id) and i.postcode = asa.postcode and (i.state is null or upper(i.state) = upper(asa.state)))
    )
  ) into v_customer_daily;
  v_zero_scans := case when v_active_count = 0 then least(4, coalesce(v_page.confirmed_zero_scans, 0) + 1) else 0 end;
  if v_active_count > 0 or v_customer_daily then v_next := v_now + interval '24 hours';
  else v_next := v_now + case v_zero_scans when 1 then interval '3 days' when 2 then interval '7 days' when 3 then interval '14 days' else interval '30 days' end;
  end if;
  update research.advertiser_pages set
    last_checked_at = v_now, last_scan_completed_at = coalesce(v_run.completed_at, v_now),
    last_successful_check_at = v_now, last_successful_scan_at = v_now, consecutive_failed_checks = 0,
    consecutive_failures = 0, backoff_until = null, next_scan_at = v_next,
    has_ever_run_ads = v_page.has_ever_run_ads or v_active_count > 0, current_active_ad_count = v_active_count,
    last_active_ad_seen_at = case when v_active_count > 0 then v_now else v_page.last_active_ad_seen_at end,
    confirmed_zero_scans = v_zero_scans,
    last_confirmed_zero_at = case when v_active_count = 0 then v_now else v_page.last_confirmed_zero_at end,
    initial_fill_completed_at = coalesce(v_page.initial_fill_completed_at, v_now), last_scheduled_scan_run_id = p_run_id,
    scan_state = case when scan_state = 'paused' then 'paused' when v_active_count > 0 then 'healthy' else 'zero_ads' end
  where id = v_page.id;
  update research.ad_fetch_runs set ad_radar_scheduled_at = v_now where id = p_run_id;
  return v_next;
end;
$$;
revoke all on function research.schedule_ad_radar_after_run(uuid) from public, anon, authenticated;
grant execute on function research.schedule_ad_radar_after_run(uuid) to service_role;
drop view if exists research.v_ad_radar_customer_freshness;
create view research.v_ad_radar_customer_freshness as
select i.customer_key, i.agent_id, i.advertiser_page_id, i.postcode, i.state, i.active as interest_active, i.last_synced_at,
  ap.page_id as meta_page_id, ap.page_name, ap.scan_enabled, ap.scan_state, ap.last_scan_started_at, ap.last_scan_completed_at, ap.last_successful_scan_at,
  ap.current_active_ad_count, ap.has_ever_run_ads, ap.initial_fill_completed_at, latest.id as last_run_id, latest.status as last_run_status,
  latest.coverage_complete as last_run_coverage_complete, latest.pagination_exhausted as last_run_pagination_exhausted,
  latest.result_summary ->> 'active_ads' as last_run_active_ads, latest.completed_at as last_run_completed_at
from research.ad_radar_customer_interests i left join research.advertiser_pages ap on ap.id = i.advertiser_page_id
left join lateral (select r.id, r.status, r.coverage_complete, r.pagination_exhausted, r.result_summary, r.completed_at from research.ad_fetch_runs r where r.advertiser_page_id = ap.id order by r.started_at desc nulls last, r.id desc limit 1) latest on true;
revoke all on research.v_ad_radar_customer_freshness from public, anon, authenticated;
grant select on research.v_ad_radar_customer_freshness to service_role;
-- Retire unsupported legacy completion flags, never the saved ads themselves.
update research.advertiser_pages p
set initial_fill_completed_at = null,
    scan_state = case when p.scan_enabled then 'needs_first_fill' else 'paused' end,
    next_scan_at = least(coalesce(p.next_scan_at, now()), now())
where p.initial_fill_completed_at is not null
  and not exists (
    select 1 from research.ad_fetch_runs r where r.advertiser_page_id = p.id
      and r.status = 'success' and r.completed_at is not null
      and r.coverage_complete is true and r.pagination_exhausted is true
  );
notify pgrst, 'reload schema';