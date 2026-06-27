-- Production drift repair: the historical execution-layer migration was marked
-- applied, but these runtime tables were missing after adstudio_exports was
-- archived. Keep the repair forward-only and avoid depending on archived tables.

alter table public.provider_connections
  add column if not exists metadata_json jsonb not null default '{}';
alter table public.provider_connections
  add column if not exists token_expires_at timestamptz,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists health_checked_at timestamptz;
create table if not exists public.meta_publish_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  adstudio_campaign_id uuid not null,
  adstudio_export_id uuid,
  campaign_id uuid,
  provider_connection_id uuid not null,
  approval_request_id uuid,
  adapter text not null check (adapter in ('marketing_api', 'ads_cli', 'ads_mcp')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'publishing', 'paused_live', 'failed')),
  idempotency_key text not null,
  meta_ad_account_id text not null,
  page_id text not null,
  instagram_actor_id text,
  pixel_id text,
  lead_destination_json jsonb not null default '{}',
  privacy_policy_url text not null,
  currency text not null default 'AUD',
  timezone text not null default 'Australia/Perth',
  plan_json jsonb not null default '{}',
  request_log_json jsonb not null default '[]',
  response_log_json jsonb not null default '[]',
  reconciled_objects_json jsonb not null default '{}',
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
alter table public.meta_publish_plans enable row level security;
drop policy if exists meta_publish_plans_workspace_select on public.meta_publish_plans;
drop policy if exists meta_publish_plans_server_owned_no_client_insert on public.meta_publish_plans;
drop policy if exists meta_publish_plans_server_owned_no_client_update on public.meta_publish_plans;
drop policy if exists meta_publish_plans_server_owned_no_client_delete on public.meta_publish_plans;
create policy meta_publish_plans_workspace_select on public.meta_publish_plans
  for select
  using (private.is_operator() or private.is_workspace_member(workspace_id));
create policy meta_publish_plans_server_owned_no_client_insert on public.meta_publish_plans
  for insert to authenticated
  with check (false);
create policy meta_publish_plans_server_owned_no_client_update on public.meta_publish_plans
  for update to authenticated
  using (false)
  with check (false);
create policy meta_publish_plans_server_owned_no_client_delete on public.meta_publish_plans
  for delete to authenticated
  using (false);
create index if not exists meta_publish_plans_workspace_status_idx
  on public.meta_publish_plans (workspace_id, status, created_at desc);
create index if not exists meta_publish_plans_provider_connection_idx
  on public.meta_publish_plans (provider_connection_id, created_at desc);
create table if not exists public.meta_publish_plan_mutations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meta_publish_plan_id uuid not null,
  action text not null check (action in ('activate', 'pause', 'increase_budget', 'export_leads')),
  status text not null default 'requested' check (status in ('requested', 'approved', 'applying', 'applied', 'failed')),
  payload_json jsonb not null default '{}',
  approval_request_id uuid,
  request_log_json jsonb not null default '[]',
  response_log_json jsonb not null default '[]',
  last_error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meta_publish_plan_mutations enable row level security;
drop policy if exists meta_publish_plan_mutations_workspace_select on public.meta_publish_plan_mutations;
drop policy if exists meta_publish_plan_mutations_server_owned_no_client_insert on public.meta_publish_plan_mutations;
drop policy if exists meta_publish_plan_mutations_server_owned_no_client_update on public.meta_publish_plan_mutations;
drop policy if exists meta_publish_plan_mutations_server_owned_no_client_delete on public.meta_publish_plan_mutations;
create policy meta_publish_plan_mutations_workspace_select on public.meta_publish_plan_mutations
  for select
  using (private.is_operator() or private.is_workspace_member(workspace_id));
create policy meta_publish_plan_mutations_server_owned_no_client_insert on public.meta_publish_plan_mutations
  for insert to authenticated
  with check (false);
create policy meta_publish_plan_mutations_server_owned_no_client_update on public.meta_publish_plan_mutations
  for update to authenticated
  using (false)
  with check (false);
create policy meta_publish_plan_mutations_server_owned_no_client_delete on public.meta_publish_plan_mutations
  for delete to authenticated
  using (false);
create index if not exists meta_publish_plan_mutations_plan_status_idx
  on public.meta_publish_plan_mutations (meta_publish_plan_id, status, created_at desc);
create table if not exists public.lead_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null,
  provider public.provider_key not null default 'meta',
  destination_type text not null,
  destination_label text not null,
  status text not null default 'queued' check (status in ('queued', 'delivered', 'failed', 'manual_review')),
  approval_request_id uuid,
  request_json jsonb not null default '{}',
  response_json jsonb not null default '{}',
  correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lead_delivery_attempts enable row level security;
drop policy if exists lead_delivery_attempts_workspace_select on public.lead_delivery_attempts;
drop policy if exists lead_delivery_attempts_server_owned_no_client_insert on public.lead_delivery_attempts;
drop policy if exists lead_delivery_attempts_server_owned_no_client_update on public.lead_delivery_attempts;
drop policy if exists lead_delivery_attempts_server_owned_no_client_delete on public.lead_delivery_attempts;
create policy lead_delivery_attempts_workspace_select on public.lead_delivery_attempts
  for select
  using (private.is_operator() or private.is_workspace_member(workspace_id));
create policy lead_delivery_attempts_server_owned_no_client_insert on public.lead_delivery_attempts
  for insert to authenticated
  with check (false);
create policy lead_delivery_attempts_server_owned_no_client_update on public.lead_delivery_attempts
  for update to authenticated
  using (false)
  with check (false);
create policy lead_delivery_attempts_server_owned_no_client_delete on public.lead_delivery_attempts
  for delete to authenticated
  using (false);
create index if not exists lead_delivery_attempts_workspace_status_idx
  on public.lead_delivery_attempts (workspace_id, status, created_at desc);
create index if not exists lead_delivery_attempts_trace_idx
  on public.lead_delivery_attempts (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;
create index if not exists lead_delivery_attempts_lead_approval_idx
  on public.lead_delivery_attempts (workspace_id, lead_id, approval_request_id, created_at desc);
do $$
begin
  if to_regclass('public.workspaces') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_workspace_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces (id) on delete cascade;
  end if;

  if to_regclass('public.adstudio_campaigns') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_adstudio_campaign_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_adstudio_campaign_id_fkey
      foreign key (adstudio_campaign_id) references public.adstudio_campaigns (id) on delete cascade;
  end if;

  if to_regclass('public.adstudio_exports') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_adstudio_export_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_adstudio_export_id_fkey
      foreign key (adstudio_export_id) references public.adstudio_exports (id) on delete set null;
  end if;

  if to_regclass('public.campaigns') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_campaign_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_campaign_id_fkey
      foreign key (campaign_id) references public.campaigns (id) on delete set null;
  end if;

  if to_regclass('public.provider_connections') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_provider_connection_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_provider_connection_id_fkey
      foreign key (provider_connection_id) references public.provider_connections (id) on delete restrict;
  end if;

  if to_regclass('public.approval_requests') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_approval_request_id_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_approval_request_id_fkey
      foreign key (approval_request_id) references public.approval_requests (id) on delete set null;
  end if;

  if to_regclass('public.profiles') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plans_created_by_fkey'
      and conrelid = 'public.meta_publish_plans'::regclass
  ) then
    alter table public.meta_publish_plans
      add constraint meta_publish_plans_created_by_fkey
      foreign key (created_by) references public.profiles (id);
  end if;

  if to_regclass('public.meta_publish_plans') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plan_mutations_meta_publish_plan_id_fkey'
      and conrelid = 'public.meta_publish_plan_mutations'::regclass
  ) then
    alter table public.meta_publish_plan_mutations
      add constraint meta_publish_plan_mutations_meta_publish_plan_id_fkey
      foreign key (meta_publish_plan_id) references public.meta_publish_plans (id) on delete cascade;
  end if;

  if to_regclass('public.workspaces') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plan_mutations_workspace_id_fkey'
      and conrelid = 'public.meta_publish_plan_mutations'::regclass
  ) then
    alter table public.meta_publish_plan_mutations
      add constraint meta_publish_plan_mutations_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces (id) on delete cascade;
  end if;

  if to_regclass('public.approval_requests') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plan_mutations_approval_request_id_fkey'
      and conrelid = 'public.meta_publish_plan_mutations'::regclass
  ) then
    alter table public.meta_publish_plan_mutations
      add constraint meta_publish_plan_mutations_approval_request_id_fkey
      foreign key (approval_request_id) references public.approval_requests (id) on delete set null;
  end if;

  if to_regclass('public.profiles') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'meta_publish_plan_mutations_requested_by_fkey'
      and conrelid = 'public.meta_publish_plan_mutations'::regclass
  ) then
    alter table public.meta_publish_plan_mutations
      add constraint meta_publish_plan_mutations_requested_by_fkey
      foreign key (requested_by) references public.profiles (id);
  end if;

  if to_regclass('public.workspaces') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'lead_delivery_attempts_workspace_id_fkey'
      and conrelid = 'public.lead_delivery_attempts'::regclass
  ) then
    alter table public.lead_delivery_attempts
      add constraint lead_delivery_attempts_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces (id) on delete cascade;
  end if;

  if to_regclass('public.leads') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'lead_delivery_attempts_lead_id_fkey'
      and conrelid = 'public.lead_delivery_attempts'::regclass
  ) then
    alter table public.lead_delivery_attempts
      add constraint lead_delivery_attempts_lead_id_fkey
      foreign key (lead_id) references public.leads (id) on delete cascade;
  end if;

  if to_regclass('public.approval_requests') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'lead_delivery_attempts_approval_request_id_fkey'
      and conrelid = 'public.lead_delivery_attempts'::regclass
  ) then
    alter table public.lead_delivery_attempts
      add constraint lead_delivery_attempts_approval_request_id_fkey
      foreign key (approval_request_id) references public.approval_requests (id) on delete set null;
  end if;

  if to_regclass('public.lead_source_attribution') is not null and not exists (
    select 1 from pg_constraint
    where conname = 'lead_source_attribution_meta_publish_plan_id_fkey'
      and conrelid = 'public.lead_source_attribution'::regclass
  ) then
    alter table public.lead_source_attribution
      add constraint lead_source_attribution_meta_publish_plan_id_fkey
      foreign key (meta_publish_plan_id) references public.meta_publish_plans (id) on delete set null;
  end if;
end $$;
