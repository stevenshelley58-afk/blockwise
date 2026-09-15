-- Make Mautic bridge writes recoverable across producer and marker failures.
-- Existing workspaces and Meta leads predate the bridge, so adding each marker
-- with a one-time default records them as already handled. The default is then
-- removed so every newly-created row starts pending.
alter table public.workspaces
  add column if not exists mautic_signed_up_queued_at timestamptz default now();

alter table public.workspaces
  alter column mautic_signed_up_queued_at drop default;

comment on column public.workspaces.mautic_signed_up_queued_at is
  'Time the signed-up Mautic stage was durably queued for this workspace.';

alter table public.meta_leads
  add column if not exists mautic_new_leads_queued_at timestamptz default now(),
  add column if not exists mautic_batch_key text,
  add column if not exists mautic_plan_id uuid references public.meta_publish_plans (id) on delete set null;

alter table public.meta_leads
  alter column mautic_new_leads_queued_at drop default;

comment on column public.meta_leads.mautic_new_leads_queued_at is
  'Time this captured Meta lead was included in a durably queued Mautic batch event.';

comment on column public.meta_leads.mautic_batch_key is
  'Stable identity of the provider sync batch that first captured this lead.';

comment on column public.meta_leads.mautic_plan_id is
  'Meta publish plan whose form sync first captured this lead batch.';

create index if not exists meta_leads_mautic_pending_idx
  on public.meta_leads (workspace_id, mautic_plan_id, mautic_batch_key, created_at, id)
  where mautic_new_leads_queued_at is null;

-- Unlike generic work, a completed Mautic flow subject must remain a receipt:
-- producer retries must return the original row rather than create a second
-- contact-field transition after the first job has settled.
create unique index if not exists job_queue_mautic_sync_receipt_idx
  on public.job_queue (workspace_id, kind, dedupe_key)
  where kind = 'mautic_sync' and dedupe_key is not null;

create or replace function public.enqueue_job_v2(
  p_workspace_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts int default 3,
  p_run_after timestamptz default now(),
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
begin
  if p_workspace_id is null then
    raise exception 'enqueue_job_v2 requires p_workspace_id'
      using errcode = '22023';
  end if;

  if p_kind is null or btrim(p_kind) = '' then
    raise exception 'enqueue_job_v2 requires a non-empty p_kind'
      using errcode = '22023';
  end if;

  if p_max_attempts is null or p_max_attempts not between 1 and 25 then
    raise exception 'enqueue_job_v2 p_max_attempts must be between 1 and 25'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'enqueue_job_v2 p_payload must be a JSON object'
      using errcode = '22023';
  end if;

  if nullif(v_payload ->> 'workspaceId', '') is not null
     and v_payload ->> 'workspaceId' <> p_workspace_id::text then
    raise exception 'enqueue_job_v2 workspace payload does not match p_workspace_id'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.workspaces as w
    where w.id = p_workspace_id
  ) then
    raise exception 'enqueue_job_v2 workspace does not exist'
      using errcode = '23503';
  end if;

  v_payload := v_payload || jsonb_build_object(
    'workspaceId',
    p_workspace_id::text
  );

  if p_kind = 'mautic_sync' then
    if p_dedupe_key is null or btrim(p_dedupe_key) = '' then
      raise exception 'mautic_sync requires a dedupe key'
        using errcode = '22023';
    end if;

    insert into public.job_queue (
      workspace_id,
      kind,
      payload,
      max_attempts,
      run_after,
      dedupe_key
    )
    values (
      p_workspace_id,
      p_kind,
      v_payload,
      p_max_attempts,
      coalesce(p_run_after, now()),
      p_dedupe_key
    )
    on conflict (workspace_id, kind, dedupe_key)
      where kind = 'mautic_sync' and dedupe_key is not null
      do update set dedupe_key = excluded.dedupe_key
    returning id into v_id;
  else
    insert into public.job_queue (
      workspace_id,
      kind,
      payload,
      max_attempts,
      run_after,
      dedupe_key
    )
    values (
      p_workspace_id,
      p_kind,
      v_payload,
      p_max_attempts,
      coalesce(p_run_after, now()),
      p_dedupe_key
    )
    on conflict (workspace_id, kind, dedupe_key)
      where status in ('pending', 'processing') and dedupe_key is not null
      do update set updated_at = now()
    returning id into v_id;
  end if;

  return v_id;
end;
$$;
