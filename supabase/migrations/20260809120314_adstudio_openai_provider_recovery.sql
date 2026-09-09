-- Keep professional client renders and visual QA available while the Google
-- prepaid account is depleted. Draft generation remains on the economical
-- Google profile and each rotated profile retains its code-declared Google
-- fallback for independent recovery after the account is replenished.
with recovered_profiles as (
  select id
  from public.model_profiles
  where key in ('image_final', 'vision_classification')
)
update public.model_profile_versions
set active_to = now()
where model_profile_id in (select id from recovered_profiles)
  and active_to is null;

insert into public.model_profile_versions (
  model_profile_id,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens,
  active_from
)
select
  id,
  'openai',
  'gpt-image-2',
  5,
  30,
  0.211,
  false,
  16000,
  now()
from public.model_profiles
where key = 'image_final'
union all
select
  id,
  'openai',
  'gpt-5.5',
  5,
  30,
  0.01,
  true,
  1000000,
  now()
from public.model_profiles
where key = 'vision_classification';
