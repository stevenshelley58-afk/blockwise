-- Launch hardening: bind shared Meta assets to one workspace, close exposed
-- trigger/helper functions, prioritize customer jobs, and make terminal queue
-- failures repair their owning business records.

create table if not exists public.meta_partner_account_assignments (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  ad_account_id text not null unique check (ad_account_id ~ '^act_[0-9]+$'),
  ad_account_name text not null,
  page_id text not null check (page_id ~ '^[0-9]+$'),
  page_name text not null,
  currency text not null default 'AUD',
  timezone text not null default 'Australia/Sydney',
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_partner_account_assignments enable row level security;
revoke all on table public.meta_partner_account_assignments from public, anon, authenticated;
grant all on table public.meta_partner_account_assignments to service_role;

comment on table public.meta_partner_account_assignments is
  'Operator-verified one-workspace ownership binding for Meta assets shared with the Blockwise Business Manager.';

revoke execute on function public.is_operator() from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_operator() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
revoke execute on function public.set_property_checks_updated_at() from public, anon, authenticated;

-- Customer-facing provider work must not sit behind periodic read-model jobs.
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
    order by
      case q.kind
        when 'publish.meta.execute' then 0
        when 'publish.meta.mutate' then 0
        when 'adstudio.generate.template' then 1
        when 'deliver.lead' then 2
        when 'sync.meta.leads' then 3
        when 'reporting.refresh' then 4
        else 5
      end,
      q.run_after asc,
      q.created_at asc
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

revoke all on function public.claim_job_v2(text, integer) from public, anon, authenticated;
grant execute on function public.claim_job_v2(text, integer) to service_role;

create index if not exists job_queue_customer_priority_claim_idx
  on public.job_queue (
    (case kind
      when 'publish.meta.execute' then 0
      when 'publish.meta.mutate' then 0
      when 'adstudio.generate.template' then 1
      when 'deliver.lead' then 2
      when 'sync.meta.leads' then 3
      when 'reporting.refresh' then 4
      else 5
    end),
    run_after,
    created_at
  )
  where status = 'pending' and attempts < max_attempts;

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
  v_creative_job public.adstudio_creative_jobs%rowtype;
  v_reservation jsonb;
  v_count int := 0;
  v_backoff interval;
  v_error text;
  v_outstanding int;
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
          (q.lease_token is not null and q.lease_expires_at <= now())
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
      set status = 'failed', claimed_at = null, last_error = v_error,
          lease_token = null, lease_expires_at = null, updated_at = now()
      where q.workspace_id = v_job.workspace_id
        and q.id = v_job.id
        and q.status in ('pending', 'processing');

      if v_job.kind = 'publish.meta.execute' then
        update public.meta_publish_plans as p
        set status = 'failed', last_error = v_error, updated_at = now()
        where p.workspace_id = v_job.workspace_id
          and p.id::text = nullif(v_job.payload ->> 'planId', '')
          and p.status in ('approved', 'publishing');
      elsif v_job.kind = 'adstudio.generate.template' then
        select c.* into v_creative_job
        from public.adstudio_creative_jobs as c
        where c.workspace_id = v_job.workspace_id
          and c.id::text = nullif(v_job.payload ->> 'creativeJobId', '')
        for update;

        if found and v_creative_job.status not in ('done', 'failed') then
          v_reservation := v_creative_job.payload -> 'reservation';
          v_outstanding := coalesce((v_reservation ->> 'creditsOutstanding')::int, 0);
          if v_outstanding > 0 then
            perform public.refund_workspace_credit_reservation(
              v_job.workspace_id,
              (v_reservation ->> 'reservationId')::uuid,
              v_outstanding,
              coalesce(nullif(v_reservation ->> 'mutationKey', ''), v_creative_job.id::text)
                || ':refund:vps-recovery-failure',
              'generation_vps_recovery_failed',
              jsonb_build_object('queueJobId', v_job.id, 'reaped', true)
            );
          end if;

          update public.adstudio_creative_jobs
          set status = 'failed', error = v_error, updated_at = now()
          where workspace_id = v_job.workspace_id and id = v_creative_job.id;
        end if;
      end if;
    else
      v_backoff := least(power(2, v_job.attempts) * interval '1 second', interval '10 minutes');
      update public.job_queue as q
      set status = 'pending', claimed_at = null, last_error = v_error,
          run_after = now() + v_backoff, lease_token = null,
          lease_expires_at = null, updated_at = now()
      where q.workspace_id = v_job.workspace_id
        and q.id = v_job.id
        and q.status = 'processing';
    end if;
  end loop;

  return v_count;
end;
$$;

-- Repair abandoned creative rows from the old inline-only path. An active
-- recovery queue row wins; only work abandoned for a full day is closed.
do $$
declare
  v_creative public.adstudio_creative_jobs%rowtype;
  v_reservation jsonb;
  v_outstanding int;
  v_repaired bigint := 0;
begin
  for v_creative in
    select c.*
    from public.adstudio_creative_jobs as c
    where c.status in ('queued', 'running')
      and c.updated_at < now() - interval '24 hours'
      and not exists (
        select 1
        from public.job_queue as q
        where q.workspace_id = c.workspace_id
          and q.kind = 'adstudio.generate.template'
          and q.payload ->> 'creativeJobId' = c.id::text
          and q.status in ('pending', 'processing')
      )
    for update skip locked
  loop
    v_reservation := coalesce(v_creative.payload -> 'reservation', '{}'::jsonb);
    v_outstanding := case
      when coalesce(v_reservation ->> 'creditsOutstanding', '') ~ '^[0-9]+$'
        then (v_reservation ->> 'creditsOutstanding')::int
      else 0
    end;
    if v_outstanding > 0
      and coalesce(v_reservation ->> 'reservationId', '')
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      perform public.refund_workspace_credit_reservation(
        v_creative.workspace_id,
        (v_reservation ->> 'reservationId')::uuid,
        v_outstanding,
        coalesce(nullif(v_reservation ->> 'mutationKey', ''), v_creative.id::text)
          || ':refund:prelaunch-stale-repair',
        'generation_stale_repair',
        jsonb_build_object('creativeJobId', v_creative.id, 'migrationRepair', true)
      );
    end if;

    update public.adstudio_creative_jobs
    set status = 'failed',
        error = 'Generation was abandoned before launch hardening. Your reserved credits were released where applicable; create the ad again.',
        updated_at = now()
    where workspace_id = v_creative.workspace_id and id = v_creative.id;
    v_repaired := v_repaired + 1;
  end loop;

  raise notice 'Repaired % abandoned AdStudio creative job(s).', v_repaired;
end;
$$;

revoke all on function public.reap_stale_jobs(int) from public, anon, authenticated;
grant execute on function public.reap_stale_jobs(int) to service_role;

-- Repair only rows whose queue owner has already exhausted its retry budget.
do $$
declare
  v_plan_count bigint;
begin
  select count(*) into v_plan_count
  from public.meta_publish_plans as p
  where p.status in ('approved', 'publishing')
    and exists (
      select 1 from public.job_queue as q
      where q.workspace_id = p.workspace_id
        and q.kind = 'publish.meta.execute'
        and q.payload ->> 'planId' = p.id::text
        and q.status = 'failed'
        and q.attempts >= q.max_attempts
    );
  raise notice 'Repairing % terminal Meta publish plan(s).', v_plan_count;

  update public.meta_publish_plans as p
  set status = 'failed',
      last_error = coalesce((
        select q.last_error from public.job_queue as q
        where q.workspace_id = p.workspace_id
          and q.kind = 'publish.meta.execute'
          and q.payload ->> 'planId' = p.id::text
          and q.status = 'failed'
        order by q.updated_at desc limit 1
      ), 'Publish retry budget was exhausted.'),
      updated_at = now()
  where p.status in ('approved', 'publishing')
    and exists (
      select 1 from public.job_queue as q
      where q.workspace_id = p.workspace_id
        and q.kind = 'publish.meta.execute'
        and q.payload ->> 'planId' = p.id::text
        and q.status = 'failed'
        and q.attempts >= q.max_attempts
    );
end;
$$;
