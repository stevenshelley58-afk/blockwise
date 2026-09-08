-- Actual SQL fixture for the isolated ad_radar_candidate_20260908 database.
-- Run with: psql ... -v ON_ERROR_STOP=1 -f this-file.sql
begin;
do $$
declare
  agent_id uuid := gen_random_uuid();
  fixture_page_id uuid := gen_random_uuid();
  customer_key text := 'fixture-customer-0000000000000001';
  run_id uuid;
  newer_run_id uuid;
  before_next timestamptz;
  after_next timestamptz;
  zero_count integer;
  failure_count integer;
  observed_id uuid := gen_random_uuid();
begin
  insert into research.agents(id,full_name,state,primary_postcode)
    values(agent_id,'Ad Radar scan truth fixture agent','WA','6000');
  insert into research.advertiser_pages(id,platform,page_name,page_id,agent_id,status,scan_enabled,scan_state,next_scan_at)
    values(fixture_page_id,'facebook','Ad Radar scan truth fixture page','999999999999999',agent_id,'resolved_collectable',true,'needs_first_fill',now());
  -- Historical active evidence must not defeat a qualifying run's active_ads=0.
  insert into research.observed_ads(id,external_ad_id,advertiser_page_id,active_status,first_seen_provider)
    values(observed_id,'fixture-stale-active',fixture_page_id,'active','fixture');

  -- Four qualifying zero runs produce exactly 3/7/14/30 day quiet cadence.
  for expected_days in 1..4 loop
    insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode)
      values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',0),true,true,now() + expected_days * interval '1 minute','refresh') returning id into run_id;
    perform research.schedule_ad_radar_after_run(run_id);
    select confirmed_zero_scans,next_scan_at into zero_count,after_next from research.advertiser_pages where id=fixture_page_id;
    if zero_count <> expected_days then raise exception 'zero streak expected %, got %',expected_days,zero_count; end if;
    if expected_days=1 and after_next < now()+interval '2 days' then raise exception 'first quiet interval is not 3 days'; end if;
    if expected_days=2 and after_next < now()+interval '6 days' then raise exception 'second quiet interval is not 7 days'; end if;
    if expected_days=3 and after_next < now()+interval '13 days' then raise exception 'third quiet interval is not 14 days'; end if;
    if expected_days=4 and after_next < now()+interval '29 days' then raise exception 'fourth quiet interval is not 30 days'; end if;
  end loop;
  select current_active_ad_count into zero_count from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 0 then raise exception 'stale observed active defeated run active_ads=0'; end if;

  -- A qualifying active run resets quiet truth and is due daily.
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',2),true,true,now() + interval '10 minutes','refresh') returning id into run_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select confirmed_zero_scans,current_active_ad_count,next_scan_at into zero_count,failure_count,after_next from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 0 or failure_count <> 2 or after_next > now()+interval '26 hours' then raise exception 'active reset failed'; end if;

  -- Partial and failed runs are unknown, preserve first-fill/zero truth and back off.
  update research.advertiser_pages set confirmed_zero_scans=0,last_scheduled_scan_run_id=null,initial_fill_completed_at=null,consecutive_failures=0 where id=fixture_page_id;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',0),false,true,now() + interval '20 minutes','refresh') returning id into run_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select confirmed_zero_scans,consecutive_failures,initial_fill_completed_at into zero_count,failure_count,before_next from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 0 or failure_count <> 1 or before_next is not null then raise exception 'partial run incorrectly established truth'; end if;
  select next_scan_at into before_next from research.advertiser_pages where id=fixture_page_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select confirmed_zero_scans,consecutive_failures,next_scan_at into zero_count,failure_count,after_next from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 0 or failure_count <> 1 or after_next <> before_next then raise exception 'repeat run id was not idempotent'; end if;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'failed',jsonb_build_object('active_ads',0),false,false,now() + interval '30 minutes','refresh') returning id into run_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select confirmed_zero_scans,consecutive_failures into zero_count,failure_count from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 0 or failure_count <> 2 then raise exception 'failed run incorrectly advanced zero truth'; end if;

  -- An older delayed run is marked handled but cannot regress a newer run.
  update research.advertiser_pages set last_scheduled_scan_run_id=null,last_scan_completed_at=null,consecutive_failures=0 where id=fixture_page_id;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',0),true,true,now()-interval '2 hours','refresh') returning id into run_id;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',2),true,true,now()-interval '1 hour','refresh') returning id into newer_run_id;
  perform research.schedule_ad_radar_after_run(newer_run_id);
  perform research.schedule_ad_radar_after_run(run_id);
  select current_active_ad_count into failure_count from research.advertiser_pages where id=fixture_page_id;
  if failure_count <> 2 then raise exception 'older delayed run regressed current active truth'; end if;

  -- A customer postcode interest overrides quiet cadence but not truth streak.
  insert into research.ad_radar_customer_interests(customer_key,postcode,state,active,last_synced_at)
    values(customer_key,'6000','WA',true,now());
  update research.advertiser_pages set last_scheduled_scan_run_id=null,consecutive_failures=0 where id=fixture_page_id;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode) values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',0),true,true,now() + interval '40 minutes','refresh') returning id into run_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select confirmed_zero_scans,next_scan_at into zero_count,after_next from research.advertiser_pages where id=fixture_page_id;
  if zero_count <> 1 or after_next > now()+interval '26 hours' then raise exception 'customer daily override failed'; end if;

  -- A busy page with useful partial evidence stays daily, never hourly or filled.
  update research.advertiser_pages set last_scheduled_scan_run_id=null,initial_fill_completed_at=null where id=fixture_page_id;
  insert into research.ad_fetch_runs(source_provider,target_kind,target_value,input_hash,advertiser_page_id,status,result_summary,coverage_complete,pagination_exhausted,completed_at,scan_mode,stop_reason)
  values('fixture','advertiser_page',fixture_page_id::text,md5(gen_random_uuid()::text),fixture_page_id,'success',jsonb_build_object('active_ads',3),false,false,now()+interval '50 minutes','refresh','pagination_unresolved') returning id into run_id;
  perform research.schedule_ad_radar_after_run(run_id);
  select next_scan_at,initial_fill_completed_at into after_next,before_next from research.advertiser_pages where id=fixture_page_id;
  if after_next < now()+interval '23 hours' or after_next > now()+interval '25 hours' or before_next is not null then
    raise exception 'partial active page must stay daily without claiming complete';
  end if;
end;
$$;
rollback;