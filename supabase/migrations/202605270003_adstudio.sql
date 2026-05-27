create extension if not exists pgcrypto;

create table if not exists public.adstudio_brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_url text not null,
  extracted_json jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending_user_review',
  locked_fields text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_kit_id uuid references public.adstudio_brand_kits(id) on delete cascade,
  asset_type text not null,
  source_url text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_offer_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  offer_key text not null,
  name text not null,
  template_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, offer_key)
);

create table if not exists public.adstudio_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_kit_id uuid references public.adstudio_brand_kits(id) on delete set null,
  offer_template_id uuid references public.adstudio_offer_templates(id) on delete set null,
  goal text not null,
  status text not null default 'draft',
  platforms text[] not null default array[]::text[],
  campaign_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_campaign_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns(id) on delete cascade,
  variant_json jsonb not null default '{}'::jsonb,
  score numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns(id) on delete cascade,
  variant_id uuid references public.adstudio_campaign_variants(id) on delete cascade,
  canvas_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_creative_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  creative_id uuid not null references public.adstudio_creatives(id) on delete cascade,
  object_type text not null,
  object_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_platform_copy (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns(id) on delete cascade,
  variant_id uuid references public.adstudio_campaign_variants(id) on delete cascade,
  platform text not null,
  copy_json jsonb not null default '{}'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns(id) on delete cascade,
  manifest_json jsonb not null default '{}'::jsonb,
  storage_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_compliance_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns(id) on delete cascade,
  status text not null,
  issues_json jsonb not null default '[]'::jsonb,
  report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_provider_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.adstudio_campaigns(id) on delete cascade,
  provider text not null,
  model text,
  prompt_hash text,
  output_json jsonb not null default '{}'::jsonb,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  offer_template_id uuid references public.adstudio_offer_templates(id) on delete cascade,
  version integer not null,
  template_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (offer_template_id, version)
);

create table if not exists public.adstudio_job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null,
  status text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.adstudio_performance_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.adstudio_campaigns(id) on delete cascade,
  platform text not null,
  imported_json jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

alter table public.adstudio_brand_kits enable row level security;
alter table public.adstudio_brand_assets enable row level security;
alter table public.adstudio_offer_templates enable row level security;
alter table public.adstudio_campaigns enable row level security;
alter table public.adstudio_campaign_variants enable row level security;
alter table public.adstudio_creatives enable row level security;
alter table public.adstudio_creative_objects enable row level security;
alter table public.adstudio_platform_copy enable row level security;
alter table public.adstudio_exports enable row level security;
alter table public.adstudio_compliance_reports enable row level security;
alter table public.adstudio_provider_runs enable row level security;
alter table public.adstudio_template_versions enable row level security;
alter table public.adstudio_job_runs enable row level security;
alter table public.adstudio_performance_imports enable row level security;

create or replace function public.adstudio_has_workspace_access(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.profile_id = auth.uid()
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_operator = true
  );
$$;

create or replace function public.adstudio_install_workspace_policies(target_table regclass)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute format('drop policy if exists adstudio_workspace_select on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_insert on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_update on %s', target_table);
  execute format('drop policy if exists adstudio_workspace_delete on %s', target_table);

  execute format(
    'create policy adstudio_workspace_select on %s for select using (public.adstudio_has_workspace_access(workspace_id))',
    target_table
  );
  execute format(
    'create policy adstudio_workspace_insert on %s for insert with check (public.adstudio_has_workspace_access(workspace_id))',
    target_table
  );
  execute format(
    'create policy adstudio_workspace_update on %s for update using (public.adstudio_has_workspace_access(workspace_id)) with check (public.adstudio_has_workspace_access(workspace_id))',
    target_table
  );
  execute format(
    'create policy adstudio_workspace_delete on %s for delete using (public.adstudio_has_workspace_access(workspace_id))',
    target_table
  );
end;
$$;

select public.adstudio_install_workspace_policies('public.adstudio_brand_kits'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_brand_assets'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_offer_templates'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_campaigns'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_campaign_variants'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_creatives'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_creative_objects'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_platform_copy'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_exports'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_compliance_reports'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_provider_runs'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_template_versions'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_job_runs'::regclass);
select public.adstudio_install_workspace_policies('public.adstudio_performance_imports'::regclass);

drop policy if exists adstudio_workspace_insert on public.adstudio_provider_runs;
create policy adstudio_provider_runs_server_owned_no_client_insert
on public.adstudio_provider_runs
for insert
with check (false);

drop policy if exists adstudio_workspace_insert on public.adstudio_job_runs;
create policy adstudio_job_runs_server_owned_no_client_insert
on public.adstudio_job_runs
for insert
with check (false);
