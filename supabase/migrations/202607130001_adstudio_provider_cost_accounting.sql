begin;

alter table public.ai_runs
  add column if not exists estimated_cost_usd numeric(14, 6),
  add column if not exists actual_cost_usd numeric(14, 6),
  add column if not exists billing_status text
    check (billing_status in ('actual', 'estimated', 'unbilled', 'unreconciled'));

alter table public.ai_usage_ledger
  add column if not exists estimated_cost_usd numeric(14, 6),
  add column if not exists actual_cost_usd numeric(14, 6),
  add column if not exists billing_status text
    check (billing_status in ('actual', 'estimated', 'unbilled', 'unreconciled'));

alter table public.adstudio_provider_runs
  add column if not exists mutation_id text,
  add column if not exists payload_hash text,
  add column if not exists model_profile_version_id uuid
    references public.model_profile_versions (id) on delete set null,
  add column if not exists pricing_snapshot_id uuid
    references public.model_profile_versions (id) on delete set null,
  add column if not exists estimated_cost_usd numeric(14, 6),
  add column if not exists actual_cost_usd numeric(14, 6),
  add column if not exists billing_status text
    check (billing_status in ('actual', 'estimated', 'unbilled', 'unreconciled'));

-- Legacy money fields are estimates only. Classify every historical row
-- deterministically without inventing provider-actual billing.
update public.adstudio_provider_runs
set estimated_cost_usd = case when cost_estimate > 0 then round(cost_estimate, 6) else 0 end,
    actual_cost_usd = null,
    billing_status = case
      when cost_estimate > 0 then 'estimated'
      when status = 'queued' or provider_name = 'deterministic_local' then 'unbilled'
      else 'unreconciled'
    end
where estimated_cost_usd is null or billing_status is null;

update public.ai_runs
set estimated_cost_usd = case when estimated_cost_cents > 0 then round(estimated_cost_cents::numeric / 100, 6) else 0 end,
    actual_cost_usd = null,
    billing_status = case
      when estimated_cost_cents > 0 then 'estimated'
      when status in ('queued', 'blocked') or provider = 'deterministic_local' then 'unbilled'
      else 'unreconciled'
    end
where estimated_cost_usd is null or billing_status is null;

update public.ai_usage_ledger
set estimated_cost_usd = case when estimated_cost_cents > 0 then round(estimated_cost_cents::numeric / 100, 6) else 0 end,
    actual_cost_usd = null,
    billing_status = case
      when estimated_cost_cents > 0 then 'estimated'
      when result = 'blocked' or provider = 'deterministic_local' then 'unbilled'
      else 'unreconciled'
    end
where estimated_cost_usd is null or billing_status is null;

-- Provider runs have the strongest provenance. Propagate their classified
-- estimates and worst-case reconciliation state to linked aggregate rows.
with provider_rollup as (
  select workspace_id, ai_run_id,
    round(sum(estimated_cost_usd), 6) as estimated_cost_usd,
    case
      when bool_or(billing_status = 'unreconciled') then 'unreconciled'
      when bool_or(billing_status = 'estimated') then 'estimated'
      else 'unbilled'
    end as billing_status
  from public.adstudio_provider_runs
  where ai_run_id is not null
  group by workspace_id, ai_run_id
)
update public.ai_runs run
set estimated_cost_usd = rollup.estimated_cost_usd,
    actual_cost_usd = null,
    billing_status = rollup.billing_status
from provider_rollup rollup
where run.workspace_id = rollup.workspace_id and run.id = rollup.ai_run_id;

with provider_rollup as (
  select workspace_id, ai_usage_ledger_id,
    round(sum(estimated_cost_usd), 6) as estimated_cost_usd,
    case
      when bool_or(billing_status = 'unreconciled') then 'unreconciled'
      when bool_or(billing_status = 'estimated') then 'estimated'
      else 'unbilled'
    end as billing_status
  from public.adstudio_provider_runs
  where ai_usage_ledger_id is not null
  group by workspace_id, ai_usage_ledger_id
)
update public.ai_usage_ledger ledger
set estimated_cost_usd = rollup.estimated_cost_usd,
    actual_cost_usd = null,
    billing_status = rollup.billing_status
from provider_rollup rollup
where ledger.workspace_id = rollup.workspace_id and ledger.id = rollup.ai_usage_ledger_id;

do $backfill_report$
declare
  provider_counts jsonb;
  run_counts jsonb;
  ledger_counts jsonb;
begin
  select coalesce(jsonb_object_agg(billing_status, row_count), '{}'::jsonb) into provider_counts
  from (select billing_status, count(*) row_count from public.adstudio_provider_runs group by billing_status) counts;
  select coalesce(jsonb_object_agg(billing_status, row_count), '{}'::jsonb) into run_counts
  from (select billing_status, count(*) row_count from public.ai_runs group by billing_status) counts;
  select coalesce(jsonb_object_agg(billing_status, row_count), '{}'::jsonb) into ledger_counts
  from (select billing_status, count(*) row_count from public.ai_usage_ledger group by billing_status) counts;
  raise notice 'AdStudio cost backfill classifications: provider_runs=%, ai_runs=%, ledger=%',
    provider_counts, run_counts, ledger_counts;
end;
$backfill_report$;

alter table public.ai_runs
  alter column estimated_cost_usd set default 0,
  alter column estimated_cost_usd set not null,
  alter column billing_status set default 'unreconciled',
  alter column billing_status set not null;
alter table public.ai_usage_ledger
  alter column estimated_cost_usd set default 0,
  alter column estimated_cost_usd set not null,
  alter column billing_status set default 'unreconciled',
  alter column billing_status set not null;
alter table public.adstudio_provider_runs
  alter column estimated_cost_usd set default 0,
  alter column estimated_cost_usd set not null,
  alter column billing_status set default 'unreconciled',
  alter column billing_status set not null;

alter table public.adstudio_provider_runs
  add constraint adstudio_provider_runs_workspace_id_id_unique unique (workspace_id, id),
  add constraint adstudio_provider_runs_workspace_mutation_unique unique (workspace_id, mutation_id);

-- Refuse to install workspace-composite lineage constraints over corrupt legacy
-- links. These checks are read-only and quantify every existing edge first.
do $check_lineage$
begin
  if exists (
    select 1 from public.ai_usage_ledger ledger
    join public.ai_runs run on run.id = ledger.ai_run_id
    where ledger.workspace_id <> run.workspace_id
  ) then
    raise exception 'Cannot install cost accounting: cross-workspace ai_usage_ledger -> ai_runs links exist';
  end if;
  if exists (
    select 1 from public.adstudio_provider_runs provider_run
    join public.ai_runs run on run.id = provider_run.ai_run_id
    where provider_run.workspace_id <> run.workspace_id
  ) then
    raise exception 'Cannot install cost accounting: cross-workspace provider_run -> ai_run links exist';
  end if;
  if exists (
    select 1 from public.adstudio_provider_runs provider_run
    join public.ai_usage_ledger ledger on ledger.id = provider_run.ai_usage_ledger_id
    where provider_run.workspace_id <> ledger.workspace_id
  ) then
    raise exception 'Cannot install cost accounting: cross-workspace provider_run -> ledger links exist';
  end if;
end;
$check_lineage$;

alter table public.ai_runs
  add constraint ai_runs_workspace_id_id_unique unique (workspace_id, id);
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_workspace_id_id_unique unique (workspace_id, id),
  add constraint ai_usage_ledger_workspace_ai_run_fk
    foreign key (workspace_id, ai_run_id) references public.ai_runs (workspace_id, id) on delete set null (ai_run_id);
alter table public.adstudio_provider_runs
  add constraint adstudio_provider_runs_workspace_ai_run_fk
    foreign key (workspace_id, ai_run_id) references public.ai_runs (workspace_id, id) on delete set null (ai_run_id),
  add constraint adstudio_provider_runs_workspace_ledger_fk
    foreign key (workspace_id, ai_usage_ledger_id)
    references public.ai_usage_ledger (workspace_id, id) on delete set null (ai_usage_ledger_id);

create table public.adstudio_provider_run_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider_run_id uuid not null,
  attempt_index integer not null check (attempt_index >= 0),
  provider_name text not null,
  provider_type text not null check (provider_type in ('text_generation', 'image_generation')),
  model_name text not null,
  model_profile text not null,
  model_profile_version_id uuid references public.model_profile_versions (id) on delete set null,
  pricing_snapshot_id uuid references public.model_profile_versions (id) on delete set null,
  status text not null check (status in ('completed', 'failed')),
  request_submitted boolean not null,
  billing_status text not null
    check (billing_status in ('actual', 'estimated', 'unbilled', 'unreconciled')),
  provider_request_id text,
  usage_json jsonb not null default '{}'::jsonb,
  pricing_json jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(14, 6) not null default 0,
  actual_cost_usd numeric(14, 6),
  error_summary text,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider_run_id, attempt_index),
  constraint adstudio_attempts_workspace_run_fk foreign key (workspace_id, provider_run_id)
    references public.adstudio_provider_runs (workspace_id, id) on delete cascade
);

-- This service-only outbox closes the crash window around paid dispatch. A row
-- must exist before the HTTP request; an unclosed row is explicitly reconcilable.
create table public.adstudio_provider_attempt_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mutation_id text not null,
  attempt_index integer not null check (attempt_index >= 0),
  payload_hash text not null,
  reservation_json jsonb not null,
  status text not null default 'reserved' check (status in ('reserved', 'submitted', 'cancelled', 'closed')),
  provider_run_id uuid,
  final_attempt_json jsonb,
  reserved_at timestamptz not null default now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  closed_at timestamptz,
  unique (workspace_id, mutation_id, attempt_index),
  constraint adstudio_outbox_workspace_run_fk foreign key (workspace_id, provider_run_id)
    references public.adstudio_provider_runs (workspace_id, id) on delete set null (provider_run_id)
);

create index adstudio_provider_run_attempts_workspace_created_idx
  on public.adstudio_provider_run_attempts (workspace_id, created_at desc);
create index adstudio_provider_run_attempts_provider_request_idx
  on public.adstudio_provider_run_attempts (provider_name, provider_request_id)
  where provider_request_id is not null;
create index adstudio_provider_attempt_outbox_reconciliation_idx
  on public.adstudio_provider_attempt_outbox (workspace_id, status, reserved_at)
  where status in ('reserved', 'submitted');

alter table public.adstudio_provider_run_attempts enable row level security;
alter table public.adstudio_provider_attempt_outbox enable row level security;

create policy adstudio_provider_run_attempts_workspace_select
  on public.adstudio_provider_run_attempts for select to authenticated
  using (private.adstudio_has_workspace_access(workspace_id));
create policy adstudio_provider_run_attempts_no_client_insert
  on public.adstudio_provider_run_attempts for insert to authenticated with check (false);
create policy adstudio_provider_run_attempts_no_client_update
  on public.adstudio_provider_run_attempts for update to authenticated using (false) with check (false);
create policy adstudio_provider_run_attempts_no_client_delete
  on public.adstudio_provider_run_attempts for delete to authenticated using (false);

revoke all on public.adstudio_provider_run_attempts from anon, authenticated;
revoke all on public.adstudio_provider_attempt_outbox from anon, authenticated;
grant select on public.adstudio_provider_run_attempts to authenticated;
grant all on public.adstudio_provider_run_attempts to service_role;
grant all on public.adstudio_provider_attempt_outbox to service_role;

create or replace function public.adstudio_reserve_provider_attempt(
  p_workspace_id uuid,
  p_mutation_id text,
  p_attempt_index integer,
  p_payload_hash text,
  p_reservation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  reservation_row public.adstudio_provider_attempt_outbox%rowtype;
begin
  if p_workspace_id is null or nullif(trim(p_mutation_id), '') is null
     or p_attempt_index < 0 or nullif(trim(p_payload_hash), '') is null
     or jsonb_typeof(p_reservation) is distinct from 'object'
     or nullif(trim(p_reservation->>'provider'), '') is null
     or p_reservation->>'provider_type' is null
     or p_reservation->>'provider_type' not in ('text_generation', 'image_generation')
     or nullif(trim(p_reservation->>'model'), '') is null
     or nullif(trim(p_reservation->>'model_profile'), '') is null
     or jsonb_typeof(p_reservation->'pricing') is distinct from 'object'
     or coalesce((p_reservation#>>'{pricing,inputUsdPerMillionTokens}')::numeric, -1) < 0
     or coalesce((p_reservation#>>'{pricing,outputUsdPerMillionTokens}')::numeric, -1) < 0
     or coalesce((p_reservation#>>'{pricing,imageUsdPerUnit}')::numeric, -1) < 0
     or (p_reservation#>>'{pricing,currency}') is distinct from 'USD' then
    raise exception 'Invalid provider attempt reservation';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Unknown workspace';
  end if;

  insert into public.adstudio_provider_attempt_outbox (
    workspace_id, mutation_id, attempt_index, payload_hash, reservation_json
  ) values (
    p_workspace_id, p_mutation_id, p_attempt_index, p_payload_hash, p_reservation
  )
  on conflict (workspace_id, mutation_id, attempt_index) do nothing
  returning * into reservation_row;

  if found then
    return jsonb_build_object('reservation_id', reservation_row.id, 'status', reservation_row.status, 'acquired', true);
  end if;

  select * into strict reservation_row
  from public.adstudio_provider_attempt_outbox
  where workspace_id = p_workspace_id
    and mutation_id = p_mutation_id
    and attempt_index = p_attempt_index;

  -- payload_hash is the idempotency guard: a reused mutation/attempt key must
  -- describe the exact same dispatched provider and runtime pricing snapshot.
  if reservation_row.payload_hash <> p_payload_hash then
    raise exception 'Provider attempt idempotency conflict';
  end if;

  return jsonb_build_object('reservation_id', reservation_row.id, 'status', reservation_row.status, 'acquired', false);
end;
$function$;

create or replace function public.adstudio_mark_provider_attempt_submitted(
  p_workspace_id uuid,
  p_mutation_id text,
  p_attempt_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.adstudio_provider_attempt_outbox
  set status = 'submitted', submitted_at = now()
  where workspace_id = p_workspace_id
    and mutation_id = p_mutation_id
    and attempt_index = p_attempt_index
    and status = 'reserved';
  if not found then
    raise exception 'Provider attempt is not exclusively reserved';
  end if;
  return jsonb_build_object('updated', true, 'status', 'submitted');
end;
$function$;

create or replace function public.adstudio_cancel_provider_attempt(
  p_workspace_id uuid,
  p_mutation_id text,
  p_attempt_index integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Provider attempt cancellation requires a reason';
  end if;
  update public.adstudio_provider_attempt_outbox
  set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_reason, 500)
  where workspace_id = p_workspace_id
    and mutation_id = p_mutation_id
    and attempt_index = p_attempt_index
    and status in ('reserved', 'submitted');
  if not found then
    raise exception 'Provider attempt cannot be cancelled from its current state';
  end if;
  return jsonb_build_object('updated', true, 'status', 'cancelled');
end;
$function$;

create or replace function public.adstudio_record_provider_run(
  p_workspace_id uuid,
  p_mutation_id text,
  p_payload_hash text,
  p_run jsonb,
  p_attempts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_run public.adstudio_provider_runs%rowtype;
  v_ai_run_id uuid;
  v_ledger_id uuid;
  v_provider_run_id uuid;
  v_attempts jsonb;
  attempt jsonb;
  attempt_count integer;
  reservation_count integer;
  matched_reservation_count integer;
  v_input_tokens bigint;
  v_output_tokens bigint;
  v_image_units numeric;
  v_estimated_cost numeric;
  v_actual_cost numeric;
  v_preferred_cost numeric;
  v_billing_status text;
  v_provider_name text;
  v_provider_type text;
  v_model_name text;
  v_model_profile text;
  v_model_profile_version_id uuid;
  v_pricing_snapshot_id uuid;
begin
  if p_workspace_id is null or nullif(trim(p_mutation_id), '') is null
     or nullif(trim(p_payload_hash), '') is null or jsonb_typeof(p_attempts) is distinct from 'array'
     or jsonb_typeof(p_run) is distinct from 'object'
     or nullif(trim(p_run->>'task_type'), '') is null
     or p_run->>'status' is null
     or p_run->>'status' not in ('completed', 'failed') then
    raise exception 'Invalid provider run payload';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    raise exception 'Unknown workspace';
  end if;

  -- Serialize the mutation before the read/insert sequence. Concurrent retries
  -- can therefore create only one ai_run/ledger/provider_run set.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_mutation_id, 0));

  select * into existing_run
  from public.adstudio_provider_runs
  where workspace_id = p_workspace_id and mutation_id = p_mutation_id;

  if found then
    -- payload_hash makes retries idempotent while rejecting mutation-key reuse.
    if existing_run.payload_hash <> p_payload_hash then
      raise exception 'Provider run idempotency conflict';
    end if;
    return jsonb_build_object(
      'provider_run_id', existing_run.id,
      'ai_run_id', existing_run.ai_run_id,
      'ai_usage_ledger_id', existing_run.ai_usage_ledger_id,
      'idempotent', true
    );
  end if;

  -- A process can die or lose the reservation response between durable state
  -- transitions. Materialize every orphan reservation conservatively so no
  -- paid dispatch disappears from the normalized attempt history.
  v_attempts := p_attempts || coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'attemptIndex', outbox.attempt_index,
        'provider', outbox.reservation_json->>'provider',
        'providerType', outbox.reservation_json->>'provider_type',
        'model', outbox.reservation_json->>'model',
        'modelProfile', outbox.reservation_json->>'model_profile',
        'modelProfileVersionId', outbox.reservation_json->'model_profile_version_id',
        'pricingSnapshotId', outbox.reservation_json->'pricing_snapshot_id',
        'status', 'failed',
        'requestSubmitted', outbox.status = 'submitted',
        'billingStatus', case when outbox.status = 'submitted' then 'unreconciled' else 'unbilled' end,
        'providerRequestId', null,
        'usage', jsonb_build_object(
          'inputTokens', 0, 'outputTokens', 0, 'imageUnits', 0, 'complete', false
        ),
        'pricing', outbox.reservation_json->'pricing',
        'estimatedCostUsd', 0,
        'actualCostUsd', null,
        'error', case
          when outbox.status = 'submitted' then 'Dispatch outcome requires reconciliation.'
          when outbox.status = 'cancelled' then coalesce(outbox.cancel_reason, 'Dispatch cancelled before provider submission.')
          else 'Reservation outcome requires reconciliation; provider request was not marked submitted.'
        end
      ) order by outbox.attempt_index
    )
    from public.adstudio_provider_attempt_outbox outbox
    where outbox.workspace_id = p_workspace_id
      and outbox.mutation_id = p_mutation_id
      and outbox.status <> 'closed'
      and not exists (
        select 1 from jsonb_array_elements(p_attempts) submitted
        where (submitted.value->>'attemptIndex')::integer = outbox.attempt_index
      )
  ), '[]'::jsonb);

  attempt_count := jsonb_array_length(v_attempts);
  if attempt_count <> (
    select count(distinct (item.value->>'attemptIndex')::integer)
    from jsonb_array_elements(v_attempts) item
  ) then
    raise exception 'Provider attempt indices must be unique';
  end if;

  select count(*)::integer into reservation_count
  from public.adstudio_provider_attempt_outbox
  where workspace_id = p_workspace_id and mutation_id = p_mutation_id;
  if reservation_count <> attempt_count then
    raise exception 'Provider attempt reservation mismatch: expected %, found %', attempt_count, reservation_count;
  end if;

  select count(*)::integer into matched_reservation_count
  from public.adstudio_provider_attempt_outbox outbox
  join lateral (
    select item.value as attempt
    from jsonb_array_elements(v_attempts) item
    where (item.value->>'attemptIndex')::integer = outbox.attempt_index
  ) submitted on true
  where outbox.workspace_id = p_workspace_id
    and outbox.mutation_id = p_mutation_id
    and (
      (outbox.status = 'submitted' and (submitted.attempt->>'requestSubmitted')::boolean is true)
      or (outbox.status in ('reserved', 'cancelled') and (submitted.attempt->>'requestSubmitted')::boolean is false)
    )
    and outbox.reservation_json->>'provider' = submitted.attempt->>'provider'
    and outbox.reservation_json->>'provider_type' = submitted.attempt->>'providerType'
    and outbox.reservation_json->>'model' = submitted.attempt->>'model'
    and outbox.reservation_json->>'model_profile' = submitted.attempt->>'modelProfile'
    and (outbox.reservation_json->>'model_profile_version_id') is not distinct from (submitted.attempt->>'modelProfileVersionId')
    and (outbox.reservation_json->>'pricing_snapshot_id') is not distinct from (submitted.attempt->>'pricingSnapshotId')
    and outbox.reservation_json->'pricing' = submitted.attempt->'pricing';
  if matched_reservation_count <> attempt_count then
    raise exception 'Provider attempt identity does not match its reservation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_attempts) item
    where
      jsonb_typeof(item.value) is distinct from 'object'
      or jsonb_typeof(item.value->'attemptIndex') is distinct from 'number'
      or (item.value->>'attemptIndex')::integer < 0
      or nullif(trim(item.value->>'provider'), '') is null
      or item.value->>'providerType' is null
      or item.value->>'providerType' not in ('text_generation', 'image_generation')
      or nullif(trim(item.value->>'model'), '') is null
      or nullif(trim(item.value->>'modelProfile'), '') is null
      or item.value->>'status' is null
      or item.value->>'status' not in ('completed', 'failed')
      or jsonb_typeof(item.value->'requestSubmitted') is distinct from 'boolean'
      or item.value->>'billingStatus' is null
      or item.value->>'billingStatus' not in ('actual', 'estimated', 'unbilled', 'unreconciled')
      or jsonb_typeof(item.value->'usage') is distinct from 'object'
      or jsonb_typeof(item.value#>'{usage,complete}') is distinct from 'boolean'
      or coalesce((item.value#>>'{usage,inputTokens}')::numeric, -1) < 0
      or coalesce((item.value#>>'{usage,outputTokens}')::numeric, -1) < 0
      or coalesce((item.value#>>'{usage,imageUnits}')::numeric, -1) < 0
      or jsonb_typeof(item.value->'pricing') is distinct from 'object'
      or coalesce((item.value#>>'{pricing,inputUsdPerMillionTokens}')::numeric, -1) < 0
      or coalesce((item.value#>>'{pricing,outputUsdPerMillionTokens}')::numeric, -1) < 0
      or coalesce((item.value#>>'{pricing,imageUsdPerUnit}')::numeric, -1) < 0
      or (item.value#>>'{pricing,currency}') is distinct from 'USD'
      or coalesce((item.value->>'estimatedCostUsd')::numeric, -1) < 0
      or nullif(item.value->>'actualCostUsd', '')::numeric < 0
      or ((item.value->>'status') = 'completed' and (item.value->>'requestSubmitted')::boolean is not true)
      or case item.value->>'billingStatus'
        when 'actual' then
          (item.value->>'requestSubmitted')::boolean is not true
          or nullif(item.value->>'actualCostUsd', '')::numeric is null
        when 'estimated' then
          (item.value->>'requestSubmitted')::boolean is not true
          or coalesce((item.value#>>'{usage,complete}')::boolean, false) is not true
          or nullif(item.value->>'actualCostUsd', '')::numeric is not null
        when 'unbilled' then
          (item.value->>'requestSubmitted')::boolean is not false
          or coalesce((item.value->>'estimatedCostUsd')::numeric, 0) <> 0
          or nullif(item.value->>'actualCostUsd', '')::numeric is not null
        when 'unreconciled' then
          (item.value->>'requestSubmitted')::boolean is not true
          or coalesce((item.value->>'estimatedCostUsd')::numeric, 0) <> 0
          or nullif(item.value->>'actualCostUsd', '')::numeric is not null
        else true
      end
      or (
        coalesce((item.value#>>'{usage,complete}')::boolean, false)
        and round(coalesce((item.value->>'estimatedCostUsd')::numeric, 0), 6) <>
          round(
            coalesce((item.value#>>'{usage,inputTokens}')::numeric, 0)
              * coalesce((item.value#>>'{pricing,inputUsdPerMillionTokens}')::numeric, 0) / 1000000
            + coalesce((item.value#>>'{usage,outputTokens}')::numeric, 0)
              * coalesce((item.value#>>'{pricing,outputUsdPerMillionTokens}')::numeric, 0) / 1000000
            + coalesce((item.value#>>'{usage,imageUnits}')::numeric, 0)
              * coalesce((item.value#>>'{pricing,imageUsdPerUnit}')::numeric, 0),
            6
          )
      )
      or (
        not coalesce((item.value#>>'{usage,complete}')::boolean, false)
        and coalesce((item.value->>'estimatedCostUsd')::numeric, 0) <> 0
      )
  ) then
    raise exception 'Provider attempt accounting is internally inconsistent';
  end if;

  select
    coalesce(sum(coalesce((item.value#>>'{usage,inputTokens}')::bigint, 0)), 0),
    coalesce(sum(coalesce((item.value#>>'{usage,outputTokens}')::bigint, 0)), 0),
    coalesce(sum(coalesce((item.value#>>'{usage,imageUnits}')::numeric, 0)), 0),
    coalesce(sum(coalesce((item.value->>'estimatedCostUsd')::numeric, 0)), 0),
    case
      when count(*) filter (where item.value->>'billingStatus' in ('estimated', 'unreconciled')) > 0 then null
      when count(*) filter (where item.value->>'billingStatus' = 'actual') = 0 then null
      else sum(coalesce(nullif(item.value->>'actualCostUsd', '')::numeric, 0))
    end,
    coalesce(sum(
      case item.value->>'billingStatus'
        when 'actual' then coalesce(nullif(item.value->>'actualCostUsd', '')::numeric, 0)
        when 'estimated' then coalesce((item.value->>'estimatedCostUsd')::numeric, 0)
        else 0
      end
    ), 0),
    case
      when count(*) filter (where item.value->>'billingStatus' = 'unreconciled') > 0 then 'unreconciled'
      when count(*) filter (where item.value->>'billingStatus' = 'estimated') > 0 then 'estimated'
      when count(*) filter (where item.value->>'billingStatus' = 'actual') > 0 then 'actual'
      else 'unbilled'
    end
  into v_input_tokens, v_output_tokens, v_image_units, v_estimated_cost,
       v_actual_cost, v_preferred_cost, v_billing_status
  from jsonb_array_elements(v_attempts) item;

  select
    item.value->>'provider',
    item.value->>'providerType',
    item.value->>'model',
    item.value->>'modelProfile',
    nullif(item.value->>'modelProfileVersionId', '')::uuid,
    nullif(item.value->>'pricingSnapshotId', '')::uuid
  into v_provider_name, v_provider_type, v_model_name, v_model_profile,
       v_model_profile_version_id, v_pricing_snapshot_id
  from jsonb_array_elements(v_attempts) item
  order by
    case when item.value->>'status' = 'completed' then 0 else 1 end,
    (item.value->>'attemptIndex')::integer desc
  limit 1;

  if attempt_count > 0 and (
    p_run->>'provider_name' is distinct from v_provider_name
    or p_run->>'provider_type' is distinct from v_provider_type
    or p_run->>'model_name' is distinct from v_model_name
    or p_run->>'model_profile' is distinct from v_model_profile
    or nullif(p_run->>'model_profile_version_id', '')::uuid is distinct from v_model_profile_version_id
    or nullif(p_run->>'pricing_snapshot_id', '')::uuid is distinct from v_pricing_snapshot_id
  ) then
    raise exception 'Provider run identity does not match normalized attempts';
  end if;

  -- SQL owns aggregate truth. Client aggregate fields are deliberately ignored;
  -- every persisted total below is derived from validated normalized attempts.
  v_provider_name := coalesce(v_provider_name, p_run->>'provider_name');
  v_provider_type := coalesce(v_provider_type, p_run->>'provider_type');
  v_model_name := coalesce(v_model_name, p_run->>'model_name');
  v_model_profile := coalesce(v_model_profile, p_run->>'model_profile');

  insert into public.ai_runs (
    workspace_id, user_id, prompt_version_id, provider, model, task, output_type,
    status, input_tokens, output_tokens, image_units, estimated_cost_cents,
    estimated_cost_usd, actual_cost_usd, billing_status, result_summary,
    error_message, completed_at, correlation_id
  ) values (
    p_workspace_id,
    nullif(p_run->>'user_id', '')::uuid,
    nullif(p_run->>'prompt_version_id', '')::uuid,
    v_provider_name, v_model_name, p_run->>'task_type',
    case when v_provider_type = 'image_generation' then 'image' else 'json' end,
    (p_run->>'status')::public.ai_run_status,
    v_input_tokens::integer, v_output_tokens::integer, v_image_units::integer,
    round(v_preferred_cost * 100)::integer,
    v_estimated_cost, v_actual_cost,
    v_billing_status, p_run->>'result_summary',
    p_run#>>'{error_json,summary}',
    coalesce((p_run->>'completed_at')::timestamptz, now()),
    p_run->>'correlation_id'
  ) returning id into v_ai_run_id;

  insert into public.ai_usage_ledger (
    workspace_id, ai_run_id, user_id, provider, model, task, output_type,
    input_tokens, output_tokens, image_units, estimated_cost_cents,
    estimated_cost_usd, actual_cost_usd, billing_status, result, correlation_id
  ) values (
    p_workspace_id, v_ai_run_id, nullif(p_run->>'user_id', '')::uuid,
    v_provider_name, v_model_name, p_run->>'task_type',
    case when v_provider_type = 'image_generation' then 'image' else 'json' end,
    v_input_tokens::integer, v_output_tokens::integer, v_image_units::integer,
    round(v_preferred_cost * 100)::integer,
    v_estimated_cost, v_actual_cost,
    v_billing_status,
    case when p_run->>'status' = 'completed' then 'completed' else 'failed' end,
    p_run->>'correlation_id'
  ) returning id into v_ledger_id;

  insert into public.adstudio_provider_runs (
    workspace_id, user_id, correlation_id, ai_run_id, task_type, model_profile,
    model_profile_version_id, pricing_snapshot_id, ai_usage_ledger_id,
    provider_name, provider_type, model_name, prompt_version_id,
    input_json, output_json, usage_json, cost_estimate,
    estimated_cost_usd, actual_cost_usd, billing_status,
    status, error_json, mutation_id, payload_hash
  ) values (
    p_workspace_id, nullif(p_run->>'user_id', '')::uuid, p_run->>'correlation_id',
    v_ai_run_id, p_run->>'task_type', v_model_profile,
    v_model_profile_version_id,
    v_pricing_snapshot_id,
    v_ledger_id, v_provider_name, v_provider_type, v_model_name,
    nullif(p_run->>'prompt_version_id', '')::uuid,
    coalesce(p_run->'input_json', '{}'::jsonb), coalesce(p_run->'output_json', '{}'::jsonb),
    jsonb_build_object(
      'inputTokens', v_input_tokens,
      'outputTokens', v_output_tokens,
      'imageUnits', v_image_units
    ),
    round(v_preferred_cost, 4),
    v_estimated_cost, v_actual_cost, v_billing_status,
    p_run->>'status', p_run->'error_json', p_mutation_id, p_payload_hash
  ) returning id into v_provider_run_id;

  for attempt in select value from jsonb_array_elements(v_attempts)
  loop
    insert into public.adstudio_provider_run_attempts (
      workspace_id, provider_run_id, attempt_index, provider_name, provider_type,
      model_name, model_profile, model_profile_version_id, pricing_snapshot_id,
      status, request_submitted, billing_status, provider_request_id,
      usage_json, pricing_json, estimated_cost_usd, actual_cost_usd, error_summary
    ) values (
      p_workspace_id, v_provider_run_id, (attempt->>'attemptIndex')::integer,
      attempt->>'provider', attempt->>'providerType', attempt->>'model',
      attempt->>'modelProfile', nullif(attempt->>'modelProfileVersionId', '')::uuid,
      nullif(attempt->>'pricingSnapshotId', '')::uuid,
      attempt->>'status', (attempt->>'requestSubmitted')::boolean,
      attempt->>'billingStatus', attempt->>'providerRequestId',
      coalesce(attempt->'usage', '{}'::jsonb), coalesce(attempt->'pricing', '{}'::jsonb),
      coalesce((attempt->>'estimatedCostUsd')::numeric, 0),
      nullif(attempt->>'actualCostUsd', '')::numeric, attempt->>'error'
    );
  end loop;

  update public.adstudio_provider_attempt_outbox outbox
  set status = 'closed',
      provider_run_id = v_provider_run_id,
      final_attempt_json = (
        select item.value from jsonb_array_elements(v_attempts) item
        where (item.value->>'attemptIndex')::integer = outbox.attempt_index
      ),
      closed_at = now()
  where outbox.workspace_id = p_workspace_id and outbox.mutation_id = p_mutation_id;

  return jsonb_build_object(
    'provider_run_id', v_provider_run_id,
    'ai_run_id', v_ai_run_id,
    'ai_usage_ledger_id', v_ledger_id,
    'idempotent', false
  );
end;
$function$;

create or replace function public.adstudio_recover_provider_run(
  p_workspace_id uuid,
  p_mutation_id text,
  p_payload_hash text,
  p_run jsonb,
  p_stale_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  representative jsonb;
  recovered_run jsonb;
begin
  if p_stale_before is null or p_stale_before > now() then
    raise exception 'Recovery cutoff must be a past timestamp';
  end if;
  if not exists (
    select 1 from public.adstudio_provider_attempt_outbox
    where workspace_id = p_workspace_id
      and mutation_id = p_mutation_id
      and status in ('reserved', 'submitted', 'cancelled')
  ) then
    raise exception 'No provider attempts require recovery';
  end if;
  if exists (
    select 1 from public.adstudio_provider_attempt_outbox
    where workspace_id = p_workspace_id
      and mutation_id = p_mutation_id
      and status in ('reserved', 'submitted')
      and coalesce(submitted_at, reserved_at) > p_stale_before
  ) then
    raise exception 'Provider attempt is not stale enough to recover';
  end if;

  select reservation_json into representative
  from public.adstudio_provider_attempt_outbox
  where workspace_id = p_workspace_id
    and mutation_id = p_mutation_id
    and status in ('reserved', 'submitted', 'cancelled')
  order by attempt_index desc
  limit 1;

  recovered_run := p_run || jsonb_build_object(
    'provider_name', representative->>'provider',
    'provider_type', representative->>'provider_type',
    'model_name', representative->>'model',
    'model_profile', representative->>'model_profile',
    'model_profile_version_id', representative->'model_profile_version_id',
    'pricing_snapshot_id', representative->'pricing_snapshot_id',
    'status', 'failed'
  );

  return public.adstudio_record_provider_run(
    p_workspace_id, p_mutation_id, p_payload_hash, recovered_run, '[]'::jsonb
  );
end;
$function$;

revoke all on function public.adstudio_reserve_provider_attempt(uuid, text, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.adstudio_mark_provider_attempt_submitted(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.adstudio_cancel_provider_attempt(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.adstudio_record_provider_run(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.adstudio_recover_provider_run(uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.adstudio_reserve_provider_attempt(uuid, text, integer, text, jsonb) to service_role;
grant execute on function public.adstudio_mark_provider_attempt_submitted(uuid, text, integer) to service_role;
grant execute on function public.adstudio_cancel_provider_attempt(uuid, text, integer, text) to service_role;
grant execute on function public.adstudio_record_provider_run(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.adstudio_recover_provider_run(uuid, text, text, jsonb, timestamptz) to service_role;

commit;
