-- Customer-selected Fast generation uses the benchmarked Gemini edit model.
-- High quality remains on image_final (GPT Image 2). Both choices still use
-- the same reference-clone request, persistence path, and QA gate.
update public.model_profile_versions v
set
  provider = 'fal',
  model = 'fal-ai/gemini-3.1-flash-image-preview/edit',
  input_usd_per_million_tokens = 0,
  output_usd_per_million_tokens = 0,
  image_usd_per_unit = 0.04,
  supports_structured_output = false,
  max_context_tokens = 65536
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_draft'
  and v.active_to is null;

update public.model_profiles
set task = 'Fast customer-ready reference-clone generation'
where key = 'image_draft';
