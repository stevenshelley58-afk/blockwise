-- AdStudio now has one image path: sample clone first, then targeted edits.
-- Remove the retired profile while retaining immutable run history. The counts
-- are emitted before nullable historical links are detached.
update public.model_profile_versions v
set
  provider = 'openrouter',
  model = 'openai/gpt-5.4-image-2',
  input_usd_per_million_tokens = 8.0000,
  output_usd_per_million_tokens = 15.0000,
  image_usd_per_unit = 0,
  max_context_tokens = 400000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_final'
  and v.active_to is null
  and v.model in (
    'gpt-image-1.5',
    'gpt-image-2',
    'google/gemini-2.5-flash-image'
  );

do $$
declare
  retired_profile_id uuid;
  prompt_reference_count bigint;
  run_reference_count bigint;
begin
  select id
  into retired_profile_id
  from public.model_profiles
  where key = 'image_' || 'generative';

  if retired_profile_id is null then
    return;
  end if;

  select count(*)
  into prompt_reference_count
  from public.prompt_versions
  where model_profile_id = retired_profile_id;

  select count(*)
  into run_reference_count
  from public.ai_runs
  where model_profile_id = retired_profile_id;

  raise notice 'retired image profile references: prompt_versions=%, ai_runs=%',
    prompt_reference_count,
    run_reference_count;

  update public.prompt_versions
  set model_profile_id = null
  where model_profile_id = retired_profile_id;

  update public.ai_runs
  set model_profile_id = null
  where model_profile_id = retired_profile_id;

  delete from public.model_profiles
  where id = retired_profile_id;
end
$$;
