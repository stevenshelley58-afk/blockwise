-- Direct-provider cutover and AdStudio generation-mode persistence.

alter table public.adstudio_campaigns
  add column if not exists generation_quality text;

-- Existing campaigns were produced by the former final-quality edit path.
update public.adstudio_campaigns
set generation_quality = 'high'
where generation_quality is null;

alter table public.adstudio_campaigns
  alter column generation_quality set default 'fast',
  alter column generation_quality set not null;

alter table public.adstudio_campaigns
  drop constraint if exists adstudio_campaigns_generation_quality_check;

alter table public.adstudio_campaigns
  add constraint adstudio_campaigns_generation_quality_check
  check (generation_quality in ('fast', 'high'));

-- Keep the original immutable persistence function intact. This wrapper runs
-- the existing six-table transaction and persists the selected generation
-- mode in the same database transaction.
create or replace function public.adstudio_persist_campaign_pack_v2(
  brand_kit jsonb,
  campaign jsonb,
  variants jsonb,
  creatives jsonb,
  copy_packs jsonb,
  compliance jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.adstudio_persist_campaign_pack(
    brand_kit,
    campaign,
    variants,
    creatives,
    copy_packs,
    compliance
  );

  update public.adstudio_campaigns
  set generation_quality = campaign->>'generation_quality'
  where id = (campaign->>'id')::uuid
    and workspace_id = (campaign->>'workspace_id')::uuid;

  if not found then
    raise exception 'AdStudio campaign generation mode could not be persisted';
  end if;
end;
$$;

grant execute on function public.adstudio_persist_campaign_pack_v2(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.adstudio_persist_campaign_pack_v2(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

do $$
declare
  unsupported_active_count integer;
begin
  select count(*)
  into unsupported_active_count
  from public.model_profile_versions
  where active_to is null
    and provider not in ('openai', 'google');

  raise notice 'Closing % unsupported active model profile version(s)', unsupported_active_count;
end;
$$;

-- Fallback configuration is no longer executable. Version rows remain as
-- immutable history; only their active window is closed.
do $$
begin
  if to_regclass('public.model_fallbacks') is not null then
    execute 'delete from public.model_fallbacks';
  end if;
end;
$$;

update public.model_profile_versions
set active_to = now()
where active_to is null
  and provider not in ('openai', 'google');

update public.model_profile_versions v
set active_to = now()
from public.model_profiles mp
where v.model_profile_id = mp.id
  and v.active_to is null
  and mp.key in (
    'cheap_draft_text',
    'high_quality_strategy',
    'structured_json',
    'vision_classification',
    'image_draft',
    'image_final',
    'compliance_review'
  );

with canonical_versions (
  profile_key,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens
) as (
  values
    ('cheap_draft_text', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0000, true, 128000),
    ('high_quality_strategy', 'openai', 'gpt-5.5', 5.0000, 30.0000, 0.0000, true, 1050000),
    ('structured_json', 'openai', 'gpt-5.5', 5.0000, 30.0000, 0.0000, true, 1050000),
    ('vision_classification', 'openai', 'gpt-5.5', 5.0000, 30.0000, 0.0100, true, 1050000),
    ('image_draft', 'google', 'gemini-3.1-flash-image', 0.5000, 3.0000, 0.0400, false, 131072),
    ('image_final', 'openai', 'gpt-image-2', 5.0000, 30.0000, 0.2110, false, 16000),
    ('compliance_review', 'openai', 'gpt-4.1-mini', 0.4000, 1.6000, 0.0000, true, 128000)
)
insert into public.model_profile_versions (
  model_profile_id,
  provider,
  model,
  input_usd_per_million_tokens,
  output_usd_per_million_tokens,
  image_usd_per_unit,
  supports_structured_output,
  max_context_tokens,
  active_from
)
select
  mp.id,
  canonical.provider,
  canonical.model,
  canonical.input_usd_per_million_tokens,
  canonical.output_usd_per_million_tokens,
  canonical.image_usd_per_unit,
  canonical.supports_structured_output,
  canonical.max_context_tokens,
  now()
from canonical_versions canonical
join public.model_profiles mp on mp.key = canonical.profile_key;

-- Remove the retired broker from every active agent egress policy while
-- preserving the rest of each permission row.
do $$
begin
  if to_regclass('public.agent_permissions') is not null then
    execute $sql$
      update public.agent_permissions
      set allowed_outbound_domains = array_remove(allowed_outbound_domains, 'openrouter.ai')
      where 'openrouter.ai' = any(allowed_outbound_domains)
    $sql$;
  end if;
end;
$$;

do $$
declare
  retired_domain_present boolean := false;
begin
  if exists (
    select 1
    from public.model_profile_versions
    where active_to is null
      and provider not in ('openai', 'google')
  ) then
    raise exception 'Direct-provider cutover left an unsupported active model profile version';
  end if;

  if to_regclass('public.agent_permissions') is not null then
    execute $sql$
      select exists (
        select 1
        from public.agent_permissions
        where 'openrouter.ai' = any(allowed_outbound_domains)
      )
    $sql$ into retired_domain_present;
  end if;

  if retired_domain_present then
    raise exception 'Direct-provider cutover left the retired broker in an outbound policy';
  end if;
end;
$$;
