-- Move the untouched seeded cheap-copy primary to the code-declared DeepSeek
-- default. An operator-selected primary is authoritative: this migration does
-- nothing unless the original gpt-4.1-mini seed is the profile's sole active
-- version with its exact seeded pricing and capability snapshot.
with eligible_seed as materialized (
  select version.id, version.model_profile_id
  from public.model_profile_versions version
  join public.model_profiles profile on profile.id = version.model_profile_id
  where profile.key = 'cheap_draft_text'
    and version.active_to is null
    and version.provider = 'openai'
    and version.model = 'gpt-4.1-mini'
    and version.input_usd_per_million_tokens = 0.4000
    and version.output_usd_per_million_tokens = 1.6000
    and version.image_usd_per_unit = 0.0000
    and version.supports_structured_output is true
    and version.max_context_tokens = 128000
    and not exists (
      select 1
      from public.model_profile_versions other_active
      where other_active.model_profile_id = version.model_profile_id
        and other_active.active_to is null
        and other_active.id <> version.id
    )
),
closed_seed as (
  update public.model_profile_versions current_version
  set active_to = statement_timestamp()
  from eligible_seed
  where current_version.id = eligible_seed.id
    and current_version.active_to is null
  returning current_version.model_profile_id
)
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
select distinct
  model_profile_id,
  'deepseek',
  'deepseek-chat',
  0.2700,
  1.1000,
  0.0000,
  true,
  128000,
  statement_timestamp()
from closed_seed;
