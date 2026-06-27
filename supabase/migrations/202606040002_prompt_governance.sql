alter table public.prompt_versions
  add column if not exists status text not null default 'draft',
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists metadata_json jsonb not null default '{}';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'prompt_versions_status_check'
      and conrelid = 'public.prompt_versions'::regclass
  ) then
    alter table public.prompt_versions
      add constraint prompt_versions_status_check
      check (status in ('draft', 'active', 'archived'));
  end if;
end $$;

with ranked_prompts as (
  select
    id,
    row_number() over (
      partition by workspace_id, key
      order by version desc, created_at desc, id desc
    ) as rank
  from public.prompt_versions
)
update public.prompt_versions prompt
set
  status = case when ranked_prompts.rank = 1 then 'active' else 'archived' end,
  title = coalesce(nullif(prompt.title, ''), prompt.key)
from ranked_prompts
where prompt.id = ranked_prompts.id
  and prompt.status = 'draft';

create index if not exists prompt_versions_active_global_lookup_idx
  on public.prompt_versions (key, version desc)
  where status = 'active' and workspace_id is null;

create unique index if not exists prompt_versions_one_active_global_key_idx
  on public.prompt_versions (key)
  where status = 'active' and workspace_id is null;

create or replace function public.promote_global_prompt_version(
  target_key text,
  target_version integer,
  operator_profile_id uuid default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.prompt_versions;
  previous_active_version integer;
begin
  select *
    into target_row
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
    and version = target_version
    and status = 'draft'
  for update;

  if not found then
    raise exception 'Prompt draft %.% was not found', target_key, target_version;
  end if;

  select version
    into previous_active_version
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
    and status = 'active'
  order by version desc
  limit 1
  for update;

  update public.prompt_versions
  set
    status = 'archived',
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'archived_at', now(),
      'archived_by_promotion_to_version', target_version
    )
  where workspace_id is null
    and key = target_key
    and status = 'active';

  update public.prompt_versions
  set
    status = 'active',
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'promoted_by', operator_profile_id,
      'promoted_at', now(),
      'previous_active_version', previous_active_version
    )
  where id = target_row.id
  returning * into target_row;

  return target_row;
end;
$$;

create or replace function public.rollback_global_prompt_version(
  target_key text,
  target_version integer,
  operator_profile_id uuid default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.prompt_versions;
  new_version integer;
  draft_row public.prompt_versions;
begin
  select *
    into source_row
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
    and version = target_version;

  if not found then
    raise exception 'Prompt version %.% was not found', target_key, target_version;
  end if;

  select coalesce(max(version), 0) + 1
    into new_version
  from public.prompt_versions
  where workspace_id is null
    and key = target_key;

  insert into public.prompt_versions (
    workspace_id,
    key,
    version,
    model_profile_id,
    system_prompt,
    output_schema,
    created_by,
    title,
    notes,
    metadata_json,
    status
  )
  values (
    null,
    source_row.key,
    new_version,
    source_row.model_profile_id,
    source_row.system_prompt,
    source_row.output_schema,
    operator_profile_id,
    coalesce(source_row.title, source_row.key),
    concat('Rollback copied from version ', source_row.version),
    coalesce(source_row.metadata_json, '{}'::jsonb) || jsonb_build_object(
      'rollback_from_version', source_row.version,
      'rollback_created_by', operator_profile_id,
      'rollback_created_at', now()
    ),
    'draft'
  )
  returning * into draft_row;

  return public.promote_global_prompt_version(target_key, new_version, operator_profile_id);
end;
$$;

revoke all on function public.promote_global_prompt_version(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.rollback_global_prompt_version(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.promote_global_prompt_version(text, integer, uuid) to service_role;
grant execute on function public.rollback_global_prompt_version(text, integer, uuid) to service_role;
