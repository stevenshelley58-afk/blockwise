update public.model_profile_versions v
set
  provider = 'openai',
  model = 'gpt-image-2',
  input_usd_per_million_tokens = 5.0000,
  output_usd_per_million_tokens = 30.0000,
  image_usd_per_unit = 0.2110,
  max_context_tokens = 16000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_final'
  and v.active_to is null
  and v.provider = 'openai'
  and v.model = 'gpt-image-1.5';

update public.model_profile_versions v
set
  provider = 'openai',
  model = 'gpt-5.5',
  input_usd_per_million_tokens = 5.0000,
  output_usd_per_million_tokens = 30.0000,
  max_context_tokens = 1000000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'high_quality_strategy'
  and v.active_to is null
  and v.provider = 'openai'
  and v.model = 'gpt-4.1';;
