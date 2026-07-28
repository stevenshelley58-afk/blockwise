-- Research execution and history now live on the Blockwise VPS.
-- Supabase retains only the customer-facing projections in public.

do $$
declare
  cutover public.infrastructure_cutovers%rowtype;
  relation record;
  actual_count bigint;
  actual_research_counts jsonb := '{}'::jsonb;
  actual_archive_counts jsonb := '{}'::jsonb;
  migration_verification boolean :=
    to_regclass('public.blockwise_migration_verification_marker') is not null;
  local_user_count bigint;
  local_workspace_count bigint;
  source_bucket_count bigint;
begin
  select *
  into cutover
  from public.infrastructure_cutovers
  where cutover_key = 'research-to-vps-v1';

  for relation in
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'research'
    order by tablename
  loop
    execute format('select count(*) from research.%I', relation.tablename)
      into actual_count;
    actual_research_counts :=
      actual_research_counts || jsonb_build_object(relation.tablename, actual_count);
  end loop;

  for relation in
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'research_archive'
    order by tablename
  loop
    execute format('select count(*) from research_archive.%I', relation.tablename)
      into actual_count;
    actual_archive_counts :=
      actual_archive_counts || jsonb_build_object(relation.tablename, actual_count);
  end loop;

  if cutover.cutover_key is not null then
    if cutover.archive_sha256 <>
      '1a5d7ace0ebb95d8765701eb8b516bfbb3ca06947b8d2b3fbeff5d321b65640b'
    then
      raise exception 'Research cutover archive checksum is not the verified VPS dump';
    end if;

    if cutover.source_counts <> cutover.destination_counts
      or actual_research_counts <> cutover.source_counts
    then
      raise exception 'Research cutover row counts do not match the verified VPS restore';
    end if;

    if actual_archive_counts <>
      coalesce(cutover.metadata -> 'research_archive_counts', '{}'::jsonb)
    then
      raise exception 'Research archive row counts do not match the verified VPS restore';
    end if;

    if coalesce(cutover.metadata ->> 'research_archive_data_sha256', '') <>
      'aa531c920a37a47066234c1b0147913e670075c0b1a6deea3687b68dd3d6ad76'
    then
      raise exception 'Research archive checksum is not the verified VPS dump';
    end if;

    if not exists (
      select 1
      from public.customer_ad_radar_publications
      where status = 'complete'
        and source_card_count = (cutover.metadata ->> 'customer_cards')::integer
        and source_version_count =
          (cutover.metadata ->> 'customer_creative_versions')::integer
    ) then
      raise exception 'Customer Ad Radar projection has not completed publication';
    end if;

    select count(*)
    into source_bucket_count
    from storage.buckets
    where id in ('research-raw-evidence', 'research-screenshots');

    if source_bucket_count <> 0 then
      raise exception 'Research-only storage buckets must be removed before schema cutover';
    end if;
  else
    -- A fresh local reset has no production cutover record or customer data.
    -- Refuse to remove non-empty schemas from any populated environment.
    select count(*) into local_user_count from auth.users;
    select count(*) into local_workspace_count from public.workspaces;

    if not migration_verification
      and (
        local_user_count <> 0
        or local_workspace_count <> 0
        or exists (
          select 1
          from storage.objects
          where bucket_id in ('research-raw-evidence', 'research-screenshots')
        )
      )
    then
      raise exception 'A verified research-to-vps-v1 cutover is required';
    end if;
  end if;

  drop schema if exists research cascade;
  drop schema if exists research_archive cascade;
  drop table if exists public.blockwise_migration_verification_marker;
end
$$;
