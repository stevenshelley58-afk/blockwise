-- Lifecycle function hotfix: allow repeated calls within one transaction.
--
-- `create temp table _seen_ads on commit drop` collides when
-- research.mark_missing_ads_inactive runs twice inside the same transaction
-- (ON COMMIT DROP only drops at commit). Drop any leftover instance before
-- creating it. Full replacement of the function body from 202609050005.

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

  drop table if exists _seen_ads;
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

notify pgrst, 'reload schema';
