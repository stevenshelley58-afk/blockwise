create extension if not exists pgcrypto;

create type public.workspace_mode as enum ('monitor', 'self_serve');
create type public.provider_key as enum ('meta', 'google');
create type public.provider_status as enum ('not_connected', 'connected', 'needs_attention', 'revoked');
create type public.approval_status as enum ('draft', 'requested', 'approved', 'rejected', 'cancelled');
create type public.agent_run_status as enum ('queued', 'running', 'needs_review', 'completed', 'failed', 'cancelled');
create type public.ai_run_status as enum ('queued', 'running', 'completed', 'blocked', 'failed');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  is_operator boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  monthly_ai_budget_cents integer not null default 0,
  max_workspaces integer not null default 1,
  max_agent_runs_per_month integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode public.workspace_mode not null default 'monitor',
  plan_id uuid references public.workspace_plans (id),
  region text not null default 'AU',
  managed_service_enabled boolean not null default false,
  approval_required_by_default boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer', 'operator')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_operator from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
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
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_operator()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id
        and wm.profile_id = auth.uid()
        and wm.role = any(roles)
    );
$$;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id),
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  subject_key text not null,
  bucket text not null,
  limit_count integer not null,
  used_count integer not null default 0,
  resets_at timestamptz not null,
  unique (workspace_id, subject_key, bucket)
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_key not null,
  status public.provider_status not null default 'not_connected',
  encrypted_access_token bytea,
  encrypted_refresh_token bytea,
  token_nonce text,
  token_last_four text,
  scopes text[] not null default '{}',
  external_account_id text,
  external_account_name text,
  last_sync_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_account_id)
);

create table public.model_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  task text not null,
  enabled boolean not null default true,
  requires_structured_output boolean not null default false,
  default_temperature numeric(4, 2) not null default 0.20,
  max_run_cost_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.model_profile_versions (
  id uuid primary key default gen_random_uuid(),
  model_profile_id uuid not null references public.model_profiles (id) on delete cascade,
  provider text not null,
  model text not null,
  input_usd_per_million_tokens numeric(10, 4) not null default 0,
  output_usd_per_million_tokens numeric(10, 4) not null default 0,
  image_usd_per_unit numeric(10, 4) not null default 0,
  supports_structured_output boolean not null default false,
  max_context_tokens integer not null default 0,
  active_from timestamptz not null default now(),
  active_to timestamptz
);

create table public.model_fallbacks (
  id uuid primary key default gen_random_uuid(),
  model_profile_id uuid not null references public.model_profiles (id) on delete cascade,
  fallback_version_id uuid not null references public.model_profile_versions (id) on delete cascade,
  priority integer not null,
  max_latency_ms integer,
  max_cost_cents integer,
  provider_restrictions jsonb not null default '{}',
  unique (model_profile_id, priority)
);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  key text not null,
  version integer not null,
  model_profile_id uuid references public.model_profiles (id),
  system_prompt text not null,
  output_schema jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (key, version)
);

create table public.ai_cost_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  model_profile_id uuid references public.model_profiles (id) on delete cascade,
  max_run_cost_cents integer not null,
  monthly_budget_cents integer not null,
  hard_kill_switch boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id),
  model_profile_id uuid references public.model_profiles (id),
  prompt_version_id uuid references public.prompt_versions (id),
  provider text not null,
  model text not null,
  task text not null,
  output_type text not null,
  status public.ai_run_status not null default 'queued',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  image_units integer not null default 0,
  estimated_cost_cents integer not null default 0,
  result_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  user_id uuid references public.profiles (id),
  provider text not null,
  model text not null,
  task text not null,
  output_type text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  image_units integer not null default 0,
  estimated_cost_cents integer not null default 0,
  result text not null check (result in ('completed', 'blocked', 'failed')),
  created_at timestamptz not null default now()
);

create table public.blocked_ai_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  reason text not null,
  risk_type text not null,
  blocked_output jsonb not null default '{}',
  reviewer_profile_id uuid references public.profiles (id),
  review_status public.approval_status not null default 'requested',
  created_at timestamptz not null default now()
);

create table public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  runtime text not null default 'blockwise_native',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.agent_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_definition_id uuid not null references public.agent_definitions (id) on delete cascade,
  action text not null,
  requires_human_approval boolean not null default false,
  unique (agent_definition_id, action)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_definition_id uuid references public.agent_definitions (id),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  status public.agent_run_status not null default 'queued',
  task text not null,
  confidence numeric(5, 2),
  required_human_action text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs (id) on delete cascade,
  step_key text not null,
  status public.agent_run_status not null default 'queued',
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now()
);

create table public.agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs (id) on delete cascade,
  artifact_type text not null,
  storage_path text,
  content jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.agent_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_definition_id uuid references public.agent_definitions (id),
  schedule_key text not null,
  cron text not null,
  enabled boolean not null default true,
  next_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs (id) on delete cascade,
  reviewer_profile_id uuid references public.profiles (id),
  status public.approval_status not null default 'requested',
  comment text,
  created_at timestamptz not null default now()
);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  website_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.competitor_watchlists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  enabled boolean not null default true,
  watched_sources text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.observed_ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete set null,
  source text not null,
  source_url text,
  headline text,
  body text,
  cta text,
  observed_at timestamptz not null default now()
);

create table public.ad_screenshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  observed_ad_id uuid references public.observed_ads (id) on delete cascade,
  storage_path text not null,
  captured_at timestamptz not null default now()
);

create table public.landing_captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  observed_ad_id uuid references public.observed_ads (id) on delete set null,
  url text not null,
  storage_path text,
  captured_text text,
  captured_at timestamptz not null default now()
);

create table public.market_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  suburb text not null,
  signal_type text not null,
  summary text not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.pattern_classifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  observed_ad_id uuid references public.observed_ads (id) on delete cascade,
  hook text,
  offer text,
  creative_type text,
  suburb_relevance text,
  lead_gen_intent text,
  compliance_risk text,
  confidence numeric(5, 2),
  source_evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.source_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_type text not null,
  source_url text,
  storage_path text,
  summary text not null,
  created_at timestamptz not null default now()
);

create table public.campaign_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  channel text not null,
  hook text,
  recommendation jsonb not null default '{}',
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.lead_magnets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_idea_id uuid references public.campaign_ideas (id) on delete set null,
  title text not null,
  format text not null,
  content jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.hooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_idea_id uuid references public.campaign_ideas (id) on delete cascade,
  text text not null,
  risk_label text,
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_idea_id uuid references public.campaign_ideas (id) on delete set null,
  provider public.provider_key not null,
  name text not null,
  status text not null default 'draft',
  draft_payload jsonb not null default '{}',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  asset_type text not null,
  content jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.creative_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_asset_id uuid references public.campaign_assets (id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  status public.approval_status not null default 'requested',
  requested_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  risk_summary text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.approval_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests (id) on delete cascade,
  profile_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.provider_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_key not null,
  local_type text not null,
  local_id uuid not null,
  provider_object_type text not null,
  provider_object_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_object_type, provider_object_id)
);

create table public.publish_statuses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  provider public.provider_key not null,
  status text not null default 'blocked_pending_approval',
  approval_request_id uuid references public.approval_requests (id),
  provider_response jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_key,
  external_id text,
  email text,
  phone text,
  full_name text,
  suburb text,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.lead_dedupe_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  dedupe_key text not null,
  duplicate_of_lead_id uuid references public.leads (id),
  created_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table public.lead_quality_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  label text not null,
  confidence numeric(5, 2),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table public.lead_source_attribution (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  provider public.provider_key,
  source jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.meta_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  meta_lead_id text not null,
  form_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, meta_lead_id)
);

create table public.google_lead_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  google_lead_id text not null,
  form_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, google_lead_id)
);

create table public.lead_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  import_type text not null check (import_type in ('csv', 'manual')),
  imported_by uuid references public.profiles (id),
  row_count integer not null default 0,
  storage_path text,
  created_at timestamptz not null default now()
);

create table public.lead_export_audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  exported_by uuid references public.profiles (id),
  approval_request_id uuid references public.approval_requests (id),
  row_count integer not null default 0,
  destination text not null,
  created_at timestamptz not null default now()
);

create table public.reporting_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_key not null,
  date_range daterange not null,
  metrics jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_key,
  job_key text not null,
  status text not null default 'queued',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.workspace_plans enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.model_profiles enable row level security;
alter table public.model_profile_versions enable row level security;
alter table public.model_fallbacks enable row level security;
alter table public.agent_definitions enable row level security;
alter table public.agent_permissions enable row level security;

create policy profiles_select_self_or_operator on public.profiles
  for select using (id = auth.uid() or public.is_operator());
create policy profiles_update_self_or_operator on public.profiles
  for update using (id = auth.uid() or public.is_operator())
  with check (id = auth.uid() or public.is_operator());

create policy workspace_plans_read on public.workspace_plans
  for select to authenticated using (true);
create policy workspace_plans_operator_write on public.workspace_plans
  for all using (public.is_operator()) with check (public.is_operator());

create policy workspaces_select_member on public.workspaces
  for select using (public.is_operator() or public.is_workspace_member(id));
create policy workspaces_insert_authenticated on public.workspaces
  for insert to authenticated with check (created_by = auth.uid() or public.is_operator());
create policy workspaces_admin_update on public.workspaces
  for update using (public.has_workspace_role(id, array['owner', 'admin', 'operator']))
  with check (public.has_workspace_role(id, array['owner', 'admin', 'operator']));

create policy workspace_members_select_member on public.workspace_members
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));
create policy workspace_members_admin_write on public.workspace_members
  for all using (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

create policy model_profiles_read_authenticated on public.model_profiles
  for select to authenticated using (true);
create policy model_profiles_operator_write on public.model_profiles
  for all using (public.is_operator()) with check (public.is_operator());
create policy model_versions_read_authenticated on public.model_profile_versions
  for select to authenticated using (true);
create policy model_versions_operator_write on public.model_profile_versions
  for all using (public.is_operator()) with check (public.is_operator());
create policy model_fallbacks_read_authenticated on public.model_fallbacks
  for select to authenticated using (true);
create policy model_fallbacks_operator_write on public.model_fallbacks
  for all using (public.is_operator()) with check (public.is_operator());
create policy agent_definitions_read_authenticated on public.agent_definitions
  for select to authenticated using (true);
create policy agent_definitions_operator_write on public.agent_definitions
  for all using (public.is_operator()) with check (public.is_operator());
create policy agent_permissions_read_authenticated on public.agent_permissions
  for select to authenticated using (true);
create policy agent_permissions_operator_write on public.agent_permissions
  for all using (public.is_operator()) with check (public.is_operator());

do $$
declare
  table_name text;
  workspace_tables text[] := array[
    'audit_logs', 'rate_limits', 'provider_connections', 'prompt_versions', 'ai_cost_policies',
    'ai_runs', 'ai_usage_ledger', 'blocked_ai_outputs', 'agent_runs', 'agent_steps',
    'agent_artifacts', 'agent_schedules', 'agent_reviews', 'competitors', 'competitor_watchlists',
    'observed_ads', 'ad_screenshots', 'landing_captures', 'market_signals',
    'pattern_classifications', 'source_evidence', 'campaign_ideas', 'lead_magnets', 'hooks',
    'campaigns', 'campaign_assets', 'creative_files', 'approval_requests', 'approval_comments',
    'provider_mappings', 'publish_statuses', 'leads', 'lead_events', 'lead_dedupe_records',
    'lead_quality_labels', 'lead_source_attribution', 'meta_leads', 'google_lead_forms',
    'lead_imports', 'lead_export_audits', 'reporting_snapshots', 'sync_runs'
  ];
begin
  foreach table_name in array workspace_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy workspace_select on public.%I for select using (public.is_operator() or public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy workspace_insert on public.%I for insert with check (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'', ''member'']))', table_name);
    execute format('create policy workspace_update on public.%I for update using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator''])) with check (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'']))', table_name);
    execute format('create policy workspace_delete on public.%I for delete using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''operator'']))', table_name);
  end loop;
end $$;

create index workspaces_mode_idx on public.workspaces (mode);
create index workspace_members_profile_idx on public.workspace_members (profile_id);
create index provider_connections_workspace_provider_idx on public.provider_connections (workspace_id, provider);
create index ai_runs_workspace_created_idx on public.ai_runs (workspace_id, created_at desc);
create index ai_usage_ledger_workspace_created_idx on public.ai_usage_ledger (workspace_id, created_at desc);
create index agent_runs_workspace_status_idx on public.agent_runs (workspace_id, status, created_at desc);
create index approval_requests_workspace_status_idx on public.approval_requests (workspace_id, status, created_at desc);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
create index reporting_snapshots_workspace_provider_idx on public.reporting_snapshots (workspace_id, provider, created_at desc);

insert into public.workspace_plans (key, name, monthly_ai_budget_cents, max_workspaces, max_agent_runs_per_month)
values
  ('starter', 'Starter', 5000, 1, 100),
  ('growth', 'Growth', 25000, 3, 1000),
  ('operator', 'Managed Operator', 100000, 50, 10000)
on conflict (key) do nothing;

insert into public.model_profiles (key, name, task, enabled, requires_structured_output, default_temperature, max_run_cost_cents)
values
  ('cheap_draft_text', 'Cheap draft text', 'Low-risk copy, summaries, and internal drafts', true, false, 0.70, 8),
  ('high_quality_strategy', 'High quality strategy', 'Campaign strategy and operator-reviewed recommendations', true, false, 0.50, 75),
  ('structured_json', 'Structured JSON', 'Schema-bound classifications and planning outputs', true, true, 0.20, 35),
  ('vision_classification', 'Vision classification', 'Observed ad screenshots and creative classification', true, true, 0.10, 50),
  ('image_draft', 'Image draft', 'Low-cost draft images and creative exploration', true, false, 0.80, 80),
  ('image_final', 'Image final', 'Client-ready creative assets', true, false, 0.65, 200),
  ('compliance_review', 'Compliance review', 'AU real-estate and ad policy checks', true, true, 0.10, 40)
on conflict (key) do nothing;

insert into public.agent_definitions (key, name, description)
values
  ('research_agent', 'Research Agent', 'Checks competitor watchlists and captures permitted public ad evidence.'),
  ('pattern_classifier_agent', 'Pattern Classifier Agent', 'Classifies observed ads by hook, offer, creative type, suburb relevance, and risk.'),
  ('idea_agent', 'Idea Agent', 'Turns patterns and owned results into campaign ideas.'),
  ('creative_brief_agent', 'Creative Brief Agent', 'Prepares image prompts, carousel concepts, and brand-safe briefs.'),
  ('campaign_draft_agent', 'Campaign Draft Agent', 'Creates Meta lead ad and Google Search drafts.'),
  ('compliance_agent', 'Compliance Agent', 'Flags real-estate claim, housing targeting, urgency, and unsupported performance risks.'),
  ('reporting_agent', 'Reporting Agent', 'Summarizes performance and recommends next tests.'),
  ('support_agent', 'Support Agent', 'Detects onboarding, OAuth, generation, and campaign roadblocks.'),
  ('cost_control_agent', 'Cost Control Agent', 'Watches AI spend, failed generations, model drift, and image usage.')
on conflict (key) do nothing;

insert into storage.buckets (id, name, public)
values ('workspace-artifacts', 'workspace-artifacts', false)
on conflict (id) do nothing;

create policy workspace_artifacts_read on storage.objects
  for select using (
    bucket_id = 'workspace-artifacts'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy workspace_artifacts_write on storage.objects
  for insert with check (
    bucket_id = 'workspace-artifacts'
    and public.has_workspace_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'operator', 'member'])
  );
