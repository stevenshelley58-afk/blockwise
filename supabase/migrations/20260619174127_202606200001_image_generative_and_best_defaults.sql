-- WS3: register image_generative profile + promote seeded copy/vision defaults to best.
insert into public.model_profiles (key, name, task, enabled, requires_structured_output, default_temperature, max_run_cost_cents)
values
  ('image_generative', 'Image generative', 'Fully generative ad creatives ("Create more options")', true, false, 0.85, 250)
on conflict (key) do nothing;

update public.model_profile_versions v
set
  provider = 'openai',
  model = 'gpt-5.5',
  input_usd_per_million_tokens = 5.0000,
  output_usd_per_million_tokens = 30.0000,
  max_context_tokens = 1000000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'structured_json'
  and v.active_to is null
  and v.provider = 'openai'
  and v.model = 'gpt-4.1-mini';

update public.model_profile_versions v
set
  provider = 'openai',
  model = 'gpt-5.5',
  input_usd_per_million_tokens = 5.0000,
  output_usd_per_million_tokens = 30.0000,
  max_context_tokens = 1000000
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'vision_classification'
  and v.active_to is null
  and v.provider = 'openai'
  and v.model = 'gpt-4.1-mini';;
