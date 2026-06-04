with primary_versions (
  profile_key,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens
) as (
  values
    ('cheap_draft_text', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0000, true, 128000),
    ('high_quality_strategy', 'openai', 'gpt-4.1', 2.0000, 8.0000, 0.0000, true, 128000),
    ('structured_json', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0000, true, 128000),
    ('vision_classification', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0100, true, 128000),
    ('image_draft', 'openai', 'gpt-image-1-mini', 0.0000, 0.0000, 0.0400, false, 16000),
    ('image_final', 'openai', 'gpt-image-1.5', 1.0000, 2.0000, 0.0785, false, 16000),
    ('compliance_review', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0000, true, 128000)
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
select
  mp.id,
  primary_versions.provider,
  primary_versions.model,
  primary_versions.input_usd_per_million_tokens,
  primary_versions.output_usd_per_million_tokens,
  primary_versions.image_usd_per_unit,
  primary_versions.supports_structured_output,
  primary_versions.max_context_tokens,
  now()
from primary_versions
join public.model_profiles mp on mp.key = primary_versions.profile_key
where not exists (
  select 1
  from public.model_profile_versions existing
  where existing.model_profile_id = mp.id
    and existing.active_to is null
);
