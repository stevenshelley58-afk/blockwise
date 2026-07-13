begin;

-- Immutable creative revisions for the single-template pilot. Existing rows are
-- snapshotted before active_revision_id becomes required; new rows receive
-- revision 1 in the same transaction through deferred-FK insert triggers.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adstudio_creatives'::regclass
      and conname = 'adstudio_creatives_workspace_id_id_unique'
  ) then
    alter table public.adstudio_creatives
      add constraint adstudio_creatives_workspace_id_id_unique unique (workspace_id, id);
  end if;
end
$$;

alter table public.adstudio_creatives
  add column active_revision_id uuid,
  add column pending_revision_mutation_id uuid;

create table public.adstudio_creative_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  creative_id uuid not null,
  parent_revision_id uuid,
  revision_number integer not null check (revision_number > 0),
  canvas_json jsonb not null check (jsonb_typeof(canvas_json) = 'object'),
  render_status text not null,
  creation_operation text not null check (
    creation_operation in ('creative_created', 'migration_backfill', 'campaign_persist', 'targeted_edit')
  ),
  mutation_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint adstudio_creative_revisions_workspace_id_id_unique
    unique (workspace_id, id),
  constraint adstudio_creative_revisions_workspace_creative_id_id_unique
    unique (workspace_id, creative_id, id),
  constraint adstudio_creative_revisions_number_unique
    unique (workspace_id, creative_id, revision_number),
  constraint adstudio_creative_revisions_mutation_unique
    unique (workspace_id, creative_id, mutation_id),
  constraint adstudio_creative_revisions_creative_fk
    foreign key (workspace_id, creative_id)
    references public.adstudio_creatives (workspace_id, id)
    on delete cascade,
  constraint adstudio_creative_revisions_parent_fk
    foreign key (workspace_id, creative_id, parent_revision_id)
    references public.adstudio_creative_revisions (workspace_id, creative_id, id)
    deferrable initially deferred
);

create table public.adstudio_creative_revision_mutations (
  id uuid primary key,
  workspace_id uuid not null,
  creative_id uuid not null,
  base_revision_id uuid not null,
  status text not null check (status in ('claimed', 'completed', 'failed')),
  result_revision_id uuid,
  claimed_at timestamptz not null default now(),
  claim_expires_at timestamptz not null default (now() + interval '2 minutes'),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint adstudio_revision_mutations_workspace_creative_id_key
    unique (workspace_id, creative_id, id),
  constraint adstudio_creative_revision_mutations_creative_fk
    foreign key (workspace_id, creative_id)
    references public.adstudio_creatives (workspace_id, id),
  constraint adstudio_creative_revision_mutations_base_fk
    foreign key (workspace_id, creative_id, base_revision_id)
    references public.adstudio_creative_revisions (workspace_id, creative_id, id),
  constraint adstudio_creative_revision_mutations_result_fk
    foreign key (workspace_id, creative_id, result_revision_id)
    references public.adstudio_creative_revisions (workspace_id, creative_id, id)
);

create index adstudio_creative_revisions_creative_created_idx
  on public.adstudio_creative_revisions (workspace_id, creative_id, created_at desc);

lock table public.adstudio_creatives in share row exclusive mode;

insert into public.adstudio_creative_revisions (
  workspace_id,
  creative_id,
  revision_number,
  canvas_json,
  render_status,
  creation_operation,
  mutation_id,
  created_at
)
select
  c.workspace_id,
  c.id,
  1,
  c.canvas_json,
  c.render_status,
  'migration_backfill',
  gen_random_uuid(),
  c.created_at
from public.adstudio_creatives c;

update public.adstudio_creatives c
set active_revision_id = r.id
from public.adstudio_creative_revisions r
where r.workspace_id = c.workspace_id
  and r.creative_id = c.id
  and r.revision_number = 1;

do $$
declare
  creative_count bigint;
  revision_count bigint;
  unresolved bigint;
begin
  select count(*) into creative_count
  from public.adstudio_creatives;

  select count(*) into revision_count
  from public.adstudio_creative_revisions
  where revision_number = 1;

  select count(*) into unresolved
  from public.adstudio_creatives
  where active_revision_id is null;

  if unresolved <> 0 or revision_count <> creative_count then
    raise exception
      'AdStudio revision backfill mismatch: creatives=%, revisions=%, unresolved=%',
      creative_count,
      revision_count,
      unresolved;
  end if;

  raise notice
    'AdStudio revision backfill verified: creatives=%, revisions=%, unresolved=%',
    creative_count,
    revision_count,
    unresolved;
end
$$;

alter table public.adstudio_creatives
  alter column active_revision_id set not null,
  add constraint adstudio_creatives_active_revision_fk
    foreign key (workspace_id, id, active_revision_id)
    references public.adstudio_creative_revisions (workspace_id, creative_id, id)
    deferrable initially deferred;

alter table public.adstudio_creatives
  add constraint adstudio_creatives_pending_revision_mutation_fk
    foreign key (workspace_id, id, pending_revision_mutation_id)
    references public.adstudio_creative_revision_mutations (workspace_id, creative_id, id)
    deferrable initially deferred;

create or replace function private.adstudio_prepare_initial_creative_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.active_revision_id := coalesce(new.active_revision_id, gen_random_uuid());
  return new;
end
$function$;

create or replace function private.adstudio_create_initial_creative_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.adstudio_creative_revisions (
    id,
    workspace_id,
    creative_id,
    revision_number,
    canvas_json,
    render_status,
    creation_operation,
    mutation_id
  ) values (
    new.active_revision_id,
    new.workspace_id,
    new.id,
    1,
    new.canvas_json,
    new.render_status,
    'creative_created',
    gen_random_uuid()
  );
  return new;
end
$function$;

create trigger adstudio_creatives_prepare_initial_revision
before insert on public.adstudio_creatives
for each row execute function private.adstudio_prepare_initial_creative_revision();

create trigger adstudio_creatives_create_initial_revision
after insert on public.adstudio_creatives
for each row execute function private.adstudio_create_initial_creative_revision();

create or replace function private.adstudio_guard_creative_version_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expected_canvas jsonb;
  expected_render_status text;
  next_revision_number integer;
  next_revision_id uuid;
begin
  if new.canvas_json is not distinct from old.canvas_json
    and new.render_status is not distinct from old.render_status
    and new.active_revision_id is not distinct from old.active_revision_id
    and new.pending_revision_mutation_id is not distinct from old.pending_revision_mutation_id then
    return new;
  end if;

  if new.active_revision_id is distinct from old.active_revision_id then
    select r.canvas_json, r.render_status
    into expected_canvas, expected_render_status
    from public.adstudio_creative_revisions r
    where r.workspace_id = old.workspace_id
      and r.creative_id = old.id
      and r.id = new.active_revision_id
      and r.parent_revision_id = old.active_revision_id;

    if not found
      or expected_canvas is distinct from new.canvas_json
      or expected_render_status is distinct from new.render_status then
      raise exception using
        errcode = '23503',
        message = 'Creative active revision does not match its versioned fields.';
    end if;
    return new;
  end if;

  if new.canvas_json is distinct from old.canvas_json
    or new.render_status is distinct from old.render_status then
    select r.revision_number + 1
    into next_revision_number
    from public.adstudio_creative_revisions r
    where r.workspace_id = old.workspace_id
      and r.creative_id = old.id
      and r.id = old.active_revision_id;

    if next_revision_number is null then
      raise exception using errcode = '23503', message = 'Active creative revision is missing.';
    end if;

    next_revision_id := gen_random_uuid();
    insert into public.adstudio_creative_revisions (
      id, workspace_id, creative_id, parent_revision_id, revision_number,
      canvas_json, render_status, creation_operation, mutation_id
    ) values (
      next_revision_id, old.workspace_id, old.id, old.active_revision_id, next_revision_number,
      new.canvas_json, new.render_status, 'campaign_persist', gen_random_uuid()
    );
    new.active_revision_id := next_revision_id;
  end if;

  return new;
end
$function$;

create trigger adstudio_guard_creative_version_update
before update on public.adstudio_creatives
for each row execute function private.adstudio_guard_creative_version_update();

create or replace function private.adstudio_preserve_creative_revision_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.adstudio_creative_revisions r
    where r.workspace_id = old.workspace_id and r.creative_id = old.id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Creative revision history must be preserved; archive the creative instead.';
  end if;
  return old;
end
$function$;

create trigger adstudio_preserve_creative_revision_history
before delete on public.adstudio_creatives
for each row execute function private.adstudio_preserve_creative_revision_history();

alter table public.adstudio_creative_revisions enable row level security;
alter table public.adstudio_creative_revision_mutations enable row level security;

create policy adstudio_creative_revisions_select
on public.adstudio_creative_revisions
for select
to authenticated
using ((select private.adstudio_has_workspace_access(workspace_id)));

create policy adstudio_creative_revision_mutations_select
on public.adstudio_creative_revision_mutations
for select
to authenticated
using ((select private.adstudio_has_workspace_access(workspace_id)));

revoke insert, update, delete on public.adstudio_creative_revisions
  from public, anon, authenticated, service_role;
grant select on public.adstudio_creative_revisions to authenticated;
grant select on public.adstudio_creative_revisions to service_role;

revoke insert, update, delete on public.adstudio_creative_revision_mutations
  from public, anon, authenticated, service_role;
grant select on public.adstudio_creative_revision_mutations to authenticated, service_role;

create or replace function public.adstudio_claim_creative_revision_mutation(
  p_workspace_id uuid,
  p_creative_id uuid,
  p_expected_active_revision_id uuid,
  p_mutation_id uuid
) returns table (
  state text,
  revision_id uuid,
  revision_number integer,
  canvas_json jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  creative_row record;
  mutation_row record;
  is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not is_service_role
    and not private.has_workspace_role(p_workspace_id, array['owner', 'admin', 'operator', 'member']::text[]) then
    raise exception using errcode = '42501', message = 'Workspace access is not allowed.';
  end if;
  if p_expected_active_revision_id is null or p_mutation_id is null then
    raise exception using errcode = '22023', message = 'Invalid creative revision claim.';
  end if;

  select c.active_revision_id, c.pending_revision_mutation_id
  into creative_row
  from public.adstudio_creatives c
  where c.workspace_id = p_workspace_id and c.id = p_creative_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Creative was not found in this workspace.';
  end if;

  select m.* into mutation_row
  from public.adstudio_creative_revision_mutations m
  where m.workspace_id = p_workspace_id
    and m.creative_id = p_creative_id
    and m.id = p_mutation_id;

  if found then
    if mutation_row.base_revision_id is distinct from p_expected_active_revision_id then
      raise exception using errcode = '22023', message = 'Mutation ID was already used for a different base revision.';
    end if;
    if mutation_row.status = 'completed' then
      return query
      select 'completed'::text, r.id, r.revision_number, r.canvas_json
      from public.adstudio_creative_revisions r
      where r.workspace_id = p_workspace_id
        and r.creative_id = p_creative_id
        and r.id = mutation_row.result_revision_id;
      return;
    end if;
    if mutation_row.status = 'claimed' and mutation_row.claim_expires_at > now() then
      raise exception using errcode = '55P03', message = 'ADSTUDIO_EDIT_IN_PROGRESS';
    end if;
  end if;

  if creative_row.pending_revision_mutation_id is not null
    and creative_row.pending_revision_mutation_id is distinct from p_mutation_id then
    update public.adstudio_creative_revision_mutations
    set status = 'failed', updated_at = now()
    where workspace_id = p_workspace_id
      and creative_id = p_creative_id
      and id = creative_row.pending_revision_mutation_id
      and status = 'claimed'
      and claim_expires_at <= now();
    if not found then
      raise exception using errcode = '55P03', message = 'ADSTUDIO_EDIT_IN_PROGRESS';
    end if;
  end if;

  if creative_row.active_revision_id is distinct from p_expected_active_revision_id then
    raise exception using errcode = '40001', message = 'ADSTUDIO_STALE_REVISION';
  end if;

  insert into public.adstudio_creative_revision_mutations (
    id, workspace_id, creative_id, base_revision_id, status, claimed_at, claim_expires_at, updated_at
  ) values (
    p_mutation_id, p_workspace_id, p_creative_id, p_expected_active_revision_id,
    'claimed', now(), now() + interval '2 minutes', now()
  )
  on conflict (workspace_id, creative_id, id) do update set
    status = 'claimed',
    result_revision_id = null,
    claimed_at = now(),
    claim_expires_at = now() + interval '2 minutes',
    completed_at = null,
    updated_at = now();

  update public.adstudio_creatives
  set pending_revision_mutation_id = p_mutation_id, updated_at = now()
  where workspace_id = p_workspace_id and id = p_creative_id;

  return query select 'claimed'::text, null::uuid, null::integer, null::jsonb;
end
$function$;

create or replace function public.adstudio_release_creative_revision_mutation(
  p_workspace_id uuid,
  p_creative_id uuid,
  p_mutation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  pending_id uuid;
  is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not is_service_role
    and not private.has_workspace_role(p_workspace_id, array['owner', 'admin', 'operator', 'member']::text[]) then
    raise exception using errcode = '42501', message = 'Workspace access is not allowed.';
  end if;
  select c.pending_revision_mutation_id into pending_id
  from public.adstudio_creatives c
  where c.workspace_id = p_workspace_id and c.id = p_creative_id
  for update;
  if not found then return; end if;

  if pending_id = p_mutation_id then
    update public.adstudio_creatives
    set pending_revision_mutation_id = null, updated_at = now()
    where workspace_id = p_workspace_id and id = p_creative_id;
    update public.adstudio_creative_revision_mutations
    set status = 'failed', updated_at = now()
    where workspace_id = p_workspace_id and creative_id = p_creative_id
      and id = p_mutation_id and status = 'claimed';
  end if;
end
$function$;

create or replace function public.adstudio_append_creative_revision(
  p_workspace_id uuid,
  p_creative_id uuid,
  p_expected_active_revision_id uuid,
  p_canvas_json jsonb,
  p_render_status text,
  p_creation_operation text,
  p_mutation_id uuid
) returns table (
  revision_id uuid,
  revision_number integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_active_revision_id uuid;
  pending_revision_mutation_id uuid;
  next_revision_number integer;
  new_revision_id uuid;
  existing_revision record;
  mutation_row record;
  is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not is_service_role
    and not private.has_workspace_role(
      p_workspace_id,
      array['owner', 'admin', 'operator', 'member']::text[]
    ) then
    raise exception using
      errcode = '42501',
      message = 'Workspace access is not allowed.';
  end if;

  if p_expected_active_revision_id is null
    or p_mutation_id is null
    or jsonb_typeof(p_canvas_json) <> 'object'
    or p_creation_operation <> 'targeted_edit' then
    raise exception using
      errcode = '22023',
      message = 'Invalid creative revision input.';
  end if;

  -- Lock first. A concurrent duplicate waits for the winning transaction, then
  -- observes its completed mutation and returns that exact revision.
  select c.active_revision_id, c.pending_revision_mutation_id
  into current_active_revision_id, pending_revision_mutation_id
  from public.adstudio_creatives c
  where c.workspace_id = p_workspace_id
    and c.id = p_creative_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Creative was not found in this workspace.';
  end if;

  select m.status, m.base_revision_id, m.result_revision_id
  into mutation_row
  from public.adstudio_creative_revision_mutations m
  where m.workspace_id = p_workspace_id
    and m.creative_id = p_creative_id
    and m.id = p_mutation_id;

  if not found then
    raise exception using errcode = '22023', message = 'Creative revision mutation was not claimed.';
  end if;
  if mutation_row.base_revision_id is distinct from p_expected_active_revision_id then
    raise exception using errcode = '22023', message = 'Mutation claim base revision does not match.';
  end if;

  if mutation_row.status = 'completed' then
    select r.id, r.parent_revision_id, r.revision_number, r.canvas_json, r.render_status, r.creation_operation
    into existing_revision
    from public.adstudio_creative_revisions r
    where r.workspace_id = p_workspace_id
      and r.creative_id = p_creative_id
      and r.id = mutation_row.result_revision_id;

    if not found
      or existing_revision.parent_revision_id is distinct from p_expected_active_revision_id
      or existing_revision.canvas_json is distinct from p_canvas_json
      or existing_revision.render_status is distinct from p_render_status
      or existing_revision.creation_operation is distinct from p_creation_operation then
      raise exception using
        errcode = '22023',
        message = 'Mutation ID was already used for different creative revision input.';
    end if;

    return query select existing_revision.id::uuid, existing_revision.revision_number::integer;
    return;
  end if;

  if mutation_row.status <> 'claimed' or pending_revision_mutation_id is distinct from p_mutation_id then
    raise exception using errcode = '22023', message = 'Creative revision mutation is not active.';
  end if;

  if current_active_revision_id is distinct from p_expected_active_revision_id then
    raise exception using
      errcode = '40001',
      message = 'ADSTUDIO_STALE_REVISION';
  end if;

  select r.revision_number + 1
  into next_revision_number
  from public.adstudio_creative_revisions r
  where r.workspace_id = p_workspace_id
    and r.creative_id = p_creative_id
    and r.id = current_active_revision_id;

  if next_revision_number is null then
    raise exception using
      errcode = '23503',
      message = 'Active creative revision is missing.';
  end if;

  new_revision_id := gen_random_uuid();

  insert into public.adstudio_creative_revisions (
    id,
    workspace_id,
    creative_id,
    parent_revision_id,
    revision_number,
    canvas_json,
    render_status,
    creation_operation,
    mutation_id,
    created_by
  ) values (
    new_revision_id,
    p_workspace_id,
    p_creative_id,
    current_active_revision_id,
    next_revision_number,
    p_canvas_json,
    p_render_status,
    p_creation_operation,
    p_mutation_id,
    case when is_service_role then null else auth.uid() end
  );

  update public.adstudio_creatives
  set canvas_json = p_canvas_json,
      render_status = p_render_status,
      active_revision_id = new_revision_id,
      pending_revision_mutation_id = null,
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_creative_id;

  update public.adstudio_creative_revision_mutations
  set status = 'completed',
      result_revision_id = new_revision_id,
      completed_at = now(),
      updated_at = now()
  where workspace_id = p_workspace_id
    and creative_id = p_creative_id
    and id = p_mutation_id;

  return query select new_revision_id, next_revision_number;
end
$function$;

revoke all on function public.adstudio_claim_creative_revision_mutation(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.adstudio_claim_creative_revision_mutation(uuid, uuid, uuid, uuid)
  to authenticated, service_role;
revoke all on function public.adstudio_release_creative_revision_mutation(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.adstudio_release_creative_revision_mutation(uuid, uuid, uuid)
  to authenticated, service_role;

revoke all on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid
) to authenticated, service_role;

comment on table public.adstudio_creative_revisions is
  'Append-only creative snapshots. Targeted edits advance adstudio_creatives.active_revision_id through a compare-and-swap RPC.';

commit;
