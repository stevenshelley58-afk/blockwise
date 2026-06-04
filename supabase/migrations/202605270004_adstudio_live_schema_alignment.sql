-- Align already-applied compact AdStudio installs with the live module schema.

create extension if not exists pgcrypto;

alter table public.adstudio_brand_kits add column if not exists source_type text not null default 'website';
alter table public.adstudio_brand_kits add column if not exists business_name text not null default '';
alter table public.adstudio_brand_kits add column if not exists market_country text not null default 'AU';
alter table public.adstudio_brand_kits add column if not exists market_region text;
alter table public.adstudio_brand_kits add column if not exists identity_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists logos_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists colours_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists typography_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists tone_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists visual_style_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists compliance_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists contact_json jsonb not null default '{}';
alter table public.adstudio_brand_kits add column if not exists locked_fields_json jsonb not null default '[]';
alter table public.adstudio_brand_kits add column if not exists created_by uuid references public.profiles (id);

alter table public.adstudio_brand_assets add column if not exists metadata_json jsonb not null default '{}';
alter table public.adstudio_brand_assets add column if not exists locked boolean not null default false;

alter table public.adstudio_offer_templates add column if not exists offer_id text not null default '';
alter table public.adstudio_offer_templates add column if not exists goal text not null default 'seller_leads';
alter table public.adstudio_offer_templates add column if not exists lead_temperature text not null default 'cold_to_warm';
alter table public.adstudio_offer_templates add column if not exists required_inputs_json jsonb not null default '[]';
alter table public.adstudio_offer_templates add column if not exists default_cta text not null default 'Download guide';
alter table public.adstudio_offer_templates add column if not exists landing_page_type text not null default 'lead_magnet_download';
alter table public.adstudio_offer_templates add column if not exists followup_type text not null default 'seller_nurture';
alter table public.adstudio_offer_templates add column if not exists active boolean not null default true;

alter table public.adstudio_campaigns add column if not exists legacy_campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.adstudio_campaigns add column if not exists name text not null default 'AdStudio campaign';
alter table public.adstudio_campaigns add column if not exists market_json jsonb not null default '{}';
alter table public.adstudio_campaigns add column if not exists audience_intent text;
alter table public.adstudio_campaigns add column if not exists offer_id text not null default 'seller_prep_checklist';
alter table public.adstudio_campaigns add column if not exists platforms_json jsonb not null default '[]';
alter table public.adstudio_campaigns add column if not exists creative_formats_json jsonb not null default '[]';

alter table public.adstudio_campaign_variants add column if not exists angle text not null default '';
alter table public.adstudio_campaign_variants add column if not exists headline text not null default '';
alter table public.adstudio_campaign_variants add column if not exists offer text not null default '';
alter table public.adstudio_campaign_variants add column if not exists cta text not null default '';
alter table public.adstudio_campaign_variants add column if not exists score_json jsonb not null default '{}';
alter table public.adstudio_campaign_variants add column if not exists status text not null default 'draft';
alter table public.adstudio_campaign_variants add column if not exists locked_fields_json jsonb not null default '[]';
alter table public.adstudio_campaign_variants add column if not exists updated_at timestamptz not null default now();

alter table public.adstudio_creatives add column if not exists format text not null default '1:1';
alter table public.adstudio_creatives add column if not exists width integer not null default 1080;
alter table public.adstudio_creatives add column if not exists height integer not null default 1080;
alter table public.adstudio_creatives add column if not exists render_status text not null default 'draft';
alter table public.adstudio_creatives add column if not exists preview_url text;
alter table public.adstudio_creatives add column if not exists preview_svg text;

alter table public.adstudio_creative_objects add column if not exists role text not null default 'object';
alter table public.adstudio_creative_objects add column if not exists content text;
alter table public.adstudio_creative_objects add column if not exists asset_id uuid references public.adstudio_brand_assets (id) on delete set null;
alter table public.adstudio_creative_objects add column if not exists bounds_json jsonb not null default '{}';
alter table public.adstudio_creative_objects add column if not exists style_json jsonb not null default '{}';
alter table public.adstudio_creative_objects add column if not exists locked boolean not null default false;
alter table public.adstudio_creative_objects add column if not exists sort_order integer not null default 0;
alter table public.adstudio_creative_objects add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'adstudio_platform_copy'
      and column_name = 'platform'
  ) then
    alter table public.adstudio_platform_copy alter column platform drop not null;
  end if;
end $$;
alter table public.adstudio_platform_copy add column if not exists meta_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists google_search_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists google_pmax_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists google_demand_gen_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists landing_page_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists followup_json jsonb not null default '{}';
alter table public.adstudio_platform_copy add column if not exists locked_fields_json jsonb not null default '[]';

alter table public.adstudio_exports add column if not exists status text not null default 'queued';
alter table public.adstudio_exports add column if not exists approval_request_id uuid references public.approval_requests (id) on delete set null;
alter table public.adstudio_exports add column if not exists updated_at timestamptz not null default now();

alter table public.adstudio_compliance_reports add column if not exists variant_id uuid references public.adstudio_campaign_variants (id) on delete cascade;
alter table public.adstudio_compliance_reports add column if not exists checked_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'adstudio_provider_runs'
      and column_name = 'provider'
  ) then
    alter table public.adstudio_provider_runs alter column provider drop not null;
  end if;
end $$;
alter table public.adstudio_provider_runs add column if not exists job_id uuid;
alter table public.adstudio_provider_runs add column if not exists provider_name text;
alter table public.adstudio_provider_runs add column if not exists provider_type text;
alter table public.adstudio_provider_runs add column if not exists model_name text;
alter table public.adstudio_provider_runs add column if not exists prompt_version_id uuid references public.prompt_versions (id) on delete set null;
alter table public.adstudio_provider_runs add column if not exists input_json jsonb not null default '{}';
alter table public.adstudio_provider_runs add column if not exists usage_json jsonb not null default '{}';
alter table public.adstudio_provider_runs add column if not exists cost_estimate numeric(10, 4) not null default 0;
alter table public.adstudio_provider_runs add column if not exists error_json jsonb;

alter table public.adstudio_template_versions add column if not exists template_id text not null default '';
alter table public.adstudio_template_versions add column if not exists vertical text not null default 'real_estate';
alter table public.adstudio_template_versions add column if not exists goal text not null default 'seller_leads';
alter table public.adstudio_template_versions add column if not exists offer_type text not null default 'seller_checklist';
alter table public.adstudio_template_versions add column if not exists active boolean not null default true;

alter table public.adstudio_job_runs add column if not exists input_hash text not null default '';
alter table public.adstudio_job_runs add column if not exists output_refs_json jsonb not null default '[]';
alter table public.adstudio_job_runs add column if not exists error_json jsonb;
alter table public.adstudio_job_runs add column if not exists created_at timestamptz not null default now();

alter table public.adstudio_performance_imports add column if not exists source text not null default 'provider_import';
alter table public.adstudio_performance_imports add column if not exists metrics_json jsonb not null default '{}';
alter table public.adstudio_performance_imports add column if not exists imported_by uuid references public.profiles (id);
alter table public.adstudio_performance_imports add column if not exists created_at timestamptz not null default now();

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
drop policy if exists adstudio_provider_runs_server_owned_no_client_insert on public.adstudio_provider_runs;
drop policy if exists adstudio_provider_runs_server_owned_no_client_update on public.adstudio_provider_runs;
drop policy if exists adstudio_provider_runs_server_owned_no_client_delete on public.adstudio_provider_runs;
create policy adstudio_provider_runs_server_owned_no_client_insert on public.adstudio_provider_runs for insert to authenticated with check (false);
create policy adstudio_provider_runs_server_owned_no_client_update on public.adstudio_provider_runs for update to authenticated using (false) with check (false);
create policy adstudio_provider_runs_server_owned_no_client_delete on public.adstudio_provider_runs for delete to authenticated using (false);

drop policy if exists adstudio_workspace_insert on public.adstudio_job_runs;
drop policy if exists adstudio_workspace_update on public.adstudio_job_runs;
drop policy if exists adstudio_workspace_delete on public.adstudio_job_runs;
drop policy if exists adstudio_job_runs_server_owned_no_client_insert on public.adstudio_job_runs;
drop policy if exists adstudio_job_runs_server_owned_no_client_update on public.adstudio_job_runs;
drop policy if exists adstudio_job_runs_server_owned_no_client_delete on public.adstudio_job_runs;
create policy adstudio_job_runs_server_owned_no_client_insert on public.adstudio_job_runs for insert to authenticated with check (false);
create policy adstudio_job_runs_server_owned_no_client_update on public.adstudio_job_runs for update to authenticated using (false) with check (false);
create policy adstudio_job_runs_server_owned_no_client_delete on public.adstudio_job_runs for delete to authenticated using (false);

create index if not exists adstudio_brand_kits_workspace_idx on public.adstudio_brand_kits (workspace_id, updated_at desc);
create index if not exists adstudio_campaigns_workspace_status_idx on public.adstudio_campaigns (workspace_id, status, created_at desc);
create index if not exists adstudio_variants_campaign_idx on public.adstudio_campaign_variants (campaign_id, created_at desc);
create index if not exists adstudio_creatives_campaign_idx on public.adstudio_creatives (campaign_id, format);
create index if not exists adstudio_exports_campaign_idx on public.adstudio_exports (campaign_id, created_at desc);
create index if not exists adstudio_job_runs_workspace_status_idx on public.adstudio_job_runs (workspace_id, status, created_at desc);
