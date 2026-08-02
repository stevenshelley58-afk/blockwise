-- Use Gemini 3.1 Flash Image for client-ready AdStudio renders; it supports
-- Blockwise's multi-reference clone request at materially lower cost, while
-- the application keeps GPT Image 2 as a provider-diverse runtime fallback.
update public.model_profile_versions v
set
  provider = 'google',
  model = 'gemini-3.1-flash-image',
  input_usd_per_million_tokens = 0.5,
  output_usd_per_million_tokens = 3,
  image_usd_per_unit = 0.067,
  supports_structured_output = false,
  max_context_tokens = 131072
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_final'
  and v.active_to is null;

-- Production may legitimately have no persisted final-image override. Seed
-- one when absent so the runtime switch does not depend on the app deploy
-- reaching every instance before the control-plane selection is authoritative.
insert into public.model_profile_versions (
  model_profile_id,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens
)
select
  mp.id,
  'google',
  'gemini-3.1-flash-image',
  0.5,
  3,
  0.067,
  false,
  131072
from public.model_profiles mp
where mp.key = 'image_final'
  and not exists (
    select 1
    from public.model_profile_versions v
    where v.model_profile_id = mp.id
      and v.active_to is null
  );

-- Keep draft accounting aligned because it uses the same 1K image output.
update public.model_profile_versions v
set image_usd_per_unit = 0.067
from public.model_profiles mp
where v.model_profile_id = mp.id
  and mp.key = 'image_draft'
  and v.active_to is null
  and v.provider = 'google'
  and v.model = 'gemini-3.1-flash-image';
