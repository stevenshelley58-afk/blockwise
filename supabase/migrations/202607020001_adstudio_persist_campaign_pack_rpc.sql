-- Transactional campaign-pack persistence.
--
-- persistAdStudioCampaignPack previously issued six sequential upserts from the
-- app; a mid-sequence failure left a partially written campaign (e.g. campaign
-- row + variants but no copy/compliance) with no rollback. This function runs
-- the same upserts inside one transaction: any failure rolls back everything.
--
-- SECURITY INVOKER: runs as the calling (authenticated) user so RLS policies
-- on every adstudio_* table still apply unchanged.

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
set search_path = public
as $$
begin
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
    workspace_id = excluded.workspace_id,
    source_type = excluded.source_type,
    source_url = excluded.source_url,
    business_name = excluded.business_name,
    market_country = excluded.market_country,
    market_region = excluded.market_region,
    identity_json = excluded.identity_json,
    logos_json = excluded.logos_json,
    colours_json = excluded.colours_json,
    typography_json = excluded.typography_json,
    tone_json = excluded.tone_json,
    visual_style_json = excluded.visual_style_json,
    compliance_json = excluded.compliance_json,
    contact_json = excluded.contact_json,
    review_status = excluded.review_status,
    locked_fields_json = excluded.locked_fields_json,
    created_by = excluded.created_by,
    updated_at = excluded.updated_at;

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
    workspace_id = excluded.workspace_id,
    brand_kit_id = excluded.brand_kit_id,
    name = excluded.name,
    goal = excluded.goal,
    market_json = excluded.market_json,
    audience_intent = excluded.audience_intent,
    offer_id = excluded.offer_id,
    template_key = excluded.template_key,
    template_source = excluded.template_source,
    source_observed_ad_id = excluded.source_observed_ad_id,
    template_snapshot_json = excluded.template_snapshot_json,
    platforms_json = excluded.platforms_json,
    creative_formats_json = excluded.creative_formats_json,
    status = excluded.status,
    created_by = excluded.created_by,
    updated_at = excluded.updated_at;

  insert into public.adstudio_campaign_variants (
    id, workspace_id, campaign_id, angle, headline, offer, cta, score_json,
    status, locked_fields_json, updated_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.angle, r.headline, r.offer, r.cta, r.score_json,
    r.status, r.locked_fields_json, r.updated_at
  from jsonb_populate_recordset(null::public.adstudio_campaign_variants, variants) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    campaign_id = excluded.campaign_id,
    angle = excluded.angle,
    headline = excluded.headline,
    offer = excluded.offer,
    cta = excluded.cta,
    score_json = excluded.score_json,
    status = excluded.status,
    locked_fields_json = excluded.locked_fields_json,
    updated_at = excluded.updated_at;

  insert into public.adstudio_creatives (
    id, workspace_id, campaign_id, variant_id, format, width, height,
    canvas_json, render_status, preview_svg, updated_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.variant_id, r.format, r.width, r.height,
    r.canvas_json, r.render_status, r.preview_svg, r.updated_at
  from jsonb_populate_recordset(null::public.adstudio_creatives, creatives) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    campaign_id = excluded.campaign_id,
    variant_id = excluded.variant_id,
    format = excluded.format,
    width = excluded.width,
    height = excluded.height,
    canvas_json = excluded.canvas_json,
    render_status = excluded.render_status,
    preview_svg = excluded.preview_svg,
    updated_at = excluded.updated_at;

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
    workspace_id = excluded.workspace_id,
    campaign_id = excluded.campaign_id,
    variant_id = excluded.variant_id,
    meta_json = excluded.meta_json,
    google_search_json = excluded.google_search_json,
    google_pmax_json = excluded.google_pmax_json,
    google_demand_gen_json = excluded.google_demand_gen_json,
    landing_page_json = excluded.landing_page_json,
    followup_json = excluded.followup_json,
    locked_fields_json = excluded.locked_fields_json,
    updated_at = excluded.updated_at;

  insert into public.adstudio_compliance_reports (
    id, workspace_id, campaign_id, status, issues_json, checked_at
  )
  select
    r.id, r.workspace_id, r.campaign_id, r.status, r.issues_json, r.checked_at
  from jsonb_populate_record(null::public.adstudio_compliance_reports, compliance) as r
  on conflict (id) do update set
    workspace_id = excluded.workspace_id,
    campaign_id = excluded.campaign_id,
    status = excluded.status,
    issues_json = excluded.issues_json,
    checked_at = excluded.checked_at;
end;
$$;

grant execute on function public.adstudio_persist_campaign_pack(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.adstudio_persist_campaign_pack(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
