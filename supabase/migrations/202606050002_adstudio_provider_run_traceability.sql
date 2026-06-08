alter table public.adstudio_provider_runs
  add column if not exists user_id uuid references public.profiles (id) on delete set null,
  add column if not exists correlation_id text,
  add column if not exists ai_run_id uuid references public.ai_runs (id) on delete set null,
  add column if not exists task_type text,
  add column if not exists model_profile text,
  add column if not exists ai_usage_ledger_id uuid references public.ai_usage_ledger (id) on delete set null;

alter table public.ai_runs
  add column if not exists correlation_id text;

alter table public.ai_usage_ledger
  add column if not exists correlation_id text;

create index if not exists adstudio_provider_runs_workspace_trace_idx
  on public.adstudio_provider_runs (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists adstudio_provider_runs_operator_cost_filters_idx
  on public.adstudio_provider_runs (workspace_id, user_id, model_name, provider_name, created_at desc);

create index if not exists adstudio_provider_runs_task_model_profile_idx
  on public.adstudio_provider_runs (workspace_id, task_type, model_profile, created_at desc);

create index if not exists adstudio_provider_runs_ledger_idx
  on public.adstudio_provider_runs (workspace_id, ai_usage_ledger_id)
  where ai_usage_ledger_id is not null;

create index if not exists adstudio_provider_runs_ai_run_idx
  on public.adstudio_provider_runs (workspace_id, ai_run_id)
  where ai_run_id is not null;

create index if not exists adstudio_provider_runs_job_idx
  on public.adstudio_provider_runs (workspace_id, job_id)
  where job_id is not null;

create index if not exists ai_runs_workspace_trace_idx
  on public.ai_runs (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists ai_runs_operator_cost_filters_idx
  on public.ai_runs (workspace_id, user_id, provider, model, task, created_at desc);

create index if not exists ai_usage_ledger_operator_cost_filters_idx
  on public.ai_usage_ledger (workspace_id, user_id, model, task, created_at desc);

create index if not exists ai_usage_ledger_workspace_trace_idx
  on public.ai_usage_ledger (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;
