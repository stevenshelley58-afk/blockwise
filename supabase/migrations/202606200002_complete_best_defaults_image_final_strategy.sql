-- WS3 follow-up: finish best-by-default for the remaining quality stages whose
-- SEEDED production version still pinned the older/cheaper model and therefore
-- overrode the (best) code default.
--   - image_final: the §2 image fit/extend stage (and the WS1 edits path) was
--     seeded to gpt-image-1.5; promote to gpt-image-2 (current best).
--   - high_quality_strategy: seeded to gpt-4.1; promote to gpt-5.5.
-- Guarded to only touch versions still at the original seed value, so a
-- deliberate operator choice is never clobbered. Cost-tune later in the console.
-- The deliberately cost-efficient profiles (cheap_draft_text, image_draft,
-- compliance_review) are intentionally left as-is.

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
  and v.model = 'gpt-4.1';
