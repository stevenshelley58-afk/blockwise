-- WS3: operator per-stage model control + best-by-default models.
--
-- 1. Register the new "image_generative" stage profile so the operator console
--    can list and persist overrides for the "Create more options" generative
--    route. (Defaults come from code; this row just makes saves possible.)
-- 2. Promote the seeded copy/vision defaults from the initial cheap model to the
--    best current model (gpt-5.5), but ONLY where the active version is still the
--    original gpt-4.1-mini seed — so a deliberate operator choice is never
--    clobbered. Cost-tune later in the console.

insert into public.model_profiles (key, name, task, enabled, requires_structured_output, default_temperature, max_run_cost_cents)
values
  ('image_generative', 'Image generative', 'Fully generative ad creatives ("Create more options")', true, false, 0.85, 250)
on conflict (key) do nothing;

-- Promote copy (structured_json) to the best text model, preserving operator overrides.
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

-- Promote vision QA (vision_classification) to the best vision-capable model.
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
  and v.model = 'gpt-4.1-mini';
