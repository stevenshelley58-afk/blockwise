alter table public.audit_logs
  add column if not exists correlation_id text;

alter table public.approval_requests
  add column if not exists correlation_id text;

alter table public.agent_runs
  add column if not exists user_id uuid references public.profiles (id) on delete set null,
  add column if not exists correlation_id text;

alter table public.agent_artifacts
  add column if not exists correlation_id text;

alter table public.lead_source_attribution
  add column if not exists correlation_id text,
  add column if not exists meta_publish_plan_id uuid references public.meta_publish_plans (id) on delete set null,
  add column if not exists adstudio_campaign_id uuid references public.adstudio_campaigns (id) on delete set null,
  add column if not exists approval_request_id uuid references public.approval_requests (id) on delete set null;

alter table public.lead_delivery_attempts
  add column if not exists correlation_id text;

alter table public.lead_export_audits
  add column if not exists correlation_id text;

create index if not exists audit_logs_workspace_correlation_idx
  on public.audit_logs (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists audit_logs_actor_target_idx
  on public.audit_logs (workspace_id, actor_profile_id, target_type, target_id, created_at desc);

create index if not exists approval_requests_target_idx
  on public.approval_requests (workspace_id, target_type, target_id, created_at desc);

create index if not exists approval_requests_correlation_idx
  on public.approval_requests (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists agent_runs_user_correlation_idx
  on public.agent_runs (workspace_id, user_id, correlation_id, created_at desc);

create index if not exists agent_artifacts_run_idx
  on public.agent_artifacts (workspace_id, agent_run_id, created_at desc);

create index if not exists agent_artifacts_correlation_idx
  on public.agent_artifacts (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists lead_source_attribution_trace_idx
  on public.lead_source_attribution (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists lead_source_attribution_publish_plan_idx
  on public.lead_source_attribution (workspace_id, meta_publish_plan_id, created_at desc)
  where meta_publish_plan_id is not null;

create index if not exists lead_source_attribution_approval_idx
  on public.lead_source_attribution (workspace_id, approval_request_id, created_at desc)
  where approval_request_id is not null;

create index if not exists lead_delivery_attempts_trace_idx
  on public.lead_delivery_attempts (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists lead_delivery_attempts_lead_approval_idx
  on public.lead_delivery_attempts (workspace_id, lead_id, approval_request_id, created_at desc);

create index if not exists lead_export_audits_trace_idx
  on public.lead_export_audits (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;
