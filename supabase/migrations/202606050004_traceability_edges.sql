alter table public.audit_logs
  add column if not exists correlation_id text;

do $$
begin
  if to_regclass('public.approval_requests') is not null then
    alter table public.approval_requests
      add column if not exists correlation_id text;
  end if;
end $$;

alter table public.agent_runs
  add column if not exists user_id uuid references public.profiles (id) on delete set null,
  add column if not exists correlation_id text;

alter table public.agent_artifacts
  add column if not exists correlation_id text;

alter table public.lead_source_attribution
  add column if not exists correlation_id text,
  add column if not exists meta_publish_plan_id uuid,
  add column if not exists adstudio_campaign_id uuid,
  add column if not exists approval_request_id uuid;

do $$
begin
  if to_regclass('public.meta_publish_plans') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'lead_source_attribution_meta_publish_plan_id_fkey'
        and conrelid = 'public.lead_source_attribution'::regclass
    )
  then
    alter table public.lead_source_attribution
      add constraint lead_source_attribution_meta_publish_plan_id_fkey
      foreign key (meta_publish_plan_id)
      references public.meta_publish_plans (id)
      on delete set null;
  end if;

  if to_regclass('public.adstudio_campaigns') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'lead_source_attribution_adstudio_campaign_id_fkey'
        and conrelid = 'public.lead_source_attribution'::regclass
    )
  then
    alter table public.lead_source_attribution
      add constraint lead_source_attribution_adstudio_campaign_id_fkey
      foreign key (adstudio_campaign_id)
      references public.adstudio_campaigns (id)
      on delete set null;
  end if;

  if to_regclass('public.approval_requests') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'lead_source_attribution_approval_request_id_fkey'
        and conrelid = 'public.lead_source_attribution'::regclass
    )
  then
    alter table public.lead_source_attribution
      add constraint lead_source_attribution_approval_request_id_fkey
      foreign key (approval_request_id)
      references public.approval_requests (id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.lead_delivery_attempts') is not null then
    alter table public.lead_delivery_attempts
      add column if not exists correlation_id text;
  end if;

  if to_regclass('public.lead_export_audits') is not null then
    alter table public.lead_export_audits
      add column if not exists correlation_id text;
  end if;
end $$;

create index if not exists audit_logs_workspace_correlation_idx
  on public.audit_logs (workspace_id, correlation_id, created_at desc)
  where correlation_id is not null;

create index if not exists audit_logs_actor_target_idx
  on public.audit_logs (workspace_id, actor_profile_id, target_type, target_id, created_at desc);

do $$
begin
  if to_regclass('public.approval_requests') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'approval_requests'
        and column_name = 'workspace_id'
    )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'approval_requests'
          and column_name = 'target_type'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'approval_requests'
          and column_name = 'target_id'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'approval_requests'
          and column_name = 'created_at'
      )
    then
      create index if not exists approval_requests_target_idx
        on public.approval_requests (workspace_id, target_type, target_id, created_at desc);
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'approval_requests'
        and column_name = 'workspace_id'
    )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'approval_requests'
          and column_name = 'created_at'
      )
    then
      create index if not exists approval_requests_correlation_idx
        on public.approval_requests (workspace_id, correlation_id, created_at desc)
        where correlation_id is not null;
    end if;
  end if;
end $$;

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

do $$
begin
  if to_regclass('public.lead_delivery_attempts') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'lead_delivery_attempts'
        and column_name = 'workspace_id'
    )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lead_delivery_attempts'
          and column_name = 'created_at'
      )
    then
      create index if not exists lead_delivery_attempts_trace_idx
        on public.lead_delivery_attempts (workspace_id, correlation_id, created_at desc)
        where correlation_id is not null;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'lead_delivery_attempts'
        and column_name = 'workspace_id'
    )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lead_delivery_attempts'
          and column_name = 'lead_id'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lead_delivery_attempts'
          and column_name = 'approval_request_id'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lead_delivery_attempts'
          and column_name = 'created_at'
      )
    then
      create index if not exists lead_delivery_attempts_lead_approval_idx
        on public.lead_delivery_attempts (workspace_id, lead_id, approval_request_id, created_at desc);
    end if;
  end if;

  if to_regclass('public.lead_export_audits') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'lead_export_audits'
        and column_name = 'workspace_id'
    )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'lead_export_audits'
          and column_name = 'created_at'
      )
    then
      create index if not exists lead_export_audits_trace_idx
        on public.lead_export_audits (workspace_id, correlation_id, created_at desc)
        where correlation_id is not null;
    end if;
  end if;
end $$;
