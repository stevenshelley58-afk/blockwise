-- The customer generation pipeline runs one structured copy pass before the
-- selected image model. Production still had the 2 July OpenRouter override,
-- so depleted OpenRouter credits blocked both Fast and High quality before
-- either image provider ran. Restore the declared direct-provider default,
-- guarded to the exact stale override so later operator choices are preserved.
update public.model_profile_versions v
set
  provider = 'openai',
  model = 'gpt-5.5',
  input_usd_per_million_tokens = 5.0000,
  output_usd_per_million_tokens = 30.0000,
  image_usd_per_unit = 0,
  supports_structured_output = true,
  max_context_tokens = 1000000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'structured_json'
  and v.active_to is null
  and v.provider = 'openrouter'
  and v.model = 'openai/gpt-4.1-mini';
