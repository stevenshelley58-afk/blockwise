-- Customer-facing finished ads use the professional image model. Draft and
-- internal exploration remain on Flash so iteration stays economical.
with final_profile as (
  select id
  from public.model_profiles
  where key = 'image_final'
)
update public.model_profile_versions
set active_to = now()
where model_profile_id in (select id from final_profile)
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
  'google',
  'gemini-3-pro-image',
  2,
  12,
  0.134,
  false,
  65536,
  now()
from public.model_profiles
where key = 'image_final';
