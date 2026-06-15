-- First-pass Ad Studio template launch.
--
-- Makes the selected template traceable on generated campaigns and seeds the
-- first 10 approved, operator-authored template skeletons so the picker has
-- useful live rows even before every archetype has mined winner evidence.

begin;

alter table if exists public.adstudio_campaigns
  add column if not exists template_key text,
  add column if not exists template_source text,
  add column if not exists source_observed_ad_id uuid,
  add column if not exists template_snapshot_json jsonb not null default '{}'::jsonb;

alter table if exists public.adstudio_campaigns
  drop constraint if exists adstudio_campaigns_template_snapshot_json_check,
  add constraint adstudio_campaigns_template_snapshot_json_check
    check (jsonb_typeof(template_snapshot_json) = 'object');

create index if not exists adstudio_campaigns_workspace_template_idx
  on public.adstudio_campaigns (workspace_id, template_key, created_at desc)
  where template_key is not null;

comment on column public.adstudio_campaigns.template_key is
  'Ad Studio template key selected at generation time. Used for publish tags and performance feedback.';
comment on column public.adstudio_campaigns.template_source is
  'Template source at generation time: builtin, operator, radar, or ad_radar.';
comment on column public.adstudio_campaigns.source_observed_ad_id is
  'Optional observed ad exemplar behind the selected template or Ad Radar handoff.';
comment on column public.adstudio_campaigns.template_snapshot_json is
  'Snapshot of the resolved template contract used to generate the campaign.';

create temporary table adstudio_first_pass_templates (
  template_key text primary key,
  name text not null,
  goal text not null,
  offer_id text not null,
  category text not null,
  hook_style text not null,
  funnel_stage text not null,
  headline text not null,
  primary_text text not null,
  description text not null,
  cta text not null,
  variables text[] not null,
  concept text not null,
  layout text not null,
  imagery text not null,
  palette text not null,
  text_rules text not null,
  ai_prompt_seed text not null,
  skeleton jsonb not null
) on commit drop;

insert into adstudio_first_pass_templates (
  template_key,
  name,
  goal,
  offer_id,
  category,
  hook_style,
  funnel_stage,
  headline,
  primary_text,
  description,
  cta,
  variables,
  concept,
  layout,
  imagery,
  palette,
  text_rules,
  ai_prompt_seed,
  skeleton
)
values
  (
    'just_listed',
    'Just Listed',
    'seller_leads',
    'home_value_update',
    'listing',
    'fresh_listing',
    'consideration',
    'Just listed in {suburb}',
    'Promote a newly listed property and invite nearby owners to compare their own home.',
    'Fresh local listing context for owners.',
    'See the home',
    array['suburb','property_type','bedrooms','street'],
    'New listing announcement that converts the property into local seller context.',
    'Hero property image with lower-left headline panel and CTA band.',
    'Use the customer listing photo as the property hero; keep facade or main room clear of text.',
    'Brand primary, warm neutral, white.',
    'Large badge plus short headline; no price or sale-outcome claims.',
    'Create a Just Listed real-estate ad using the customer photo, selected skeleton, brand kit, and brief.',
    '{"version":1,"archetype":"listing_hero","shot":{"type":"front exterior or hero listing image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"property facade in upper or centre-right frame","horizon":"middle","copy_safe_zones":[{"id":"headline_panel","x":0.06,"y":0.58,"width":0.62,"height":0.25,"priority":"primary"},{"id":"cta_band","x":0.06,"y":0.84,"width":0.44,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","warm neutral","white"],"overlay":"dark copy scrim behind text only","contrast":"high"},"text_system":{"headline_zone":"large lower-left headline panel","badge":"Just Listed badge above headline","cta_style":"solid brand CTA aligned to headline"},"copy":{"hook_style":"fresh listing announcement","headline_pattern":"Just listed in {suburb}","cta":"See the home"},"variables":["suburb","property_type","bedrooms","street"],"confidence":58}'::jsonb
  ),
  (
    'coming_soon',
    'Coming Soon',
    'seller_leads',
    'home_value_update',
    'listing',
    'teaser',
    'awareness',
    'Coming soon to {suburb}',
    'Tease an upcoming campaign and invite locals to register interest before launch.',
    'A new local campaign is close.',
    'Get first look',
    array['suburb','launch_timing','property_type'],
    'Pre-launch teaser that builds attention without inventing scarcity.',
    'Upper announcement band over a property-detail or lifestyle crop.',
    'Use a crop from the customer listing photo or an approved property detail.',
    'Brand primary, muted charcoal, accent.',
    'Teaser headline with restrained CTA; no unsupported exclusivity claims.',
    'Create a Coming Soon ad from the customer media and brief, preserving copy-safe zones.',
    '{"version":1,"archetype":"coming_soon","shot":{"type":"teaser crop of property detail or lifestyle feature","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"property detail in lower-right or centre frame","horizon":"none","copy_safe_zones":[{"id":"announcement_band","x":0.08,"y":0.26,"width":0.72,"height":0.24,"priority":"primary"},{"id":"cta_band","x":0.08,"y":0.54,"width":0.42,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","muted charcoal","accent"],"overlay":"brand tint over image with clean contrast","contrast":"high"},"text_system":{"headline_zone":"upper announcement band","badge":"Coming Soon announcement band","cta_style":"solid brand CTA beneath band"},"copy":{"hook_style":"pre-launch teaser","headline_pattern":"Coming soon to {suburb}","cta":"Get first look"},"variables":["suburb","launch_timing","property_type"],"confidence":58}'::jsonb
  ),
  (
    'new_to_market',
    'New To Market',
    'seller_leads',
    'recent_sales_report',
    'listing',
    'market_activity',
    'consideration',
    'New to market in {suburb}',
    'Announce fresh local activity and prompt owners to check recent sales context.',
    'Fresh local market activity.',
    'See recent sales',
    array['suburb','local_area','property_type'],
    'Fresh listing signal positioned as local market context for homeowners.',
    'Hero property visual with lower-left headline and CTA.',
    'Use the customer property photo; leave lower-left copy zone clean.',
    'Brand primary, white, fresh green.',
    'Short market-activity headline and report CTA.',
    'Create a New To Market ad using the customer image and brief.',
    '{"version":1,"archetype":"listing_hero","shot":{"type":"fresh listing hero image with strong street or interior feature","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"home feature on the right half of frame","horizon":"middle","copy_safe_zones":[{"id":"headline_panel","x":0.07,"y":0.55,"width":0.6,"height":0.26,"priority":"primary"},{"id":"cta_band","x":0.07,"y":0.83,"width":0.46,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","white","fresh green"],"overlay":"dark lower copy scrim only","contrast":"high"},"text_system":{"headline_zone":"lower-left headline panel","badge":"New To Market label","cta_style":"solid brand CTA"},"copy":{"hook_style":"fresh market activity","headline_pattern":"New to market in {suburb}","cta":"See recent sales"},"variables":["suburb","local_area","property_type"],"confidence":58}'::jsonb
  ),
  (
    'open_home',
    'Open Home',
    'open_home_followup',
    'open_home_followup',
    'listing',
    'inspection',
    'high_intent',
    'Open home {day} in {suburb}',
    'Promote inspection interest with practical details and a simple enquiry path.',
    'Inspect with clearer next steps.',
    'Plan your visit',
    array['suburb','day','time','address'],
    'Inspection-focused template with date/time clarity.',
    'Property image with central-left details panel and CTA.',
    'Use inviting exterior, entry, kitchen, or living image from customer media.',
    'Brand primary, white, accent.',
    'Date/time badge plus headline; details must remain readable.',
    'Create an Open Home ad from the supplied property photo and inspection brief.',
    '{"version":1,"archetype":"open_home","shot":{"type":"inviting exterior, entry, kitchen, or living image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"main room or facade kept clear of details panel","horizon":"middle","copy_safe_zones":[{"id":"details_panel","x":0.08,"y":0.42,"width":0.64,"height":0.3,"priority":"primary"},{"id":"cta_band","x":0.08,"y":0.74,"width":0.42,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","white","accent"],"overlay":"semi-opaque details panel","contrast":"high"},"text_system":{"headline_zone":"open-home details panel","badge":"Open Home date/time badge","cta_style":"solid brand CTA beneath details"},"copy":{"hook_style":"inspection invite","headline_pattern":"Open home {day} in {suburb}","cta":"Plan your visit"},"variables":["suburb","day","time","address"],"confidence":58}'::jsonb
  ),
  (
    'just_sold',
    'Just Sold',
    'seller_leads',
    'recent_sales_report',
    'proof',
    'recent_result',
    'consideration',
    'Just sold in {suburb}',
    'Use a recent sale as local proof and invite nearby owners to understand their position.',
    'Local result context for owners.',
    'Get local context',
    array['suburb','sale_result','property_type'],
    'Recent sale proof frame with conservative outcome wording.',
    'Sold ribbon plus lower copy panel over property hero.',
    'Use sold property image or customer-supplied relevant property media.',
    'Brand primary, deep charcoal, white.',
    'Sold ribbon, concise headline, conservative CTA.',
    'Create a Just Sold ad using the customer media and compliant brief.',
    '{"version":1,"archetype":"just_sold","shot":{"type":"sold property exterior or hero image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"property result visual away from sold ribbon","horizon":"middle","copy_safe_zones":[{"id":"sold_ribbon","x":0.07,"y":0.18,"width":0.42,"height":0.09,"priority":"secondary"},{"id":"headline_panel","x":0.07,"y":0.58,"width":0.64,"height":0.24,"priority":"primary"},{"id":"cta_band","x":0.07,"y":0.84,"width":0.46,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","deep charcoal","white"],"overlay":"lower dark panel and sold ribbon","contrast":"high"},"text_system":{"headline_zone":"lower headline panel","badge":"Just Sold ribbon","cta_style":"solid brand CTA"},"copy":{"hook_style":"recent result proof","headline_pattern":"Just sold in {suburb}","cta":"Get local context"},"variables":["suburb","sale_result","property_type"],"confidence":58}'::jsonb
  ),
  (
    'price_update',
    'Price Update',
    'appraisal_bookings',
    'home_value_update',
    'appraisal',
    'value_question',
    'conversion',
    'What could your {suburb} home be worth?',
    'Offer a practical home value update without making performance guarantees.',
    'A practical local price update.',
    'Get a price update',
    array['suburb','property_type'],
    'Value-question template for homeowners considering options.',
    'Right-side value panel over calm property image.',
    'Use customer property media or approved home detail; keep right panel clear.',
    'Brand primary, soft neutral, white.',
    'Question headline, no guaranteed value or result claims.',
    'Create a Price Update ad using the supplied media and owner brief.',
    '{"version":1,"archetype":"appraisal","shot":{"type":"clean owner-focused home image or calm property detail","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"home detail on left or centre with copy on right","horizon":"middle","copy_safe_zones":[{"id":"value_panel","x":0.45,"y":0.42,"width":0.48,"height":0.3,"priority":"primary"},{"id":"cta_band","x":0.45,"y":0.75,"width":0.38,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","soft neutral","white"],"overlay":"right-side value panel","contrast":"high"},"text_system":{"headline_zone":"right value panel","badge":"Price Update value panel","cta_style":"solid brand CTA"},"copy":{"hook_style":"value question","headline_pattern":"What could your {suburb} home be worth?","cta":"Get a price update"},"variables":["suburb","property_type"],"confidence":58}'::jsonb
  ),
  (
    'market_update',
    'Market Update',
    'market_update_leads',
    'suburb_market_report',
    'market',
    'local_stats',
    'consideration',
    '{suburb} market update',
    'Share useful suburb market context for homeowners considering their next move.',
    'A plain-English local update.',
    'Get the report',
    array['suburb','period','metric'],
    'Market report template with a stat-style right panel.',
    'Local visual on left, structured market panel on right.',
    'Use suburb lifestyle, streetscape, or customer-supplied local context image.',
    'Brand primary, white, data accent.',
    'Keep stats conservative and sourced from the customer brief.',
    'Create a Market Update ad grounded in the provided market brief and media.',
    '{"version":1,"archetype":"market_stat","shot":{"type":"suburb lifestyle, streetscape, or map-like local context image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"local area visual on left, stats panel on right","horizon":"high","copy_safe_zones":[{"id":"market_panel","x":0.48,"y":0.28,"width":0.44,"height":0.38,"priority":"primary"},{"id":"cta_band","x":0.48,"y":0.7,"width":0.36,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","white","data accent"],"overlay":"right stat panel","contrast":"high"},"text_system":{"headline_zone":"right market-stat panel","badge":"Market Update stat panel","cta_style":"solid brand CTA"},"copy":{"hook_style":"local market update","headline_pattern":"{suburb} market update","cta":"Get the report"},"variables":["suburb","period","metric"],"confidence":58}'::jsonb
  ),
  (
    'free_appraisal',
    'Free Appraisal',
    'appraisal_bookings',
    'home_value_update',
    'appraisal',
    'direct_offer',
    'conversion',
    'Free appraisal for {suburb} owners',
    'Invite owners to request a no-pressure local price update.',
    'A practical local appraisal offer.',
    'Book free appraisal',
    array['suburb','property_type'],
    'Direct appraisal booking template with low-pressure framing.',
    'Agent or property visual with right-side offer panel.',
    'Use customer property media, office/headshot, or approved brand image.',
    'Brand primary, white, accent.',
    'Offer panel must avoid guaranteed sale or value outcomes.',
    'Create a Free Appraisal ad using the customer media and brand kit.',
    '{"version":1,"archetype":"appraisal","shot":{"type":"approachable agent, home exterior, or owner-friendly property image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"agent or property image away from right-side value panel","horizon":"middle","copy_safe_zones":[{"id":"appraisal_panel","x":0.47,"y":0.4,"width":0.45,"height":0.32,"priority":"primary"},{"id":"cta_band","x":0.47,"y":0.75,"width":0.38,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","white","accent"],"overlay":"right offer panel","contrast":"high"},"text_system":{"headline_zone":"right appraisal panel","badge":"Free Appraisal offer panel","cta_style":"solid brand CTA"},"copy":{"hook_style":"direct appraisal offer","headline_pattern":"Free appraisal for {suburb} owners","cta":"Book free appraisal"},"variables":["suburb","property_type"],"confidence":58}'::jsonb
  ),
  (
    'buyer_demand',
    'Buyer Demand',
    'seller_leads',
    'home_value_update',
    'proof',
    'buyer_signal',
    'consideration',
    'Buyer demand in {suburb}',
    'Explain local buyer demand carefully without over-claiming results.',
    'Local enquiry context without the hype.',
    'Check buyer demand',
    array['suburb','buyer_type','property_type'],
    'Buyer-demand signal template that stays compliant by avoiding guarantees.',
    'Proof-style panel over buyer activity or property image.',
    'Use customer media; do not invent queues, buyers, or demand metrics.',
    'Brand primary, white, signal accent.',
    'Proof badge plus conservative demand headline.',
    'Create a Buyer Demand ad using only supplied demand signals and media.',
    '{"version":1,"archetype":"social_proof","shot":{"type":"buyer activity, open-home context, or attractive local property image","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"people or property activity visible outside proof panel","horizon":"middle","copy_safe_zones":[{"id":"proof_panel","x":0.07,"y":0.5,"width":0.64,"height":0.28,"priority":"primary"},{"id":"cta_band","x":0.07,"y":0.8,"width":0.42,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","white","signal accent"],"overlay":"proof panel with dark scrim","contrast":"high"},"text_system":{"headline_zone":"lower-left proof panel","badge":"Buyer Demand proof badge","cta_style":"solid brand CTA"},"copy":{"hook_style":"buyer signal","headline_pattern":"Buyer demand in {suburb}","cta":"Check buyer demand"},"variables":["suburb","buyer_type","property_type"],"confidence":58}'::jsonb
  ),
  (
    'seller_checklist',
    'Seller Checklist',
    'seller_leads',
    'seller_prep_checklist',
    'guide',
    'checklist',
    'lead_magnet',
    'Seller checklist for {suburb} owners',
    'Offer a practical preparation checklist for owners thinking about selling.',
    'A practical pre-sale guide.',
    'Download checklist',
    array['suburb','property_type','timeline'],
    'Lead magnet template for seller education and preparation.',
    'Guide panel over clean property or preparation visual.',
    'Use customer media or approved brand image; keep guide panel clear.',
    'Brand primary, paper white, accent.',
    'Checklist headline and download CTA; practical, not fear-based.',
    'Create a Seller Checklist ad using the customer brief, media, and brand kit.',
    '{"version":1,"archetype":"seller_guide","shot":{"type":"seller prep image, styled room, checklist, or ready-to-list home","lighting":"natural Australian real-estate light","mood":"premium, practical and local"},"composition":{"focal_point":"clean property or preparation visual above or beside guide panel","horizon":"none","copy_safe_zones":[{"id":"guide_panel","x":0.08,"y":0.44,"width":0.66,"height":0.32,"priority":"primary"},{"id":"cta_band","x":0.08,"y":0.79,"width":0.46,"height":0.08,"priority":"cta"}]},"color":{"palette":["brand primary","paper white","accent"],"overlay":"guide panel with dark scrim","contrast":"high"},"text_system":{"headline_zone":"lower-left guide panel","badge":"Seller Checklist guide panel","cta_style":"solid brand CTA"},"copy":{"hook_style":"seller checklist lead magnet","headline_pattern":"Seller checklist for {suburb} owners","cta":"Download checklist"},"variables":["suburb","property_type","timeline"],"confidence":58}'::jsonb
  );

insert into research.ad_template_image_briefs (
  brief_id,
  name,
  concept,
  layout,
  imagery,
  palette,
  text_rules,
  formats,
  ai_prompt_seed,
  creative_skeleton,
  skeleton_version,
  updated_at
)
select
  'first_pass_' || template_key,
  name,
  concept,
  layout,
  imagery,
  palette,
  text_rules,
  array['9:16','4:5','1:1'],
  ai_prompt_seed,
  skeleton,
  1,
  now()
from adstudio_first_pass_templates
on conflict (brief_id) do update
set
  name = excluded.name,
  concept = excluded.concept,
  layout = excluded.layout,
  imagery = excluded.imagery,
  palette = excluded.palette,
  text_rules = excluded.text_rules,
  formats = excluded.formats,
  ai_prompt_seed = excluded.ai_prompt_seed,
  creative_skeleton = coalesce(research.ad_template_image_briefs.creative_skeleton, excluded.creative_skeleton),
  skeleton_version = greatest(research.ad_template_image_briefs.skeleton_version, excluded.skeleton_version),
  updated_at = now();

insert into research.ad_template_candidates (
  template_key,
  status,
  category,
  audience,
  format,
  hook_style,
  funnel_stage,
  adstudio_template_id,
  offer_id,
  goal,
  headline,
  primary_text,
  description,
  cta,
  variables,
  image_brief_id,
  evidence_score,
  source_observed_ad_ids,
  exemplar_observed_ad_ids,
  creative_skeleton,
  winner_rationale,
  compliance_note,
  scorer_version,
  approved_at,
  updated_at
)
select
  template_key,
  'approved',
  category,
  array['homeowners','local sellers'],
  array['9:16','4:5','1:1'],
  hook_style,
  funnel_stage,
  template_key,
  offer_id,
  goal,
  headline,
  primary_text,
  description,
  cta,
  variables,
  'first_pass_' || template_key,
  58.0,
  '{}',
  '{}',
  skeleton,
  'First-pass/manual operator-approved template skeleton for live launch coverage; promote stronger mined winner-backed versions over this row during maintenance.',
  'Housing-safe first-pass template. Avoid guaranteed values, guaranteed buyers, discriminatory targeting, or unsupported sale result claims.',
  'first_pass_manual_v1',
  now(),
  now()
from adstudio_first_pass_templates
on conflict (template_key) do update
set
  status = 'approved',
  category = coalesce(research.ad_template_candidates.category, excluded.category),
  audience = case
    when research.ad_template_candidates.audience = '{}' then excluded.audience
    else research.ad_template_candidates.audience
  end,
  format = case
    when research.ad_template_candidates.format = '{}' then excluded.format
    else research.ad_template_candidates.format
  end,
  hook_style = coalesce(research.ad_template_candidates.hook_style, excluded.hook_style),
  funnel_stage = coalesce(research.ad_template_candidates.funnel_stage, excluded.funnel_stage),
  adstudio_template_id = coalesce(research.ad_template_candidates.adstudio_template_id, excluded.adstudio_template_id),
  offer_id = coalesce(research.ad_template_candidates.offer_id, excluded.offer_id),
  goal = coalesce(research.ad_template_candidates.goal, excluded.goal),
  headline = coalesce(research.ad_template_candidates.headline, excluded.headline),
  primary_text = coalesce(research.ad_template_candidates.primary_text, excluded.primary_text),
  description = coalesce(research.ad_template_candidates.description, excluded.description),
  cta = coalesce(research.ad_template_candidates.cta, excluded.cta),
  variables = case
    when research.ad_template_candidates.variables = '{}' then excluded.variables
    else research.ad_template_candidates.variables
  end,
  image_brief_id = coalesce(research.ad_template_candidates.image_brief_id, excluded.image_brief_id),
  evidence_score = greatest(research.ad_template_candidates.evidence_score, excluded.evidence_score),
  creative_skeleton = coalesce(research.ad_template_candidates.creative_skeleton, excluded.creative_skeleton),
  exemplar_observed_ad_ids = case
    when research.ad_template_candidates.exemplar_observed_ad_ids = '{}' then excluded.exemplar_observed_ad_ids
    else research.ad_template_candidates.exemplar_observed_ad_ids
  end,
  winner_rationale = case
    when research.ad_template_candidates.scorer_version = 'first_pass_manual_v1' or research.ad_template_candidates.winner_rationale is null
      then excluded.winner_rationale
    else research.ad_template_candidates.winner_rationale
  end,
  compliance_note = coalesce(research.ad_template_candidates.compliance_note, excluded.compliance_note),
  scorer_version = coalesce(research.ad_template_candidates.scorer_version, excluded.scorer_version),
  approved_at = coalesce(research.ad_template_candidates.approved_at, now()),
  updated_at = now();

commit;
