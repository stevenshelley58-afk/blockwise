-- Keep queue failure settlement aligned with the PAUSED-first publish state
-- machine introduced in 20260811130000. A queued plan becomes failed only
-- after its retry budget is exhausted. fail_job_v2 preserves a publishing
-- plan because its provider result is ambiguous; the stale-job reaper closes
-- an abandoned publishing lease explicitly.
do $$
begin
  if to_regprocedure('public.fail_job_v2(uuid,uuid,uuid,text)') is null
    or to_regprocedure('public.reap_stale_jobs(integer)') is null
  then
    raise exception 'Expected queue settlement functions before Meta state repair';
  end if;

  if not exists (
    select 1
    from pg_proc as p
    where p.oid in (
      'public.fail_job_v2(uuid,uuid,uuid,text)'::regprocedure,
      'public.reap_stale_jobs(integer)'::regprocedure
    )
      and p.prosecdef
    group by p.prosecdef
    having count(*) = 2
  ) then
    raise exception 'Queue settlement functions must remain security definer';
  end if;
end $$;

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
          when p.status = 'queued' then 'failed'
          else p.status
        end,
        last_error = p_error,
        updated_at = now()
      where p.workspace_id = p_workspace_id
        and p.id::text = nullif(v_job.payload ->> 'planId', '')
        and p.status in ('queued', 'publishing');
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
          and p.status in ('queued', 'publishing');
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

revoke all on function public.fail_job_v2(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.reap_stale_jobs(int)
  from public, anon, authenticated;
grant execute on function public.fail_job_v2(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.reap_stale_jobs(int) to service_role;
