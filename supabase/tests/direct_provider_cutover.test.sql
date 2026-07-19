create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'adstudio_campaigns', 'generation_quality', 'campaigns persist their generation mode');
select col_not_null('public', 'adstudio_campaigns', 'generation_quality', 'generation mode is required');
select col_default_is('public', 'adstudio_campaigns', 'generation_quality', 'fast', 'new campaigns default to Fast');
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adstudio_campaigns'::regclass
      and conname = 'adstudio_campaigns_generation_quality_check'
  ),
  'generation mode is constrained to the supported values'
);

select is(
  (select count(*)::integer from public.model_profile_versions where active_to is null and provider not in ('openai', 'google')),
  0,
  'no unsupported provider has an active model profile version'
);

select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'cheap_draft_text' and v.active_to is null),
  'openai:gpt-4.1-mini',
  'cheap drafts use direct GPT-4.1 Mini'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'high_quality_strategy' and v.active_to is null),
  'openai:gpt-5.5',
  'strategy uses direct GPT-5.5'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'structured_json' and v.active_to is null),
  'openai:gpt-5.5',
  'structured output uses direct GPT-5.5'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'vision_classification' and v.active_to is null),
  'openai:gpt-5.5',
  'vision QA uses direct GPT-5.5'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'image_draft' and v.active_to is null),
  'google:gemini-3.1-flash-image',
  'draft images use direct Gemini 3.1 Flash Image'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'image_final' and v.active_to is null),
  'openai:gpt-image-2',
  'final images use direct GPT Image 2'
);
select is(
  (select provider || ':' || model from public.model_profile_versions v join public.model_profiles p on p.id = v.model_profile_id where p.key = 'compliance_review' and v.active_to is null),
  'openai:gpt-4.1-mini',
  'compliance uses direct GPT-4.1 Mini'
);

select * from finish();
