-- Versioned, workspace-scoped reporting read models. Existing historical
-- provider snapshots remain valid; range_key is nullable so those rows can be
-- retained while the customer app moves to one current snapshot per range.

alter table public.reporting_snapshots
  add column if not exists snapshot_version smallint not null default 1,
  add column if not exists range_key text,
  add column if not exists generated_at timestamptz,
  add column if not exists stale_at timestamptz,
  add column if not exists payload jsonb,
  add column if not exists etag text;

update public.reporting_snapshots
set
  generated_at = coalesce(generated_at, created_at),
  stale_at = coalesce(stale_at, created_at + interval '15 minutes')
where generated_at is null or stale_at is null;

alter table public.reporting_snapshots
  alter column generated_at set default now(),
  alter column generated_at set not null,
  alter column stale_at set default (now() + interval '15 minutes'),
  alter column stale_at set not null;

alter table public.reporting_snapshots
  drop constraint if exists reporting_snapshots_range_key_length,
  add constraint reporting_snapshots_range_key_length
    check (range_key is null or char_length(range_key) between 1 and 100);

create unique index if not exists reporting_snapshots_workspace_provider_range_key_uidx
  on public.reporting_snapshots (workspace_id, provider, range_key);

create index if not exists reporting_snapshots_workspace_stale_idx
  on public.reporting_snapshots (workspace_id, stale_at)
  where range_key is not null;

-- Snapshots are service-owned. Customers can read only their workspace rows;
-- refresh workers are the sole writers.
drop policy if exists workspace_insert on public.reporting_snapshots;
drop policy if exists workspace_update on public.reporting_snapshots;
drop policy if exists workspace_delete on public.reporting_snapshots;
drop policy if exists workspace_select on public.reporting_snapshots;

revoke all on table public.reporting_snapshots from anon, authenticated;
grant select on table public.reporting_snapshots to authenticated;

create policy reporting_snapshots_select_workspace
  on public.reporting_snapshots
  for select
  to authenticated
  using (private.is_operator() or private.is_workspace_member(workspace_id));

-- Realtime carries invalidations only; clients re-read through the
-- workspace-checked API and never trust change payloads as authorization.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reporting_snapshots'
  ) then
    alter publication supabase_realtime add table public.reporting_snapshots;
  end if;
end
$$;

comment on column public.reporting_snapshots.range_key is
  'Stable monitor range key, for example last_30 or custom:2026-07-01:2026-07-28.';
comment on column public.reporting_snapshots.payload is
  'Versioned MetaMonitorPayload read model. Provider tokens and mutation payloads are forbidden.';
comment on column public.reporting_snapshots.etag is
  'Strong SHA-256 validator for conditional customer API reads.';
