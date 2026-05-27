-- AdStudio module: brand kits, campaign generation, editable creatives, compliance, and export state.

create extension if not exists pgcrypto;

create table if not exists public.adstudio_brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_type text not null default 'website',
  source_url text,
  business_name text not null,
  market_country text not null default 'AU',
  market_region text,
  identity_json jsonb not null default '{}',
  logos_json jsonb not null default '{}',
  colours_json jsonb not null default '{}',
  typography_json jsonb not null default '{}',
  tone_json jsonb not null default '{}',
  visual_style_json jsonb not null default '{}',
  compliance_json jsonb not null default '{}',
  contact_json jsonb not null default '{}',
  review_status text not null default 'pending_user_review',
  locked_fields_json jsonb not null default '[]',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_kit_id uuid not null references public.adstudio_brand_kits (id) on delete cascade,
  asset_type text not null,
  storage_path text,
  source_url text,
  metadata_json jsonb not null default '{}',
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_offer_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  offer_id text not null,
  name text not null,
  goal text not null,
  lead_temperature text not null,
  required_inputs_json jsonb not null default '[]',
  default_cta text not null,
  landing_page_type text not null,
  followup_type text not null,
  template_json jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, offer_id)
);

create table if not exists public.adstudio_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_kit_id uuid not null references public.adstudio_brand_kits (id) on delete restrict,
  legacy_campaign_id uuid references public.campaigns (id) on delete set null,
  name text not null,
  goal text not null,
  market_json jsonb not null default '{}',
  audience_intent text,
  offer_id text not null,
  platforms_json jsonb not null default '[]',
  creative_formats_json jsonb not null default '[]',
  status text not null default 'draft',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_campaign_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns (id) on delete cascade,
  angle text not null,
  headline text not null,
  offer text not null,
  cta text not null,
  score_json jsonb not null default '{}',
  status text not null default 'draft',
  locked_fields_json jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_creatives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns (id) on delete cascade,
  variant_id uuid not null references public.adstudio_campaign_variants (id) on delete cascade,
  format text not null,
  width integer not null,
  height integer not null,
  canvas_json jsonb not null default '{}',
  render_status text not null default 'draft',
  preview_url text,
  preview_svg text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_creative_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  creative_id uuid not null references public.adstudio_creatives (id) on delete cascade,
  object_type text not null,
  role text not null,
  content text,
  asset_id uuid references public.adstudio_brand_assets (id) on delete set null,
  bounds_json jsonb not null default '{}',
  style_json jsonb not null default '{}',
  locked boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_platform_copy (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns (id) on delete cascade,
  variant_id uuid references public.adstudio_campaign_variants (id) on delete cascade,
  meta_json jsonb not null default '{}',
  google_search_json jsonb not null default '{}',
  google_pmax_json jsonb not null default '{}',
  google_demand_gen_json jsonb not null default '{}',
  landing_page_json jsonb not null default '{}',
  followup_json jsonb not null default '{}',
  locked_fields_json jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.adstudio_campaigns (id) on delete cascade,
  manifest_json jsonb not null default '{}',
  storage_path text,
  status text not null default 'queued',
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adstudio_compliance_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.adstudio_campaigns (id) on delete cascade,
  variant_id uuid references public.adstudio_campaign_variants (id) on delete cascade,
  status text not null,
  issues_json jsonb not null default '[]',
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_provider_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_id uuid,
  provider_name text not null,
  provider_type text not null,
  model_name text,
  prompt_version_id uuid references public.prompt_versions (id) on delete set null,
  input_json jsonb not null default '{}',
  output_json jsonb not null default '{}',
  usage_json jsonb not null default '{}',
  cost_estimate numeric(10, 4) not null default 0,
  status text not null default 'queued',
  error_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id text not null,
  vertical text not null default 'real_estate',
  goal text not null,
  offer_type text not null,
  version integer not null default 1,
  template_json jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, template_id, version)
);

create table if not exists public.adstudio_job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  input_hash text not null,
  input_json jsonb not null default '{}',
  output_refs_json jsonb not null default '[]',
  error_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adstudio_performance_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.adstudio_campaigns (id) on delete cascade,
  provider public.provider_key,
  source text not null,
  metrics_json jsonb not null default '{}',
  imported_by uuid references public.profiles (id),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
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

do $$
declare
  table_name text;
  workspace_tables text[] := array[
    'adstudio_brand_kits',
    'adstudio_brand_assets',
    'adstudio_offer_templates',
    'adstudio_campaigns',
    'adstudio_campaign_variants',
    'adstudio_creatives',
    'adstudio_creative_objects',
    'adstudio_platform_copy',
    'adstudio_exports',
    'adstudio_compliance_reports',
    'adstudio_provider_runs',
    'adstudio_template_versions',
    'adstudio_job_runs',
    'adstudio_performance_imports'
  ];
begin
  foreach table_name in array workspace_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists adstudio_workspace_select on public.%I', table_name);
    execute format('drop policy if exists adstudio_workspace_insert on public.%I', table_name);
    execute format('drop policy if exists adstudio_workspace_update on public.%I', table_name);
    execute format('drop policy if exists adstudio_workspace_delete on public.%I', table_name);
    execute format('create policy adstudio_workspace_select on public.%I for select using (public.is_operator() or public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy adstudio_workspace_insert on public.%I for insert with check (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'', ''member'']))', table_name);
    execute format('create policy adstudio_workspace_update on public.%I for update using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'', ''member''])) with check (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'', ''member'']))', table_name);
    execute format('create policy adstudio_workspace_delete on public.%I for delete using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'']))', table_name);
  end loop;
end $$;

drop policy if exists adstudio_workspace_insert on public.adstudio_provider_runs;
drop policy if exists adstudio_workspace_update on public.adstudio_provider_runs;
drop policy if exists adstudio_workspace_delete on public.adstudio_provider_runs;
create policy adstudio_provider_runs_server_owned_no_client_insert on public.adstudio_provider_runs for insert to authenticated with check (false);
create policy adstudio_provider_runs_server_owned_no_client_update on public.adstudio_provider_runs for update to authenticated using (false) with check (false);
create policy adstudio_provider_runs_server_owned_no_client_delete on public.adstudio_provider_runs for delete to authenticated using (false);

drop policy if exists adstudio_workspace_insert on public.adstudio_job_runs;
drop policy if exists adstudio_workspace_update on public.adstudio_job_runs;
drop policy if exists adstudio_workspace_delete on public.adstudio_job_runs;
create policy adstudio_job_runs_server_owned_no_client_insert on public.adstudio_job_runs for insert to authenticated with check (false);
create policy adstudio_job_runs_server_owned_no_client_update on public.adstudio_job_runs for update to authenticated using (false) with check (false);
create policy adstudio_job_runs_server_owned_no_client_delete on public.adstudio_job_runs for delete to authenticated using (false);

create index if not exists adstudio_brand_kits_workspace_idx on public.adstudio_brand_kits (workspace_id, updated_at desc);
create index if not exists adstudio_campaigns_workspace_status_idx on public.adstudio_campaigns (workspace_id, status, created_at desc);
create index if not exists adstudio_variants_campaign_idx on public.adstudio_campaign_variants (campaign_id, created_at desc);
create index if not exists adstudio_creatives_campaign_idx on public.adstudio_creatives (campaign_id, format);
create index if not exists adstudio_exports_campaign_idx on public.adstudio_exports (campaign_id, created_at desc);
create index if not exists adstudio_job_runs_workspace_status_idx on public.adstudio_job_runs (workspace_id, status, created_at desc);
