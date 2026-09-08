-- Durable exactly-once credit accounting for paid Ad DB provider requests.
alter table research.provider_credit_budgets
  add column if not exists provider_balance_remaining numeric(12,4),
  add column if not exists provider_balance_verified_at timestamptz,
  add column if not exists provider_balance_accounted_spent_credits numeric(12,4);

create table if not exists research.provider_credit_attempts (
  attempt_id uuid primary key,
  provider text not null,
  run_id uuid not null,
  budget_id uuid not null references research.provider_credit_budgets(id),
  reserved_credits numeric(12,4) not null check (reserved_credits > 0),
  run_credit_cap numeric(12,4) not null check (run_credit_cap > 0),
  provider_balance_remaining_at_reserve numeric(12,4) not null check (provider_balance_remaining_at_reserve >= 0),
  provider_balance_verified_at timestamptz not null,
  status text not null default 'reserved' check (status in ('reserved','settled')),
  outcome text,
  charge_known boolean,
  actual_credits numeric(12,4) check (actual_credits >= 0),
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint provider_credit_attempts_settlement_shape check (
    (status='reserved' and outcome is null and charge_known is null and actual_credits is null and settled_at is null)
    or (status='settled' and outcome is not null and charge_known is not null and actual_credits is not null and settled_at is not null)
  )
);
create index if not exists provider_credit_attempts_run_idx on research.provider_credit_attempts(provider,run_id);
create index if not exists provider_credit_attempts_unsettled_idx on research.provider_credit_attempts(provider,reserved_at) where status='reserved';
alter table research.provider_credit_attempts enable row level security;
revoke all on table research.provider_credit_attempts from public,anon,authenticated;
grant select,insert,update on table research.provider_credit_attempts to service_role;

alter table research.ad_fetch_attempts
  add column if not exists provider_credit_attempt_id uuid unique references research.provider_credit_attempts(attempt_id);

comment on table research.provider_credit_attempts is
  'One durable reservation per provider request. Paid failures consume actual credits; unknown charges consume the full hold.';
comment on column research.provider_credit_budgets.provider_balance_verified_at is
  'When the provider account remaining balance was authenticated by its usage API.';

create or replace function research.reserve_provider_attempt_credits(
  p_attempt_id uuid, p_provider text, p_run_id uuid, p_reserved_credits numeric,
  p_run_credit_cap numeric, p_provider_balance_remaining numeric,
  p_provider_balance_verified_at timestamptz
) returns jsonb language plpgsql security definer set search_path=research,pg_temp as $$
declare
  v_provider text:=lower(trim(p_provider));
  v_budget research.provider_credit_budgets%rowtype;
  v_attempt research.provider_credit_attempts%rowtype;
  v_run_committed numeric:=0;
  v_account_committed numeric:=0;
begin
  if p_attempt_id is null or p_run_id is null or v_provider='' then raise exception 'provider_credit_invalid_identity'; end if;
  if p_reserved_credits is null or p_reserved_credits<=0 or p_run_credit_cap is null
     or p_run_credit_cap<=0 or p_reserved_credits>p_run_credit_cap then
    raise exception 'provider_credit_invalid_reservation';
  end if;
  select * into v_budget from research.provider_credit_budgets
  where provider=v_provider order by period_start desc limit 1 for update;
  if not found then raise exception 'credit_budget_missing: provider %',v_provider; end if;

  select * into v_attempt from research.provider_credit_attempts where attempt_id=p_attempt_id for update;
  if found then
    if v_attempt.provider is distinct from v_provider or v_attempt.run_id is distinct from p_run_id
       or v_attempt.budget_id is distinct from v_budget.id
       or v_attempt.reserved_credits is distinct from p_reserved_credits
       or v_attempt.run_credit_cap is distinct from p_run_credit_cap
       or v_attempt.provider_balance_remaining_at_reserve is distinct from p_provider_balance_remaining
       or v_attempt.provider_balance_verified_at is distinct from p_provider_balance_verified_at then
      raise exception 'provider_credit_attempt_conflict: %',p_attempt_id;
    end if;
    return jsonb_build_object('attempt_id',v_attempt.attempt_id,'budget_id',v_attempt.budget_id,
      'status',v_attempt.status,'reserved_credits',v_attempt.reserved_credits,
      'provider_balance_verified_at',v_attempt.provider_balance_verified_at,'idempotent',true);
  end if;
  if p_provider_balance_remaining is null or p_provider_balance_remaining<0
     or p_provider_balance_verified_at is null
     or p_provider_balance_verified_at<clock_timestamp()-interval '15 minutes'
     or p_provider_balance_verified_at>clock_timestamp()+interval '1 minute' then
    raise exception 'provider_credit_balance_not_fresh';
  end if;


  if exists(select 1 from research.provider_credit_attempts a where a.provider=v_provider
    and a.run_id=p_run_id and a.run_credit_cap is distinct from p_run_credit_cap) then
    raise exception 'provider_credit_run_cap_conflict: %',p_run_id;
  end if;

  if v_budget.provider_balance_verified_at is null
     or p_provider_balance_verified_at>v_budget.provider_balance_verified_at then
    update research.provider_credit_budgets set
      provider_balance_remaining=p_provider_balance_remaining,
      provider_balance_verified_at=p_provider_balance_verified_at,
      provider_balance_accounted_spent_credits=spent_credits,updated_at=now()
    where id=v_budget.id returning * into v_budget;
  elsif p_provider_balance_verified_at<v_budget.provider_balance_verified_at then
    raise exception 'provider_credit_balance_stale';
  elsif p_provider_balance_remaining is distinct from v_budget.provider_balance_remaining then
    raise exception 'provider_credit_balance_conflict';
  end if;

  select coalesce(sum(case when status='settled' then actual_credits else reserved_credits end),0)
  into v_run_committed from research.provider_credit_attempts where provider=v_provider and run_id=p_run_id;
  v_account_committed:=v_budget.reserved_credits+
    greatest(0,v_budget.spent_credits-coalesce(v_budget.provider_balance_accounted_spent_credits,v_budget.spent_credits));

  if v_budget.spent_credits+v_budget.reserved_credits+p_reserved_credits>v_budget.max_credits then
    raise exception 'credit_budget_exhausted: provider % cannot reserve % credits',v_provider,p_reserved_credits;
  end if;
  if v_run_committed+p_reserved_credits>p_run_credit_cap then
    raise exception 'provider_credit_run_cap_exhausted: run %',p_run_id;
  end if;
  if v_account_committed+p_reserved_credits>v_budget.provider_balance_remaining then
    raise exception 'provider_credit_account_balance_exhausted: provider %',v_provider;
  end if;

  insert into research.provider_credit_attempts(attempt_id,provider,run_id,budget_id,reserved_credits,
    run_credit_cap,provider_balance_remaining_at_reserve,provider_balance_verified_at)
  values(p_attempt_id,v_provider,p_run_id,v_budget.id,p_reserved_credits,p_run_credit_cap,
    p_provider_balance_remaining,p_provider_balance_verified_at) returning * into v_attempt;
  update research.provider_credit_budgets set reserved_credits=reserved_credits+p_reserved_credits,updated_at=now()
  where id=v_budget.id;

  return jsonb_build_object('attempt_id',v_attempt.attempt_id,'budget_id',v_attempt.budget_id,
    'status',v_attempt.status,'reserved_credits',v_attempt.reserved_credits,
    'provider_balance_verified_at',v_attempt.provider_balance_verified_at,
    'account_available_after',v_budget.provider_balance_remaining-v_account_committed-p_reserved_credits,
    'run_available_after',p_run_credit_cap-v_run_committed-p_reserved_credits,'idempotent',false);
end $$;

create or replace function research.settle_provider_attempt_credits(
  p_attempt_id uuid,p_outcome text,p_charge_known boolean,p_actual_credits numeric default null
) returns jsonb language plpgsql security definer set search_path=research,pg_temp as $$
declare
  v_attempt research.provider_credit_attempts%rowtype;
  v_budget research.provider_credit_budgets%rowtype;
  v_charge numeric;
begin
  if p_attempt_id is null or nullif(trim(p_outcome),'') is null or length(p_outcome)>80 or p_charge_known is null then
    raise exception 'provider_credit_invalid_settlement';
  end if;
  select * into v_attempt from research.provider_credit_attempts where attempt_id=p_attempt_id;
  if not found then raise exception 'provider_credit_attempt_missing: %',p_attempt_id; end if;
  select * into v_budget from research.provider_credit_budgets where id=v_attempt.budget_id for update;
  select * into v_attempt from research.provider_credit_attempts where attempt_id=p_attempt_id for update;

  if p_charge_known then
    if p_actual_credits is null or p_actual_credits<0 then raise exception 'provider_credit_known_charge_requires_actual'; end if;
    v_charge:=p_actual_credits;
  else
    if p_actual_credits is not null then raise exception 'provider_credit_unknown_charge_rejects_actual'; end if;
    v_charge:=v_attempt.reserved_credits;
  end if;

  if v_attempt.status='settled' then
    if v_attempt.outcome is distinct from trim(p_outcome) or v_attempt.charge_known is distinct from p_charge_known
       or v_attempt.actual_credits is distinct from v_charge then
      raise exception 'provider_credit_settlement_conflict: %',p_attempt_id;
    end if;
    return jsonb_build_object('attempt_id',v_attempt.attempt_id,'status',v_attempt.status,'outcome',v_attempt.outcome,
      'actual_credits',v_attempt.actual_credits,'charge_known',v_attempt.charge_known,'idempotent',true);
  end if;
  if v_budget.reserved_credits<v_attempt.reserved_credits then
    raise exception 'provider_credit_reservation_corrupt: %',p_attempt_id;
  end if;

  update research.provider_credit_attempts set status='settled',outcome=trim(p_outcome),
    charge_known=p_charge_known,actual_credits=v_charge,settled_at=now()
  where attempt_id=p_attempt_id returning * into v_attempt;
  update research.provider_credit_budgets set reserved_credits=reserved_credits-v_attempt.reserved_credits,
    spent_credits=spent_credits+v_charge,updated_at=now() where id=v_attempt.budget_id;
  return jsonb_build_object('attempt_id',v_attempt.attempt_id,'status',v_attempt.status,'outcome',v_attempt.outcome,
    'actual_credits',v_attempt.actual_credits,'charge_known',v_attempt.charge_known,'idempotent',false);
end $$;

revoke all on function research.reserve_provider_attempt_credits(uuid,text,uuid,numeric,numeric,numeric,timestamptz) from public,anon,authenticated;
revoke all on function research.settle_provider_attempt_credits(uuid,text,boolean,numeric) from public,anon,authenticated;
grant execute on function research.reserve_provider_attempt_credits(uuid,text,uuid,numeric,numeric,numeric,timestamptz) to service_role;
grant execute on function research.settle_provider_attempt_credits(uuid,text,boolean,numeric) to service_role;
notify pgrst,'reload schema';
