update public.prompt_versions
set metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
  'section_type',
  case key
    when 'adstudio.copy.system' then 'system'
    when 'adstudio.copy.input_template' then 'input_template'
    when 'adstudio.copy.output_schema' then 'output_schema'
    when 'adstudio.copy.compliance_rules' then 'compliance_rules'
    when 'adstudio.image.system' then 'system'
    when 'adstudio.image.input_template' then 'input_template'
    when 'adstudio.image.brand_rules' then 'brand_rules'
    when 'adstudio.image.negative_prompt' then 'negative_prompt'
    when 'adstudio.image.aspect_ratio_rules' then 'aspect_ratio_rules'
    when 'adstudio.background.system' then 'system'
    when 'adstudio.background.input_template' then 'input_template'
    when 'adstudio.background.negative_prompt' then 'negative_prompt'
  end
)
where workspace_id is null
  and key in (
    'adstudio.copy.system',
    'adstudio.copy.input_template',
    'adstudio.copy.output_schema',
    'adstudio.copy.compliance_rules',
    'adstudio.image.system',
    'adstudio.image.input_template',
    'adstudio.image.brand_rules',
    'adstudio.image.negative_prompt',
    'adstudio.image.aspect_ratio_rules',
    'adstudio.background.system',
    'adstudio.background.input_template',
    'adstudio.background.negative_prompt'
  );

create or replace function public.create_global_prompt_draft(
  target_key text,
  prompt_body text,
  prompt_title text default null,
  prompt_notes text default null,
  prompt_metadata jsonb default '{}'::jsonb,
  prompt_output_schema jsonb default null,
  operator_profile_id uuid default null
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  new_version integer;
  draft_row public.prompt_versions;
begin
  if nullif(btrim(target_key), '') is null then
    raise exception 'Prompt key is required';
  end if;

  if nullif(btrim(prompt_body), '') is null then
    raise exception 'Prompt body is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('prompt_versions.global'), hashtext(target_key));

  perform 1
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
  for update;

  select coalesce(max(version), 0) + 1
    into new_version
  from public.prompt_versions
  where workspace_id is null
    and key = target_key;

  insert into public.prompt_versions (
    workspace_id,
    key,
    version,
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
    target_key,
    new_version,
    btrim(prompt_body),
    prompt_output_schema,
    operator_profile_id,
    nullif(btrim(coalesce(prompt_title, '')), ''),
    nullif(btrim(coalesce(prompt_notes, '')), ''),
    coalesce(prompt_metadata, '{}'::jsonb),
    'draft'
  )
  returning * into draft_row;

  return draft_row;
end;
$$;

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
  if nullif(btrim(target_key), '') is null then
    raise exception 'Prompt key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('prompt_versions.global'), hashtext(target_key));

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
  if nullif(btrim(target_key), '') is null then
    raise exception 'Prompt key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('prompt_versions.global'), hashtext(target_key));

  select *
    into source_row
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
    and version = target_version
  for update;

  if not found then
    raise exception 'Prompt version %.% was not found', target_key, target_version;
  end if;

  perform 1
  from public.prompt_versions
  where workspace_id is null
    and key = target_key
  for update;

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

revoke all on function public.create_global_prompt_draft(text, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.promote_global_prompt_version(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.rollback_global_prompt_version(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_global_prompt_draft(text, text, text, text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.promote_global_prompt_version(text, integer, uuid) to service_role;
grant execute on function public.rollback_global_prompt_version(text, integer, uuid) to service_role;
