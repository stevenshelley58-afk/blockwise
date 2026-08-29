-- Make workspace identity and worker ownership database-enforced. This is the
-- rolling migration: legacy worker settlement RPCs remain temporarily, while
-- the v2 worker uses workspace-fenced lease tokens. The follow-up migration
-- removes legacy settlement after the v2 worker is live.
--
-- Production inventory before this migration (2026-08-02): five terminal
-- rows, zero processing rows. Two terminal test/smoke rows could not resolve
-- to a real workspace and are archived below; the three remaining rows are
-- failed publish jobs for one workspace and one plan.

begin;

alter table public.job_queue
  add column if not exists workspace_id uuid,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

-- Backfill only through a real workspace row. Comparing canonical UUID text
-- avoids ever casting malformed legacy payload data.
update public.job_queue as q
set
  workspace_id = w.id,
  updated_at = now()
from public.workspaces as w
where q.workspace_id is null
  and nullif(q.payload ->> 'workspaceId', '') = w.id::text;

create schema if not exists legacy_archive;
revoke all on schema legacy_archive from public, anon, authenticated;
grant usage on schema legacy_archive to service_role;

create table if not exists legacy_archive.job_queue_unscoped (
  id uuid primary key,
  workspace_id uuid,
  kind text not null,
  payload jsonb not null,
  status text not null,
  attempts int not null,
  max_attempts int not null,
  run_after timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  archived_at timestamptz not null default now(),
  archive_reason text not null
);

revoke all on legacy_archive.job_queue_unscoped
  from public, anon, authenticated;
grant select on legacy_archive.job_queue_unscoped to service_role;
alter table legacy_archive.job_queue_unscoped enable row level security;

-- An unscoped active job is ambiguous and must be quarantined manually rather
-- than silently moved. Terminal rows are preserved before removal, and the
-- row-count assertions make loss impossible.
do $$
declare
  v_unscoped int;
  v_active int;
  v_archived int;
  v_deleted int;
begin
  select
    count(*)::int,
    count(*) filter (where status in ('pending', 'processing'))::int
  into v_unscoped, v_active
  from public.job_queue
  where workspace_id is null;

  raise notice 'job_queue workspace backfill left % unscoped rows (% active)',
    v_unscoped,
    v_active;

  if v_active > 0 then
    raise exception
      'job_queue contains % active rows without a resolvable workspace; quarantine required',
      v_active;
  end if;

  insert into legacy_archive.job_queue_unscoped (
    id,
    workspace_id,
    kind,
    payload,
    status,
    attempts,
    max_attempts,
    run_after,
    claimed_at,
    completed_at,
    last_error,
    dedupe_key,
    created_at,
    updated_at,
    lease_token,
    lease_expires_at,
    archived_at,
    archive_reason
  )
  select
    q.id,
    q.workspace_id,
    q.kind,
    q.payload,
    q.status,
    q.attempts,
    q.max_attempts,
    q.run_after,
    q.claimed_at,
    q.completed_at,
    q.last_error,
    q.dedupe_key,
    q.created_at,
    q.updated_at,
    q.lease_token,
    q.lease_expires_at,
    now(),
    'No valid workspace could be resolved from the legacy queue payload.'
  from public.job_queue as q
  where q.workspace_id is null
  on conflict (id) do nothing;

  select count(*)::int
  into v_archived
  from public.job_queue as q
  join legacy_archive.job_queue_unscoped as a on a.id = q.id
  where q.workspace_id is null;

  if v_archived <> v_unscoped then
    raise exception
      'job_queue archive row-count mismatch: expected %, found %',
      v_unscoped,
      v_archived;
  end if;

  delete from public.job_queue as q
  using legacy_archive.job_queue_unscoped as a
  where q.id = a.id
    and q.workspace_id is null;
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_unscoped then
    raise exception
      'job_queue removal row-count mismatch: expected %, removed %',
      v_unscoped,
      v_deleted;
  end if;
end;
$$;

alter table public.job_queue
  alter column workspace_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_workspace_id_fkey'
  ) then
    alter table public.job_queue
      add constraint job_queue_workspace_id_fkey
      foreign key (workspace_id)
      references public.workspaces (id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_attempt_bounds_check'
  ) then
    alter table public.job_queue
      add constraint job_queue_attempt_bounds_check
      check (
        max_attempts between 1 and 25
        and attempts between 0 and max_attempts
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_workspace_payload_check'
  ) then
    alter table public.job_queue
      add constraint job_queue_workspace_payload_check
      check (
        coalesce(payload ->> 'workspaceId', '') = workspace_id::text
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_lease_pair_check'
  ) then
    alter table public.job_queue
      add constraint job_queue_lease_pair_check
      check (
        (lease_token is null and lease_expires_at is null)
        or (lease_token is not null and lease_expires_at is not null)
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_queue'::regclass
      and conname = 'job_queue_settled_lease_check'
  ) then
    alter table public.job_queue
      add constraint job_queue_settled_lease_check
      check (
        status = 'processing'
        or (lease_token is null and lease_expires_at is null)
      ) not valid;
  end if;
end;
$$;

alter table public.job_queue
  validate constraint job_queue_attempt_bounds_check;
alter table public.job_queue
  validate constraint job_queue_workspace_payload_check;
alter table public.job_queue
  validate constraint job_queue_lease_pair_check;
alter table public.job_queue
  validate constraint job_queue_settled_lease_check;

drop index if exists public.job_queue_dedupe_idx;
create unique index job_queue_workspace_dedupe_idx
  on public.job_queue (workspace_id, kind, dedupe_key)
  where status in ('pending', 'processing') and dedupe_key is not null;

create index if not exists job_queue_workspace_claim_idx
  on public.job_queue (workspace_id, run_after, created_at)
  where status = 'pending';

create index if not exists job_queue_lease_expiry_idx
  on public.job_queue (lease_expires_at)
  where status = 'processing' and lease_token is not null;

-- Workspace-explicit producer RPC. Payload identity cannot disagree with its
-- authoritative argument, and stored payloads always contain workspaceId so
-- rolling workers can continue reading their established payload shape.
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

  return v_id;
end;
$$;

-- Producers may withdraw delayed recovery work only before it is claimed.
-- Processing jobs remain exclusively owned by the worker lease contract.
create or replace function public.cancel_job_v2(
  p_workspace_id uuid,
  p_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with cancelled as (
    update public.job_queue as j
    set
      status = 'completed',
      claimed_at = null,
      completed_at = now(),
      last_error = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where j.workspace_id = p_workspace_id
      and j.id = p_id
      and j.status = 'pending'
    returning 1
  )
  select exists(select 1 from cancelled);
$$;

-- Temporary producer compatibility overload. It remains safe because it can
-- only resolve workspace identity through an existing workspace row, then
-- delegates to the explicit RPC above.
create or replace function public.enqueue_job(
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
  v_workspace_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
     or nullif(p_payload ->> 'workspaceId', '') is null then
    raise exception 'enqueue_job legacy overload requires payload.workspaceId'
      using errcode = '22023';
  end if;

  select w.id
  into v_workspace_id
  from public.workspaces as w
  where w.id::text = p_payload ->> 'workspaceId';

  if not found then
    raise exception 'enqueue_job payload.workspaceId is not a valid workspace'
      using errcode = '23503';
  end if;

  return public.enqueue_job_v2(
    p_workspace_id => v_workspace_id,
    p_kind => p_kind,
    p_payload => p_payload,
    p_max_attempts => p_max_attempts,
    p_run_after => p_run_after,
    p_dedupe_key => p_dedupe_key
  );
end;
$$;

-- Temporary legacy claim for a rolling worker deployment. A legacy claim has
-- no token; legacy settlement below is restricted to tokenless processing
-- rows, so it cannot settle a v2 worker's lease.
create or replace function public.claim_job(
  p_kind text default null
)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  attempts int,
  max_attempts int
)
language sql
security definer
set search_path = ''
as $$
  update public.job_queue as j
  set
    status = 'processing',
    claimed_at = now(),
    attempts = j.attempts + 1,
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where j.id = (
    select q.id
    from public.job_queue as q
    where q.status = 'pending'
      and q.run_after <= now()
      and q.attempts < q.max_attempts
      and (p_kind is null or q.kind = p_kind)
    order by q.run_after asc, q.created_at asc
    for update skip locked
    limit 1
  )
  returning j.id, j.kind, j.payload, j.attempts, j.max_attempts;
$$;

create or replace function public.claim_job_v2(
  p_kind text,
  p_lease_seconds integer
)
returns table (
  id uuid,
  workspace_id uuid,
  kind text,
  payload jsonb,
  attempts integer,
  max_attempts integer,
  lease_token uuid
)
language sql
security definer
set search_path = ''
as $$
  update public.job_queue as j
  set
    status = 'processing',
    claimed_at = now(),
    attempts = j.attempts + 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(
      secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))
    ),
    updated_at = now()
  where j.id = (
    select q.id
    from public.job_queue as q
    where q.status = 'pending'
      and q.run_after <= now()
      and q.attempts < q.max_attempts
      and (p_kind is null or q.kind = p_kind)
    order by q.run_after asc, q.created_at asc
    for update skip locked
    limit 1
  )
  returning
    j.id,
    j.workspace_id,
    j.kind,
    j.payload,
    j.attempts,
    j.max_attempts,
    j.lease_token;
$$;

create or replace function public.heartbeat_job(
  p_workspace_id uuid,
  p_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with touched as (
    update public.job_queue as j
    set
      lease_expires_at = now() + make_interval(
        secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))
      ),
      updated_at = now()
    where j.workspace_id = p_workspace_id
      and j.id = p_id
      and j.lease_token = p_lease_token
      and j.status = 'processing'
      and j.lease_expires_at > now()
    returning 1
  )
  select exists(select 1 from touched);
$$;

create or replace function public.complete_job_v2(
  p_workspace_id uuid,
  p_id uuid,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with settled as (
    update public.job_queue as j
    set
      status = 'completed',
      claimed_at = null,
      completed_at = now(),
      last_error = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where j.workspace_id = p_workspace_id
      and j.id = p_id
      and j.lease_token = p_lease_token
      and j.status = 'processing'
      and j.lease_expires_at > now()
    returning 1
  )
  select exists(select 1 from settled);
$$;

create or replace function public.fail_job_v2(
  p_workspace_id uuid,
  p_id uuid,
  p_lease_token uuid,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_queue%rowtype;
  v_backoff interval;
begin
  select q.*
  into v_job
  from public.job_queue as q
  where q.workspace_id = p_workspace_id
    and q.id = p_id
    and q.lease_token = p_lease_token
    and q.status = 'processing'
    and q.lease_expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  if v_job.attempts >= v_job.max_attempts then
    update public.job_queue as q
    set
      status = 'failed',
      claimed_at = null,
      last_error = p_error,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where q.workspace_id = p_workspace_id
      and q.id = p_id
      and q.lease_token = p_lease_token
      and q.status = 'processing';

    if v_job.kind = 'publish.meta.execute' then
      update public.meta_publish_plans as p
      set
        status = case
          when p.status = 'approved' then 'failed'
          else p.status
        end,
        last_error = p_error,
        updated_at = now()
      where p.workspace_id = p_workspace_id
        and p.id::text = nullif(v_job.payload ->> 'planId', '')
        and p.status in ('approved', 'publishing');
    end if;

    return 'failed';
  end if;

  v_backoff := least(
    power(2, v_job.attempts) * interval '1 second',
    interval '10 minutes'
  );

  update public.job_queue as q
  set
    status = 'pending',
    claimed_at = null,
    last_error = p_error,
    run_after = now() + v_backoff,
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where q.workspace_id = p_workspace_id
    and q.id = p_id
    and q.lease_token = p_lease_token
    and q.status = 'processing';

  return 'pending';
end;
$$;

-- Temporary legacy completion/failure functions. They can settle only a job
-- claimed by claim_job (tokenless), never a v2 lease.
create or replace function public.complete_job(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_queue as q
  set
    status = 'completed',
    claimed_at = null,
    completed_at = now(),
    last_error = null,
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where q.id = p_id
    and q.status = 'processing'
    and q.lease_token is null;
$$;

create or replace function public.fail_job(p_id uuid, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_queue%rowtype;
  v_backoff interval;
begin
  select q.*
  into v_job
  from public.job_queue as q
  where q.id = p_id
    and q.status = 'processing'
    and q.lease_token is null
  for update;

  if not found then
    return 'missing';
  end if;

  if v_job.attempts >= v_job.max_attempts then
    update public.job_queue as q
    set
      status = 'failed',
      claimed_at = null,
      last_error = p_error,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where q.id = p_id
      and q.status = 'processing'
      and q.lease_token is null;

    if v_job.kind = 'publish.meta.execute' then
      update public.meta_publish_plans as p
      set
        status = case
          when p.status = 'approved' then 'failed'
          else p.status
        end,
        last_error = p_error,
        updated_at = now()
      where p.workspace_id = v_job.workspace_id
        and p.id::text = nullif(v_job.payload ->> 'planId', '')
        and p.status in ('approved', 'publishing');
    end if;

    return 'failed';
  end if;

  v_backoff := least(
    power(2, v_job.attempts) * interval '1 second',
    interval '10 minutes'
  );

  update public.job_queue as q
  set
    status = 'pending',
    claimed_at = null,
    last_error = p_error,
    run_after = now() + v_backoff,
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where q.id = p_id
    and q.status = 'processing'
    and q.lease_token is null;

  return 'retrying';
end;
$$;

-- Reap both v2 expired leases and tokenless rolling-worker claims. Attempts at
-- the cap become terminal instead of being requeued forever.
create or replace function public.reap_stale_jobs(
  p_lease_seconds int default 600
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.job_queue%rowtype;
  v_count int := 0;
  v_backoff interval;
  v_error text;
begin
  for v_job in
    select q.*
    from public.job_queue as q
    where (
        q.status = 'pending'
        and q.attempts >= q.max_attempts
      )
      or (
        q.status = 'processing'
        and (
        (
          q.lease_token is not null
          and q.lease_expires_at <= now()
        )
        or (
          q.lease_token is null
          and q.claimed_at < now() - make_interval(
            secs => greatest(30, least(coalesce(p_lease_seconds, 600), 3600))
          )
        )
      )
      )
    order by q.claimed_at asc, q.created_at asc
    for update skip locked
  loop
    v_count := v_count + 1;
    v_error := coalesce(
      nullif(v_job.last_error, ''),
      case
        when v_job.status = 'pending' then 'Job retry budget was exhausted before it could be claimed.'
        else 'Job lease expired before settlement.'
      end
    );

    if v_job.attempts >= v_job.max_attempts then
      update public.job_queue as q
      set
        status = 'failed',
        claimed_at = null,
        last_error = v_error,
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
      where q.workspace_id = v_job.workspace_id
        and q.id = v_job.id
        and q.status in ('pending', 'processing');

      if v_job.kind = 'publish.meta.execute' then
        update public.meta_publish_plans as p
        set
          status = case
            when p.status = 'approved' then 'failed'
            else p.status
          end,
          last_error = v_error,
          updated_at = now()
        where p.workspace_id = v_job.workspace_id
          and p.id::text = nullif(v_job.payload ->> 'planId', '')
          and p.status in ('approved', 'publishing');
      end if;
    else
      v_backoff := least(
        power(2, v_job.attempts) * interval '1 second',
        interval '10 minutes'
      );

      update public.job_queue as q
      set
        status = 'pending',
        claimed_at = null,
        last_error = v_error,
        run_after = now() + v_backoff,
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
      where q.workspace_id = v_job.workspace_id
        and q.id = v_job.id
        and q.status = 'processing';
    end if;
  end loop;

  return v_count;
end;
$$;

-- Repair the known masking failure without rewriting unrelated provider
-- failures: only the watchdog's legacy generic terminal message is replaced,
-- using the newest terminal job error in the same workspace and plan.
do $$
declare
  v_repaired int;
begin
  with latest_terminal_publish as (
    select distinct on (q.workspace_id, q.payload ->> 'planId')
      q.workspace_id,
      q.payload ->> 'planId' as plan_id,
      q.last_error
    from public.job_queue as q
    where q.kind = 'publish.meta.execute'
      and q.status = 'failed'
      and q.attempts >= q.max_attempts
      and nullif(q.payload ->> 'planId', '') is not null
      and nullif(q.last_error, '') is not null
    order by
      q.workspace_id,
      q.payload ->> 'planId',
      q.updated_at desc,
      q.created_at desc,
      q.id desc
  ), repaired as (
    update public.meta_publish_plans as p
    set
      last_error = t.last_error,
      updated_at = now()
    from latest_terminal_publish as t
    where p.workspace_id = t.workspace_id
      and p.id::text = t.plan_id
      and p.status = 'failed'
      and p.last_error like
        'Publish did not complete after % automatic recovery attempts. Open Ad Studio and publish again.'
    returning p.id
  )
  select count(*)::int into v_repaired from repaired;

  raise notice 'restored exact terminal queue errors on % publish plans',
    v_repaired;
end;
$$;

revoke execute on function public.enqueue_job_v2(
  uuid, text, jsonb, int, timestamptz, text
) from public, anon, authenticated;
revoke execute on function public.cancel_job_v2(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.enqueue_job(
  text, jsonb, int, timestamptz, text
) from public, anon, authenticated;
revoke execute on function public.claim_job(text)
  from public, anon, authenticated;
revoke execute on function public.claim_job_v2(text, integer)
  from public, anon, authenticated;
revoke execute on function public.heartbeat_job(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_job_v2(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.fail_job_v2(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.complete_job(uuid)
  from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.reap_stale_jobs(int)
  from public, anon, authenticated;

grant execute on function public.enqueue_job_v2(
  uuid, text, jsonb, int, timestamptz, text
) to service_role;
grant execute on function public.cancel_job_v2(uuid, uuid)
  to service_role;
grant execute on function public.enqueue_job(
  text, jsonb, int, timestamptz, text
) to service_role;
grant execute on function public.claim_job(text) to service_role;
grant execute on function public.claim_job_v2(text, integer) to service_role;
grant execute on function public.heartbeat_job(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_job_v2(uuid, uuid, uuid)
  to service_role;
grant execute on function public.fail_job_v2(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.complete_job(uuid) to service_role;
grant execute on function public.fail_job(uuid, text) to service_role;
grant execute on function public.reap_stale_jobs(int) to service_role;

revoke all on public.job_queue from public, anon, authenticated;
grant select, insert, update, delete on public.job_queue to service_role;
alter table public.job_queue enable row level security;
alter table public.job_queue force row level security;

comment on column public.job_queue.workspace_id is
  'Authoritative tenant fence for queue claim, heartbeat, and settlement.';
comment on column public.job_queue.lease_token is
  'Single-claim ownership token required by v2 heartbeat and settlement RPCs.';

commit;
