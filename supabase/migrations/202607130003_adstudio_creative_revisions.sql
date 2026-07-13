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
  add column active_revision_id uuid;

create table public.adstudio_creative_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  creative_id uuid not null,
  parent_revision_id uuid,
  revision_number integer not null check (revision_number > 0),
  canvas_json jsonb not null check (jsonb_typeof(canvas_json) = 'object'),
  render_status text not null,
  creation_operation text not null check (
    creation_operation in ('creative_created', 'migration_backfill', 'targeted_edit')
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

alter table public.adstudio_creative_revisions enable row level security;

create policy adstudio_creative_revisions_select
on public.adstudio_creative_revisions
for select
to authenticated
using ((select private.adstudio_has_workspace_access(workspace_id)));

revoke insert, update, delete on public.adstudio_creative_revisions
  from public, anon, authenticated, service_role;
grant select on public.adstudio_creative_revisions to authenticated;
grant select on public.adstudio_creative_revisions to service_role;

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
  next_revision_number integer;
  new_revision_id uuid;
  existing_revision record;
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

  select
    r.id,
    r.parent_revision_id,
    r.revision_number,
    r.canvas_json,
    r.render_status,
    r.creation_operation
  into existing_revision
  from public.adstudio_creative_revisions r
  where r.workspace_id = p_workspace_id
    and r.creative_id = p_creative_id
    and r.mutation_id = p_mutation_id;

  if found then
    if existing_revision.parent_revision_id is distinct from p_expected_active_revision_id
      or existing_revision.canvas_json is distinct from p_canvas_json
      or existing_revision.render_status is distinct from p_render_status
      or existing_revision.creation_operation is distinct from p_creation_operation then
      raise exception using
        errcode = '22023',
        message = 'Mutation ID was already used for different creative revision input.';
    end if;

    return query
    select existing_revision.id::uuid, existing_revision.revision_number::integer;
    return;
  end if;

  select c.active_revision_id
  into current_active_revision_id
  from public.adstudio_creatives c
  where c.workspace_id = p_workspace_id
    and c.id = p_creative_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Creative was not found in this workspace.';
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
      updated_at = now()
  where workspace_id = p_workspace_id
    and id = p_creative_id;

  return query select new_revision_id, next_revision_number;
end
$function$;

revoke all on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid
) from public, anon;
grant execute on function public.adstudio_append_creative_revision(
  uuid, uuid, uuid, jsonb, text, text, uuid
) to authenticated, service_role;

comment on table public.adstudio_creative_revisions is
  'Append-only creative snapshots. Targeted edits advance adstudio_creatives.active_revision_id through a compare-and-swap RPC.';

commit;
