-- Ad DB lifecycle idempotency and permanent archive retention.
-- Forward-only: apply only after the recorded pre-build backup and review.
alter table research.ad_fetch_runs
  add column if not exists lifecycle_reconciled_at timestamptz;

create or replace function research.mark_missing_ads_inactive(p_run_id uuid, p_seen_external_ad_ids text[])
returns jsonb language plpgsql security definer set search_path = research, pg_temp as $$
declare v_run research.ad_fetch_runs; v_page_id uuid; v_now timestamptz; v_marked bigint := 0;
begin
  select * into v_run from research.ad_fetch_runs where id = p_run_id for update;
  if not found then raise exception 'ad_fetch_run % not found', p_run_id; end if;
  if v_run.completed_at is null or v_run.status <> 'success' or not coalesce(v_run.coverage_complete, false) or not coalesce(v_run.pagination_exhausted, false) then
    return jsonb_build_object('allowed', false, 'reason', 'run_not_complete_comparable');
  end if;
  if v_run.lifecycle_reconciled_at is not null then return jsonb_build_object('allowed', false, 'reason', 'run_already_reconciled'); end if;
  v_page_id := v_run.advertiser_page_id;
  v_now := v_run.completed_at;
  if v_page_id is null then raise exception 'run % has no advertiser_page_id', p_run_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_page_id::text, 0));
  if coalesce(v_run.input_payload->>'country', '') <> 'AU' or coalesce(v_run.input_payload->>'activeStatus', '') <> 'all' then
    return jsonb_build_object('allowed', false, 'reason', 'unsupported_scan_scope');
  end if;
  if exists (
    select 1 from research.ad_fetch_runs newer
    where newer.advertiser_page_id = v_page_id and newer.id <> v_run.id and newer.status = 'success'
      and coalesce(newer.coverage_complete, false) and coalesce(newer.pagination_exhausted, false)
      and newer.lifecycle_reconciled_at is not null and newer.completed_at > v_run.completed_at
      and newer.input_payload->>'country' = v_run.input_payload->>'country'
      and newer.input_payload->>'activeStatus' = v_run.input_payload->>'activeStatus'
  ) then return jsonb_build_object('allowed', false, 'reason', 'run_out_of_order'); end if;

  drop table if exists pg_temp._seen_ads;
  create temp table _seen_ads on commit drop as
    select distinct x as external_ad_id from unnest(coalesce(p_seen_external_ad_ids, '{}'::text[])) as x where x is not null and x <> '';
  update research.observed_ads oa
  set missing_successive_checks = least(99, coalesce(oa.missing_successive_checks, 0) + 1),
      missing_since = coalesce(oa.missing_since, v_now), last_checked_at = v_now
  where oa.advertiser_page_id = v_page_id and oa.active_status = 'active'
    and not exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  update research.observed_ads oa set missing_successive_checks = 0, missing_since = null, last_checked_at = v_now  where oa.advertiser_page_id = v_page_id and oa.active_status = 'active'    and exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  update research.observed_ads oa set active_status = 'inactive', inactive_at = v_now
  where oa.advertiser_page_id = v_page_id and oa.active_status = 'active'
    and oa.missing_successive_checks >= 2
    and not exists (select 1 from _seen_ads s where s.external_ad_id = oa.external_ad_id);
  get diagnostics v_marked = row_count;
  -- No reactivation: an all-status result is not positive source-active evidence.
  update research.ad_fetch_runs set lifecycle_reconciled_at = v_now where id = p_run_id;
  return jsonb_build_object('allowed', true, 'marked_inactive', v_marked, 'reactivated', 0);
end $$;

create or replace function research.purge_confirmed_inactive_ads(p_interval_hours integer default 24, p_force boolean default false)
returns table(skipped boolean, reason text, confirmed_inactive bigint, active_missing_media bigint, deleted bigint)
language sql security definer set search_path = '' as $$
  select true, 'archive_retention_enabled'::text, count(*)::bigint, 0::bigint, 0::bigint
  from research.observed_ads where active_status = 'inactive';
$$;

revoke all on function research.mark_missing_ads_inactive(uuid, text[]) from public;
revoke all on function research.purge_confirmed_inactive_ads(integer, boolean) from public;
revoke all on function research.reserve_provider_credits(text, numeric) from public;
revoke all on function research.reserve_provider_credits(text, numeric, numeric) from public;
grant execute on function research.mark_missing_ads_inactive(uuid, text[]) to service_role;
grant execute on function research.purge_confirmed_inactive_ads(integer, boolean) to service_role;
notify pgrst, 'reload schema';

