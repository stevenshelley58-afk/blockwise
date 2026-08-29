create or replace function research.purge_confirmed_inactive_ads(
  p_interval_hours integer default 24,
  p_force boolean default false
)
returns table (
  skipped boolean,
  reason text,
  confirmed_inactive bigint,
  active_missing_media bigint,
  deleted bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_completed_at timestamptz;
  v_confirmed_inactive bigint;
  v_active_missing_media bigint;
  v_deleted bigint;
  v_completed_at timestamptz := now();
begin
  if p_interval_hours < 1 or p_interval_hours > 168 then
    raise exception 'Inactive-ad purge interval must be between 1 and 168 hours';
  end if;

  select nullif(setting_value ->> 'completedAt', '')::timestamptz
  into v_last_completed_at
  from research.runtime_settings
  where setting_key = 'inactive_ad_purge_latest';

  if not p_force
    and v_last_completed_at is not null
    and v_last_completed_at > now() - make_interval(hours => p_interval_hours)
  then
    return query select true, 'not_due'::text, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select count(*)
  into v_active_missing_media
  from research.ad_creatives ac
  join research.observed_ads oa on oa.id = ac.observed_ad_id
  where oa.active_status = 'active'
    and coalesce(
      ac.primary_image_url,
      ac.video_url,
      ac.image_storage_path,
      ac.video_storage_path
    ) is null
    and jsonb_array_length(ac.media_assets) = 0
    and not exists (
      select 1
      from research.media_assets ma
      where ma.ad_creative_id = ac.id
        and ma.capture_status = 'captured'
    );

  if v_active_missing_media > 0 then
    raise exception
      'Inactive-ad purge refused: % active creatives still need media recovery',
      v_active_missing_media;
  end if;

  select count(*)
  into v_confirmed_inactive
  from research.observed_ads
  where active_status = 'inactive';

  delete from research.observed_ads
  where active_status = 'inactive';
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_confirmed_inactive then
    raise exception
      'Inactive-ad purge mismatch: selected %, deleted %',
      v_confirmed_inactive,
      v_deleted;
  end if;

  insert into research.runtime_settings (
    setting_key,
    setting_value,
    description,
    updated_by
  )
  values (
    'inactive_ad_purge_latest',
    jsonb_build_object(
      'completedAt', v_completed_at,
      'confirmedInactive', v_confirmed_inactive,
      'activeMissingMedia', v_active_missing_media,
      'deleted', v_deleted
    ),
    'Latest guarded purge of confirmed inactive ads on the VPS research database.',
    'hermes-supervisor'
  )
  on conflict (setting_key) do update
  set setting_value = excluded.setting_value,
      description = excluded.description,
      updated_by = excluded.updated_by,
      updated_at = now();

  return query
  select false, 'complete'::text, v_confirmed_inactive, v_active_missing_media, v_deleted;
end
$$;

revoke all on function research.purge_confirmed_inactive_ads(integer, boolean)
  from public, anon, authenticated;
grant execute on function research.purge_confirmed_inactive_ads(integer, boolean)
  to service_role;

notify pgrst, 'reload schema';
