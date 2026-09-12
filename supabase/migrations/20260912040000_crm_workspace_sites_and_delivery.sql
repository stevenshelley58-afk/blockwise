-- Per-agency CRM site mapping, CRM delivery state, and agent notice records.
--
-- Frappe CRM owns working lead, task and outcome state. Blockwise owns only:
--   * the workspace -> Frappe site mapping (isolation between agencies),
--   * CRM delivery state for a captured lead (pending / delivered / error),
--   * durable registration of the two agent notices it is allowed to send.
-- No table here duplicates stage, owner, task or outcome.

create table if not exists public.crm_workspace_sites (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  crm_site text not null unique,
  status text not null default 'ready' check (status in ('provisioning', 'ready', 'disabled')),
  provisioned_by text,
  api_user text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_workspace_sites_site_format_check
    check (crm_site ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$')
);

comment on table public.crm_workspace_sites is
  'One isolated Frappe site per Blockwise workspace. Provisioned on demand; never fall back to a shared admin site.';

create index if not exists crm_workspace_sites_status_idx
  on public.crm_workspace_sites (status, updated_at desc);

-- CRM delivery state for one captured lead. Deliberately separate from the
-- sales stage (owned by Frappe) and from email delivery (email_outbox).
create table if not exists public.lead_crm_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  source_provider text not null,
  source_submission_id text not null,
  command_id text not null,
  state text not null default 'pending' check (state in ('pending', 'delivered', 'error')),
  backfill boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  crm_lead text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_provider, source_submission_id),
  unique (workspace_id, command_id)
);

comment on table public.lead_crm_delivery_jobs is
  'CRM delivery state for a captured lead. pending means the enquiry is waiting for the CRM and must be shown as such.';

create index if not exists lead_crm_delivery_jobs_state_idx
  on public.lead_crm_delivery_jobs (workspace_id, state, created_at);
create index if not exists lead_crm_delivery_jobs_lead_idx
  on public.lead_crm_delivery_jobs (lead_id);

-- Durable registration of the only two agent notices Blockwise may send.
-- A notice is registered before dispatch and can be cancelled before send.
create table if not exists public.lead_notice_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  idempotency_key text not null unique,
  kind text not null check (kind in ('new_lead', 'follow_up_due_digest')),
  status text not null default 'pending'
    check (status in ('pending', 'hold', 'queued', 'cancelled', 'suppressed')),
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null,
  enquiry text,
  task text,
  -- Tasks covered by a digest notice, so completing or snoozing one of them
  -- can cancel the digest that would otherwise list stale work.
  task_keys text[] not null default '{}',
  local_date text,
  outbox_id uuid,
  outbox_idempotency_key text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_notice_records_new_lead_enquiry_check
    check (kind <> 'new_lead' or enquiry is not null),
  constraint lead_notice_records_digest_date_check
    check (kind <> 'follow_up_due_digest' or local_date is not null)
);

comment on table public.lead_notice_records is
  'Durable agent-notice registration. Recipients are workspace members only; a lead address is never a recipient.';

create index if not exists lead_notice_records_enquiry_idx
  on public.lead_notice_records (workspace_id, enquiry, status);
create index if not exists lead_notice_records_task_idx
  on public.lead_notice_records (workspace_id, task, status);
create index if not exists lead_notice_records_task_keys_idx
  on public.lead_notice_records using gin (task_keys)
  where status in ('pending', 'hold', 'queued');
create index if not exists lead_notice_records_dispatch_idx
  on public.lead_notice_records (status, created_at);

alter table public.crm_workspace_sites enable row level security;
alter table public.lead_crm_delivery_jobs enable row level security;
alter table public.lead_notice_records enable row level security;

revoke all on public.crm_workspace_sites from public, anon, authenticated;
revoke all on public.lead_crm_delivery_jobs from public, anon, authenticated;
revoke all on public.lead_notice_records from public, anon, authenticated;

grant all on public.crm_workspace_sites to service_role;
grant all on public.lead_crm_delivery_jobs to service_role;
grant all on public.lead_notice_records to service_role;

-- Members may read delivery state so the UI can show "waiting for CRM",
-- and may read their own notices. No client writes: every row is server-owned.
drop policy if exists crm_workspace_sites_workspace_select on public.crm_workspace_sites;
create policy crm_workspace_sites_workspace_select on public.crm_workspace_sites
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists lead_crm_delivery_jobs_workspace_select on public.lead_crm_delivery_jobs;
create policy lead_crm_delivery_jobs_workspace_select on public.lead_crm_delivery_jobs
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists lead_notice_records_workspace_select on public.lead_notice_records;
create policy lead_notice_records_workspace_select on public.lead_notice_records
  for select using (public.is_operator() or public.is_workspace_member(workspace_id));

drop policy if exists lead_crm_delivery_jobs_no_client_insert on public.lead_crm_delivery_jobs;
create policy lead_crm_delivery_jobs_no_client_insert on public.lead_crm_delivery_jobs
  for insert to authenticated with check (false);
drop policy if exists lead_crm_delivery_jobs_no_client_update on public.lead_crm_delivery_jobs;
create policy lead_crm_delivery_jobs_no_client_update on public.lead_crm_delivery_jobs
  for update to authenticated using (false) with check (false);
drop policy if exists lead_notice_records_no_client_insert on public.lead_notice_records;
create policy lead_notice_records_no_client_insert on public.lead_notice_records
  for insert to authenticated with check (false);
drop policy if exists lead_notice_records_no_client_update on public.lead_notice_records;
create policy lead_notice_records_no_client_update on public.lead_notice_records
  for update to authenticated using (false) with check (false);

-- Create-or-return the delivery job for a capture in one statement so a retry
-- always reuses the original command_id and cannot mint a second enquiry.
create or replace function public.ensure_lead_crm_delivery_job(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_source_provider text,
  p_source_submission_id text,
  p_command_id text,
  p_backfill boolean default false
)
returns public.lead_crm_delivery_jobs
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  job public.lead_crm_delivery_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('lead-crm-job:' || p_workspace_id || ':' || p_source_provider || ':' || p_source_submission_id, 0));

  select * into job
  from public.lead_crm_delivery_jobs
  where workspace_id = p_workspace_id
    and source_provider = p_source_provider
    and source_submission_id = p_source_submission_id;

  if found then
    return job;
  end if;

  insert into public.lead_crm_delivery_jobs (
    workspace_id, lead_id, source_provider, source_submission_id,
    command_id, state, backfill, attempts
  )
  values (
    p_workspace_id, p_lead_id, p_source_provider, p_source_submission_id,
    p_command_id, 'pending', coalesce(p_backfill, false), 0
  )
  returning * into job;

  return job;
end;
$$;

revoke all on function public.ensure_lead_crm_delivery_job(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ensure_lead_crm_delivery_job(uuid, uuid, text, text, text, boolean) to service_role;
