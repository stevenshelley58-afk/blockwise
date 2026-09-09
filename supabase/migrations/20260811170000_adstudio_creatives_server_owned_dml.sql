begin;

-- Finished creative state is server-owned. RLS still scopes customer reads,
-- but table grants are the Data API boundary that prevents a signed-in browser
-- from replacing canvas_json, render_status, revision pointers, or any other
-- versioned field directly.
revoke insert, update, delete on table public.adstudio_creatives
  from public, anon, authenticated;
grant select on table public.adstudio_creatives to authenticated;
grant select, insert, update, delete on table public.adstudio_creatives to service_role;
grant select, insert, update on table
  public.adstudio_brand_kits,
  public.adstudio_campaigns,
  public.adstudio_campaign_variants,
  public.adstudio_platform_copy,
  public.adstudio_compliance_reports
to service_role;

drop policy if exists adstudio_workspace_insert on public.adstudio_creatives;
drop policy if exists adstudio_workspace_update on public.adstudio_creatives;
drop policy if exists adstudio_workspace_delete on public.adstudio_creatives;

-- Service role bypasses RLS, so the transaction itself must establish the one
-- workspace/campaign graph it is allowed to write before touching any row.
create or replace function public.adstudio_persist_campaign_pack(
  brand_kit jsonb,
  campaign jsonb,
  variants jsonb,
  creatives jsonb,
  copy_packs jsonb,
  compliance jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid := nullif(brand_kit ->> 'workspace_id', '')::uuid;
  v_brand_kit_id uuid := nullif(brand_kit ->> 'id', '')::uuid;
  v_campaign_id uuid := nullif(campaign ->> 'id', '')::uuid;
begin
  if v_workspace_id is null
    or v_brand_kit_id is null
    or v_campaign_id is null
    or nullif(campaign ->> 'workspace_id', '')::uuid is distinct from v_workspace_id
    or nullif(campaign ->> 'brand_kit_id', '')::uuid is distinct from v_brand_kit_id
    or jsonb_typeof(variants) is distinct from 'array'
    or jsonb_typeof(creatives) is distinct from 'array'
    or jsonb_typeof(copy_packs) is distinct from 'array'
    or nullif(compliance ->> 'id', '')::uuid is null
    or nullif(compliance ->> 'workspace_id', '')::uuid is distinct from v_workspace_id
    or nullif(compliance ->> 'campaign_id', '')::uuid is distinct from v_campaign_id
  then
    raise exception using
      errcode = '22023',
      message = 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
      detail = 'The pack root records do not share one workspace, brand kit, and campaign.';
  end if;

  if exists (
    select 1
    from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as r
    where r.id is null
      or r.workspace_id is distinct from v_workspace_id
      or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1
    from jsonb_populate_recordset(null::public.adstudio_creatives, creatives) as r
    where r.id is null
      or r.workspace_id is distinct from v_workspace_id
      or r.campaign_id is distinct from v_campaign_id
      or r.variant_id is null
      or not exists (
        select 1
        from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as v
        where v.id = r.variant_id
      )
  ) or exists (
    select 1
    from jsonb_populate_recordset(null::public.adstudio_platform_copy, copy_packs) as r
    where r.id is null
      or r.workspace_id is distinct from v_workspace_id
      or r.campaign_id is distinct from v_campaign_id
      or (
        r.variant_id is not null
        and not exists (
          select 1
          from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as v
          where v.id = r.variant_id
        )
      )
  ) or (
    nullif(compliance ->> 'variant_id', '')::uuid is not null
    and not exists (
      select 1
      from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as v
      where v.id = nullif(compliance ->> 'variant_id', '')::uuid
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
      detail = 'Every child must belong to the canonical campaign and reference a variant in this pack.';
  end if;

  -- Refuse to re-home any globally identified row. Child IDs are additionally
  -- pinned to their existing campaign, so a service call cannot move records
  -- between campaigns inside the same workspace either.
  if exists (
    select 1 from public.adstudio_brand_kits r
    where r.id = v_brand_kit_id and r.workspace_id is distinct from v_workspace_id
  ) or exists (
    select 1 from public.adstudio_campaigns r
    where r.id = v_campaign_id and r.workspace_id is distinct from v_workspace_id
  ) or exists (
    select 1
    from public.adstudio_campaign_variants r
    join jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1
    from public.adstudio_creatives r
    join jsonb_populate_recordset(null::public.adstudio_creatives, creatives) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1
    from public.adstudio_platform_copy r
    join jsonb_populate_recordset(null::public.adstudio_platform_copy, copy_packs) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1 from public.adstudio_compliance_reports r
    where r.id = nullif(compliance ->> 'id', '')::uuid
      and (r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
      detail = 'At least one supplied ID is already owned by another workspace or campaign.';
  end if;

  insert into public.adstudio_brand_kits (
    id, workspace_id, source_type, source_url, business_name, market_country,
    market_region, identity_json, logos_json, colours_json, typography_json,
    tone_json, visual_style_json, compliance_json, contact_json, review_status,
    locked_fields_json, created_by, updated_at
  )
  select
    r.id, r.workspace_id, r.source_type, r.source_url, r.business_name, r.market_country,
    r.market_region, r.identity_json, r.logos_json, r.colours_json, r.typography_json,
    r.tone_json, r.visual_style_json, r.compliance_json, r.contact_json, r.review_status,
    r.locked_fields_json, r.created_by, r.updated_at
  from jsonb_populate_record(null::public.adstudio_brand_kits, brand_kit) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, source_type = excluded.source_type,
    source_url = excluded.source_url, business_name = excluded.business_name,
    market_country = excluded.market_country, market_region = excluded.market_region,
    identity_json = excluded.identity_json, logos_json = excluded.logos_json,
    colours_json = excluded.colours_json, typography_json = excluded.typography_json,
    tone_json = excluded.tone_json, visual_style_json = excluded.visual_style_json,
    compliance_json = excluded.compliance_json, contact_json = excluded.contact_json,
    review_status = excluded.review_status, locked_fields_json = excluded.locked_fields_json,
    created_by = excluded.created_by, updated_at = excluded.updated_at
  where adstudio_brand_kits.workspace_id = excluded.workspace_id;

  insert into public.adstudio_campaigns (
    id, workspace_id, brand_kit_id, name, goal, market_json, audience_intent,
    offer_id, template_key, template_source, source_observed_ad_id,
    template_snapshot_json, platforms_json, creative_formats_json, status,
    created_by, updated_at
  )
  select
    r.id, r.workspace_id, r.brand_kit_id, r.name, r.goal, r.market_json, r.audience_intent,
    r.offer_id, r.template_key, r.template_source, r.source_observed_ad_id,
    r.template_snapshot_json, r.platforms_json, r.creative_formats_json, r.status,
    r.created_by, r.updated_at
  from jsonb_populate_record(null::public.adstudio_campaigns, campaign) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, brand_kit_id = excluded.brand_kit_id,
    name = excluded.name, goal = excluded.goal, market_json = excluded.market_json,
    audience_intent = excluded.audience_intent, offer_id = excluded.offer_id,
    template_key = excluded.template_key, template_source = excluded.template_source,
    source_observed_ad_id = excluded.source_observed_ad_id,
    template_snapshot_json = excluded.template_snapshot_json,
    platforms_json = excluded.platforms_json,
    creative_formats_json = excluded.creative_formats_json, status = excluded.status,
    created_by = excluded.created_by, updated_at = excluded.updated_at
  where adstudio_campaigns.workspace_id = excluded.workspace_id;

  insert into public.adstudio_campaign_variants (
    id, workspace_id, campaign_id, angle, headline, offer, cta, score_json,
    status, locked_fields_json, updated_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.angle, r.headline, r.offer, r.cta,
    r.score_json, r.status, r.locked_fields_json, r.updated_at
  from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, campaign_id = excluded.campaign_id,
    angle = excluded.angle, headline = excluded.headline, offer = excluded.offer,
    cta = excluded.cta, score_json = excluded.score_json, status = excluded.status,
    locked_fields_json = excluded.locked_fields_json, updated_at = excluded.updated_at
  where adstudio_campaign_variants.workspace_id = excluded.workspace_id
    and adstudio_campaign_variants.campaign_id = excluded.campaign_id;

  insert into public.adstudio_creatives (
    id, workspace_id, campaign_id, variant_id, format, width, height,
    canvas_json, render_status, preview_svg, updated_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.variant_id, r.format, r.width, r.height,
    r.canvas_json, r.render_status, r.preview_svg, r.updated_at
  from jsonb_populate_recordset(null::public.adstudio_creatives, creatives) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, campaign_id = excluded.campaign_id,
    variant_id = excluded.variant_id, format = excluded.format, width = excluded.width,
    height = excluded.height, canvas_json = excluded.canvas_json,
    render_status = excluded.render_status, preview_svg = excluded.preview_svg,
    updated_at = excluded.updated_at
  where adstudio_creatives.workspace_id = excluded.workspace_id
    and adstudio_creatives.campaign_id = excluded.campaign_id;

  insert into public.adstudio_platform_copy (
    id, workspace_id, campaign_id, variant_id, meta_json, google_search_json,
    google_pmax_json, google_demand_gen_json, landing_page_json, followup_json,
    locked_fields_json, updated_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.variant_id, r.meta_json, r.google_search_json,
    r.google_pmax_json, r.google_demand_gen_json, r.landing_page_json, r.followup_json,
    r.locked_fields_json, r.updated_at
  from jsonb_populate_recordset(null::public.adstudio_platform_copy, copy_packs) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, campaign_id = excluded.campaign_id,
    variant_id = excluded.variant_id, meta_json = excluded.meta_json,
    google_search_json = excluded.google_search_json,
    google_pmax_json = excluded.google_pmax_json,
    google_demand_gen_json = excluded.google_demand_gen_json,
    landing_page_json = excluded.landing_page_json, followup_json = excluded.followup_json,
    locked_fields_json = excluded.locked_fields_json, updated_at = excluded.updated_at
  where adstudio_platform_copy.workspace_id = excluded.workspace_id
    and adstudio_platform_copy.campaign_id = excluded.campaign_id;

  insert into public.adstudio_compliance_reports (
    id, workspace_id, campaign_id, variant_id, status, issues_json, checked_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.variant_id, r.status, r.issues_json, r.checked_at
  from jsonb_populate_record(null::public.adstudio_compliance_reports, compliance) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id, campaign_id = excluded.campaign_id,
    variant_id = excluded.variant_id, status = excluded.status,
    issues_json = excluded.issues_json, checked_at = excluded.checked_at
  where adstudio_compliance_reports.workspace_id = excluded.workspace_id
    and adstudio_compliance_reports.campaign_id = excluded.campaign_id;

  -- The predicates above keep ON CONFLICT from rewriting an owner that became
  -- visible after the preflight checks. Re-check under the statement locks so
  -- a concurrent colliding pack fails instead of succeeding with skipped rows.
  if exists (
    select 1 from public.adstudio_brand_kits r
    where r.id = v_brand_kit_id and r.workspace_id is distinct from v_workspace_id
  ) or exists (
    select 1 from public.adstudio_campaigns r
    where r.id = v_campaign_id and r.workspace_id is distinct from v_workspace_id
  ) or exists (
    select 1
    from public.adstudio_campaign_variants r
    join jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1
    from public.adstudio_creatives r
    join jsonb_populate_recordset(null::public.adstudio_creatives, creatives) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1
    from public.adstudio_platform_copy r
    join jsonb_populate_recordset(null::public.adstudio_platform_copy, copy_packs) as incoming on incoming.id = r.id
    where r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id
  ) or exists (
    select 1 from public.adstudio_compliance_reports r
    where r.id = nullif(compliance ->> 'id', '')::uuid
      and (r.workspace_id is distinct from v_workspace_id or r.campaign_id is distinct from v_campaign_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
      detail = 'A supplied ID became owned by another workspace or campaign during persistence.';
  end if;
end;
$$;

-- This transactional helper accepts an entire creative recordset, including
-- canvas_json. It is therefore the same mutation boundary as direct table DML
-- and may only be invoked by an already-authorized server path.
revoke all on function public.adstudio_persist_campaign_pack(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.adstudio_persist_campaign_pack(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

comment on table public.adstudio_creatives is
  'Customer-readable finished creative state. All inserts, updates, deletes, and whole-pack persistence are server-only.';

commit;
