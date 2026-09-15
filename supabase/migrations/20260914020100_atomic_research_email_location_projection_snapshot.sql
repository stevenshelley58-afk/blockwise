-- Apply the private email-to-location projection as one complete, ordered
-- snapshot. The service-only RPC prevents an older or partial publisher from
-- overwriting a newer snapshot and bounds unexpected source removals.
create table if not exists public.research_email_location_projection_state (
  source text primary key check (source = 'ad_radar_agent_contact_projection'),
  latest_snapshot_at timestamptz not null,
  latest_source_revision uuid not null,
  row_count integer not null check (row_count >= 0),
  applied_at timestamptz not null default clock_timestamp()
);

comment on table public.research_email_location_projection_state is
  'Service-only ordering marker for complete private email location projection snapshots.';

alter table public.research_email_location_projection_state enable row level security;
revoke all on table public.research_email_location_projection_state from public, anon, authenticated;
grant select on table public.research_email_location_projection_state to service_role;

create or replace function public.replace_research_email_location_projection_snapshot(
  p_source text,
  p_snapshot_at timestamptz,
  p_source_revision uuid,
  p_rows jsonb,
  p_allow_large_removal boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_snapshot_at timestamptz;
  v_current_count integer;
  v_incoming_count integer;
  v_removed_count integer;
begin
  if coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    ''
  ) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_source is distinct from 'ad_radar_agent_contact_projection' then
    raise exception 'unsupported projection source' using errcode = '22023';
  end if;
  if p_snapshot_at is null or p_source_revision is null then
    raise exception 'snapshot identity is required' using errcode = '22023';
  end if;
  if p_snapshot_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'snapshot timestamp is in the future' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'snapshot rows must be an array' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('blockwise:research-email-location-projection:' || p_source, 0)
  );
  select state.latest_snapshot_at
    into v_previous_snapshot_at
    from public.research_email_location_projection_state as state
    where state.source = p_source
    for update;

  -- Ordering is checked before the empty guard so an old empty snapshot can
  -- never clear or advance the live projection state.
  if v_previous_snapshot_at is not null and p_snapshot_at <= v_previous_snapshot_at then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason', 'stale_snapshot',
      'current_snapshot_at', v_previous_snapshot_at
    );
  end if;

  v_incoming_count := pg_catalog.jsonb_array_length(p_rows);

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
       or item.value - array['email_sha256', 'postcode', 'suburb', 'source_observed_at']::text[] <> '{}'::jsonb
       or not (item.value ? 'email_sha256')
       or not (item.value ? 'postcode')
       or not (item.value ? 'source_observed_at')
       or coalesce(item.value->>'email_sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(item.value->>'postcode', '') !~ '^[0-9]{4}$'
       or case when coalesce(item.value->>'postcode', '') ~ '^[0-9]{4}$' then not (
         (item.value->>'postcode')::integer between 200 and 299
         or (item.value->>'postcode')::integer between 800 and 999
         or (item.value->>'postcode')::integer between 1000 and 9999
       ) else false end
       or (item.value ? 'suburb' and item.value->>'suburb' is not null and (
         pg_catalog.length(pg_catalog.btrim(item.value->>'suburb')) = 0
         or pg_catalog.length(item.value->>'suburb') > 120
       ))
       or not pg_catalog.pg_input_is_valid(item.value->>'source_observed_at', 'timestamp with time zone')
       or case when pg_catalog.pg_input_is_valid(item.value->>'source_observed_at', 'timestamp with time zone')
          then (item.value->>'source_observed_at')::timestamptz > pg_catalog.clock_timestamp() + interval '5 minutes'
          else false end
  ) then
    raise exception 'snapshot contains an invalid projection row' using errcode = '22023';
  end if;

  if (
    select pg_catalog.count(distinct item.value->>'email_sha256')
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  ) <> v_incoming_count then
    raise exception 'snapshot contains duplicate email hashes' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer
    into v_current_count
    from public.research_email_location_projections as projection
    where projection.source = p_source;
  select pg_catalog.count(*)::integer
    into v_removed_count
    from public.research_email_location_projections as projection
    where projection.source = p_source
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_rows) as item(value)
        where item.value->>'email_sha256' = projection.email_sha256
      );

  if not p_allow_large_removal
     and v_current_count > 0
     and v_removed_count > greatest(5, pg_catalog.ceil(v_current_count * 0.20)::integer) then
    return pg_catalog.jsonb_build_object(
      'applied', false,
      'reason', 'removal_guard',
      'current_rows', v_current_count,
      'incoming_rows', v_incoming_count,
      'removed_rows', v_removed_count
    );
  end if;

  insert into public.research_email_location_projections (
    email_sha256,
    postcode,
    suburb,
    source,
    source_observed_at,
    projected_at,
    source_revision
  )
  select
    item.value->>'email_sha256',
    item.value->>'postcode',
    nullif(pg_catalog.btrim(item.value->>'suburb'), ''),
    p_source,
    (item.value->>'source_observed_at')::timestamptz,
    pg_catalog.clock_timestamp(),
    p_source_revision
  from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  on conflict (email_sha256) do update set
    postcode = excluded.postcode,
    suburb = excluded.suburb,
    source = excluded.source,
    source_observed_at = excluded.source_observed_at,
    projected_at = excluded.projected_at,
    source_revision = excluded.source_revision;

  delete from public.research_email_location_projections as projection
  where projection.source = p_source
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_rows) as item(value)
      where item.value->>'email_sha256' = projection.email_sha256
    );

  insert into public.research_email_location_projection_state (
    source,
    latest_snapshot_at,
    latest_source_revision,
    row_count,
    applied_at
  ) values (
    p_source,
    p_snapshot_at,
    p_source_revision,
    v_incoming_count,
    pg_catalog.clock_timestamp()
  )
  on conflict (source) do update set
    latest_snapshot_at = excluded.latest_snapshot_at,
    latest_source_revision = excluded.latest_source_revision,
    row_count = excluded.row_count,
    applied_at = excluded.applied_at;

  return pg_catalog.jsonb_build_object(
    'applied', true,
    'reason', 'applied',
    'previous_rows', v_current_count,
    'row_count', v_incoming_count,
    'removed_rows', v_removed_count
  );
end;
$$;

revoke all on function public.replace_research_email_location_projection_snapshot(text,timestamptz,uuid,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.replace_research_email_location_projection_snapshot(text,timestamptz,uuid,jsonb,boolean)
  to service_role;
