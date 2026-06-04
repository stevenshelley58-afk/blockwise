-- Hardening pass for client-data isolation, agent runtime safety, and token handling.

create schema if not exists private;

revoke all on schema private from anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.provider_token_vault (
  provider_connection_id uuid primary key references public.provider_connections (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  encrypted_access_token bytea,
  encrypted_refresh_token bytea,
  token_nonce text,
  token_last_four text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.provider_token_vault enable row level security;

drop policy if exists provider_token_vault_no_client_access on private.provider_token_vault;
create policy provider_token_vault_no_client_access on private.provider_token_vault
  for all to anon, authenticated
  using (false)
  with check (false);

revoke all on private.provider_token_vault from anon, authenticated;
grant all on private.provider_token_vault to service_role;

insert into private.provider_token_vault (
  provider_connection_id,
  workspace_id,
  encrypted_access_token,
  encrypted_refresh_token,
  token_nonce,
  token_last_four
)
select
  id,
  workspace_id,
  encrypted_access_token,
  encrypted_refresh_token,
  token_nonce,
  token_last_four
from public.provider_connections
where encrypted_access_token is not null
   or encrypted_refresh_token is not null
   or token_nonce is not null
on conflict (provider_connection_id) do update set
  workspace_id = excluded.workspace_id,
  encrypted_access_token = excluded.encrypted_access_token,
  encrypted_refresh_token = excluded.encrypted_refresh_token,
  token_nonce = excluded.token_nonce,
  token_last_four = excluded.token_last_four,
  updated_at = now();

alter table public.provider_connections
  drop column if exists encrypted_access_token,
  drop column if exists encrypted_refresh_token,
  drop column if exists token_nonce,
  drop column if exists token_last_four;

alter table public.agent_permissions
  add column if not exists allowed_data_classes text[] not null default array['internal_operational']::text[],
  add column if not exists allowed_destinations text[] not null default array['internal_artifact']::text[],
  add column if not exists allowed_outbound_domains text[] not null default '{}'::text[],
  add column if not exists max_rows_per_run integer not null default 100,
  add column if not exists can_cross_workspace boolean not null default false;

alter table public.agent_runs
  add column if not exists requested_workspace_ids uuid[] not null default '{}'::uuid[],
  add column if not exists approval_request_id uuid references public.approval_requests (id) on delete set null,
  add column if not exists runtime_policy jsonb not null default '{}',
  add column if not exists policy_version integer not null default 1;

alter table public.agent_artifacts
  add column if not exists data_class text not null default 'internal_operational',
  add column if not exists contains_pii boolean not null default false;

alter table public.ai_runs
  add column if not exists data_classes text[] not null default '{}'::text[],
  add column if not exists prompt_sensitivity text not null default 'internal',
  add column if not exists ai_gateway_id text;

alter table public.lead_export_audits
  add constraint lead_export_audits_require_approval
  check (approval_request_id is not null)
  not valid;

with permission_seed (
  agent_key,
  action,
  requires_human_approval,
  allowed_data_classes,
  allowed_destinations,
  allowed_outbound_domains,
  max_rows_per_run,
  can_cross_workspace
) as (
  values
    ('research_agent', 'capture_public_evidence', false, array['public_competitor_data', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 100, false),
    ('research_agent', 'classify_pattern', false, array['public_competitor_data', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 100, false),
    ('pattern_classifier_agent', 'classify_pattern', false, array['public_competitor_data', 'compliance_risk', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 100, false),
    ('idea_agent', 'generate_idea', false, array['public_competitor_data', 'performance_metrics', 'campaign_draft', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 100, false),
    ('creative_brief_agent', 'draft_creative_brief', false, array['campaign_draft', 'creative_asset', 'public_competitor_data', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 50, false),
    ('campaign_draft_agent', 'draft_campaign', false, array['campaign_draft', 'compliance_risk', 'performance_metrics', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 50, false),
    ('campaign_draft_agent', 'run_compliance_review', false, array['campaign_draft', 'compliance_risk', 'performance_metrics', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 50, false),
    ('compliance_agent', 'run_compliance_review', false, array['campaign_draft', 'creative_asset', 'compliance_risk', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 50, false),
    ('reporting_agent', 'summarize_reporting', false, array['performance_metrics', 'cost_metadata', 'internal_operational'], array['internal_artifact', 'model_prompt'], array['api.openai.com', 'gateway.ai.cloudflare.com', 'openrouter.ai'], 250, false),
    ('support_agent', 'queue_support_action', false, array['support_metadata', 'internal_operational'], array['internal_artifact'], array[]::text[], 100, false),
    ('cost_control_agent', 'watch_costs', false, array['cost_metadata', 'internal_operational'], array['internal_artifact'], array[]::text[], 500, false)
)
insert into public.agent_permissions (
  agent_definition_id,
  action,
  requires_human_approval,
  allowed_data_classes,
  allowed_destinations,
  allowed_outbound_domains,
  max_rows_per_run,
  can_cross_workspace
)
select
  ad.id,
  seed.action,
  seed.requires_human_approval,
  seed.allowed_data_classes,
  seed.allowed_destinations,
  seed.allowed_outbound_domains,
  seed.max_rows_per_run,
  seed.can_cross_workspace
from permission_seed seed
join public.agent_definitions ad on ad.key = seed.agent_key
on conflict (agent_definition_id, action) do update set
  requires_human_approval = excluded.requires_human_approval,
  allowed_data_classes = excluded.allowed_data_classes,
  allowed_destinations = excluded.allowed_destinations,
  allowed_outbound_domains = excluded.allowed_outbound_domains,
  max_rows_per_run = excluded.max_rows_per_run,
  can_cross_workspace = excluded.can_cross_workspace;

create table if not exists public.cross_workspace_access_grants (
  id uuid primary key default gen_random_uuid(),
  source_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests (id) on delete restrict,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  reason text not null,
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (source_workspace_id <> target_workspace_id)
);

alter table public.cross_workspace_access_grants enable row level security;

create policy cross_workspace_access_grants_select_operator on public.cross_workspace_access_grants
  for select using (public.is_operator());
create policy cross_workspace_access_grants_write_operator on public.cross_workspace_access_grants
  for all using (public.is_operator()) with check (public.is_operator());

drop policy if exists workspace_insert on public.audit_logs;
drop policy if exists workspace_update on public.audit_logs;
drop policy if exists workspace_delete on public.audit_logs;
create policy audit_logs_server_owned_no_client_insert on public.audit_logs for insert to authenticated with check (false);
create policy audit_logs_server_owned_no_client_update on public.audit_logs for update to authenticated using (false) with check (false);
create policy audit_logs_server_owned_no_client_delete on public.audit_logs for delete to authenticated using (false);

drop policy if exists workspace_insert on public.ai_runs;
drop policy if exists workspace_update on public.ai_runs;
drop policy if exists workspace_delete on public.ai_runs;
create policy ai_runs_server_owned_no_client_insert on public.ai_runs for insert to authenticated with check (false);
create policy ai_runs_server_owned_no_client_update on public.ai_runs for update to authenticated using (false) with check (false);
create policy ai_runs_server_owned_no_client_delete on public.ai_runs for delete to authenticated using (false);

drop policy if exists workspace_insert on public.ai_usage_ledger;
drop policy if exists workspace_update on public.ai_usage_ledger;
drop policy if exists workspace_delete on public.ai_usage_ledger;
create policy ai_usage_ledger_server_owned_no_client_insert on public.ai_usage_ledger for insert to authenticated with check (false);
create policy ai_usage_ledger_server_owned_no_client_update on public.ai_usage_ledger for update to authenticated using (false) with check (false);
create policy ai_usage_ledger_server_owned_no_client_delete on public.ai_usage_ledger for delete to authenticated using (false);

drop policy if exists workspace_insert on public.agent_runs;
drop policy if exists workspace_update on public.agent_runs;
drop policy if exists workspace_delete on public.agent_runs;
create policy agent_runs_server_owned_no_client_insert on public.agent_runs for insert to authenticated with check (false);
create policy agent_runs_server_owned_no_client_update on public.agent_runs for update to authenticated using (false) with check (false);
create policy agent_runs_server_owned_no_client_delete on public.agent_runs for delete to authenticated using (false);

drop policy if exists workspace_insert on public.agent_steps;
drop policy if exists workspace_update on public.agent_steps;
drop policy if exists workspace_delete on public.agent_steps;
create policy agent_steps_server_owned_no_client_insert on public.agent_steps for insert to authenticated with check (false);
create policy agent_steps_server_owned_no_client_update on public.agent_steps for update to authenticated using (false) with check (false);
create policy agent_steps_server_owned_no_client_delete on public.agent_steps for delete to authenticated using (false);

drop policy if exists workspace_insert on public.agent_artifacts;
drop policy if exists workspace_update on public.agent_artifacts;
drop policy if exists workspace_delete on public.agent_artifacts;
create policy agent_artifacts_server_owned_no_client_insert on public.agent_artifacts for insert to authenticated with check (false);
create policy agent_artifacts_server_owned_no_client_update on public.agent_artifacts for update to authenticated using (false) with check (false);
create policy agent_artifacts_server_owned_no_client_delete on public.agent_artifacts for delete to authenticated using (false);

drop policy if exists workspace_insert on public.provider_connections;
drop policy if exists workspace_update on public.provider_connections;
drop policy if exists workspace_delete on public.provider_connections;
create policy provider_connections_server_owned_no_client_insert on public.provider_connections for insert to authenticated with check (false);
create policy provider_connections_server_owned_no_client_update on public.provider_connections for update to authenticated using (false) with check (false);
create policy provider_connections_server_owned_no_client_delete on public.provider_connections for delete to authenticated using (false);

drop policy if exists workspace_insert on public.lead_export_audits;
drop policy if exists workspace_update on public.lead_export_audits;
drop policy if exists workspace_delete on public.lead_export_audits;
create policy lead_export_audits_server_owned_no_client_insert on public.lead_export_audits for insert to authenticated with check (false);
create policy lead_export_audits_server_owned_no_client_update on public.lead_export_audits for update to authenticated using (false) with check (false);
create policy lead_export_audits_server_owned_no_client_delete on public.lead_export_audits for delete to authenticated using (false);

create or replace function public.workspace_id_from_storage_path(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.workspace_id_from_storage_path(text) to authenticated;

drop policy if exists workspace_artifacts_read on storage.objects;
drop policy if exists workspace_artifacts_write on storage.objects;

create policy workspace_artifacts_read on storage.objects
  for select using (
    bucket_id = 'workspace-artifacts'
    and public.is_workspace_member(public.workspace_id_from_storage_path(name))
  );

create policy workspace_artifacts_write on storage.objects
  for insert with check (
    bucket_id = 'workspace-artifacts'
    and public.has_workspace_role(
      public.workspace_id_from_storage_path(name),
      array['owner', 'admin', 'operator', 'member']
    )
  );
