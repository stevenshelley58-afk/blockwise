-- Blockwise Ad Library ingestion extensions.
-- Additive only: preserves research history and keeps the existing Hermes
-- page-first collection model intact.

create extension if not exists pgcrypto;

create table if not exists research.official_api_validation_runs (
  id uuid primary key default gen_random_uuid(),
  country text not null default 'AU',
  ad_type text not null default 'HOUSING_ADS',
  search_terms text[] not null default '{}',
  page_ids text[] not null default '{}',
  status text not null default 'running'
    check (status in ('running', 'success', 'failed', 'partial')),
  useful_for_au_real_estate boolean not null default false,
  result_summary jsonb not null default '{}'::jsonb,
  raw_sample jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists official_api_validation_runs_started_idx
  on research.official_api_validation_runs (started_at desc);

create table if not exists research.media_blobs (
  content_hash text primary key,
  storage_bucket text not null,
  storage_path text not null,
  content_type text,
  byte_size bigint,
  width int,
  height int,
  duration_ms int,
  first_captured_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists media_blobs_storage_idx
  on research.media_blobs (storage_bucket, storage_path);

alter table research.media_assets
  add column if not exists content_hash text;

update research.media_assets
set content_hash = checksum
where content_hash is null
  and checksum is not null;

insert into research.media_blobs (
  content_hash,
  storage_bucket,
  storage_path,
  content_type,
  byte_size,
  width,
  height,
  duration_ms,
  first_captured_at,
  last_seen_at,
  metadata
)
select distinct on (ma.content_hash)
  ma.content_hash,
  ma.storage_bucket,
  ma.storage_path,
  ma.content_type,
  ma.byte_size,
  ma.width,
  ma.height,
  ma.duration_ms,
  coalesce(ma.captured_at, ma.created_at, now()),
  coalesce(ma.captured_at, ma.updated_at, now()),
  jsonb_build_object('backfilled_from_media_asset_id', ma.id)
from research.media_assets ma
where ma.content_hash is not null
  and ma.storage_bucket is not null
  and ma.storage_path is not null
order by ma.content_hash, ma.captured_at nulls last, ma.created_at;

create index if not exists media_assets_content_hash_idx
  on research.media_assets (content_hash)
  where content_hash is not null;

create table if not exists public.research_saved_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  ad_creative_id uuid references research.ad_creatives (id) on delete set null,
  note text,
  source_snapshot_url text,
  handoff_status text not null default 'saved'
    check (handoff_status in ('saved', 'sent_to_adstudio', 'archived')),
  handoff_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, observed_ad_id)
);

alter table public.research_saved_ads enable row level security;

drop policy if exists research_saved_ads_select on public.research_saved_ads;
drop policy if exists research_saved_ads_insert on public.research_saved_ads;
drop policy if exists research_saved_ads_update on public.research_saved_ads;
drop policy if exists research_saved_ads_delete on public.research_saved_ads;

create policy research_saved_ads_select on public.research_saved_ads
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));

create policy research_saved_ads_insert on public.research_saved_ads
  for insert with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member']));

create policy research_saved_ads_update on public.research_saved_ads
  for update using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'member']));

create policy research_saved_ads_delete on public.research_saved_ads
  for delete using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

drop trigger if exists trg_research_saved_ads_updated_at on public.research_saved_ads;
create trigger trg_research_saved_ads_updated_at
  before update on public.research_saved_ads
  for each row execute function research.set_updated_at();

create index if not exists research_saved_ads_workspace_created_idx
  on public.research_saved_ads (workspace_id, created_at desc);

create index if not exists research_saved_ads_observed_idx
  on public.research_saved_ads (observed_ad_id);

grant select on research.media_blobs to authenticated;
grant select, insert, update on research.media_blobs to service_role;
grant select, insert, update on research.official_api_validation_runs to authenticated, service_role;
grant select, insert, update, delete on public.research_saved_ads to authenticated, service_role;
