-- ============================================================================
-- PROPOSAL ONLY — changes LIVE image-generation behaviour. Do not run until
-- approved. This adds AU-augmented versions of the three governed image prompts
-- to public.prompt_versions as DRAFT, then (separately) promotes them to active.
--
-- Safer route: paste the three bodies from au-style-pack.md into your prompt-
-- governance/operator surface as new versions and use its promote action — that
-- wraps promote_global_prompt_version() with the right validation + audit.
--
-- These are GLOBAL prompts (workspace_id = NULL). Promoting affects every
-- workspace's image generation. Reversible via rollback_global_prompt_version().
-- ============================================================================

-- 1) Insert AU drafts at the next version per key -----------------------------
insert into public.prompt_versions (key, workspace_id, version, status, title, notes, system_prompt, metadata_json)
select v.key, null,
       coalesce((select max(p.version) from public.prompt_versions p where p.key = v.key), 0) + 1,
       'draft', 'AU style pack', 'Australian real-estate scene + anti-US cues. See au-style-pack.md.',
       v.body, '{}'::jsonb
from (values
  ('adstudio.image.system',
   $body$Create customer-facing real-estate ad imagery prompts. Follow brand and compliance constraints before customer input. Generate background and style instructions only; do not ask the image model to render final ad text, prices, claims, or guarantees.

All imagery is for the Australian residential real-estate market. Depict authentically Australian homes, streets, gardens and skies appropriate to the named suburb and state. Use natural, bright Australian daylight with a clear blue sky. Photoreal, editorial real-estate quality. Compose with clean copy-safe space (the renderer overlays the text). Never depict American houses, signage, mailboxes, flags or seasons.$body$),
  ('adstudio.image.brand_rules',
   $body$Brand image rules:
- Use the approved palette and visual treatment as constraints.
- Keep the image suitable for real-estate lead generation.
- Avoid logos or final ad text inside the generated image unless a provided reference asset already contains brand marks.
- Prefer natural light, clean composition, and space for ad copy overlays.

Australian scene rules:
- Homes: brick-veneer, weatherboard, rendered or Federation/Queenslander styles with Colorbond steel or tiled roofs, eaves, verandahs/alfresco. Match the region.
- Setting: native + established gardens (gum/eucalypt street trees, grasses, agapanthus), brick letterbox, harsh bright sun with deep shadows, clear blue sky. Cars on the left of the road.
- Signage: agency-style "For Sale"/"Sold" boards in brand colours — never US realtor yard signs.
- Prefer real supplied property/suburb photos as reference assets over fully synthetic homes.$body$),
  ('adstudio.image.negative_prompt',
   $body$Avoid: rendered text, distorted typography, misleading luxury claims, demographic targeting cues, before/after sale guarantees, cluttered compositions, low-resolution artifacts, warped buildings, distorted people, extra fingers, fake logos.

Also avoid (non-Australian cues): US-style mailboxes on posts, American realtor yard signs, US/foreign flags, white picket-fence Americana, HOA-style manicured lawns, autumn foliage or snow (unless alpine AU), Mediterranean/Spanish villas, Californian palm-lined streets (unless tropical QLD), left-hand-drive US street scenes, $ shown as USD.$body$)
) as v(key, body);

-- 2) Review the drafts --------------------------------------------------------
-- select key, version, status, left(system_prompt,60) from public.prompt_versions
-- where key like 'adstudio.image.%' order by key, version desc;

-- 3) Promote to active (run per key with the version from step 2) -------------
-- select public.promote_global_prompt_version('adstudio.image.system',        <version>);
-- select public.promote_global_prompt_version('adstudio.image.brand_rules',   <version>);
-- select public.promote_global_prompt_version('adstudio.image.negative_prompt',<version>);

-- Rollback if needed:
-- select public.rollback_global_prompt_version('adstudio.image.system', <previous_version>);
