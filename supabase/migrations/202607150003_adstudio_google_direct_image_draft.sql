-- Fast customer generation uses Google's Gemini image API directly.
-- Retire the active Fal-hosted version in place so every runtime immediately
-- resolves the direct Google provider without a second clone path.
update public.model_profile_versions v
set
  provider = 'google',
  model = 'gemini-3.1-flash-image',
  input_usd_per_million_tokens = 0.5,
  output_usd_per_million_tokens = 3,
  image_usd_per_unit = 0.04,
  supports_structured_output = false,
  max_context_tokens = 131072
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_draft'
  and v.active_to is null;
