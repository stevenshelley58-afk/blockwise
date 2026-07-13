insert into public.workspaces (id, name)
values ('a1000000-0000-4000-8000-000000000001', 'Revision Migration Replay');

insert into public.adstudio_brand_kits (id, workspace_id, business_name)
values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Replay Realty'
);

insert into public.adstudio_campaigns (
  id,
  workspace_id,
  brand_kit_id,
  name,
  goal,
  offer_id
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'Replay Campaign',
  'seller_leads',
  'just-listed-double'
);

insert into public.adstudio_campaign_variants (
  id,
  workspace_id,
  campaign_id,
  angle,
  headline,
  offer,
  cta
) values (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'listing',
  'Just listed',
  'Inspection',
  'Learn more'
);

insert into public.adstudio_creatives (
  id,
  workspace_id,
  campaign_id,
  variant_id,
  format,
  width,
  height,
  canvas_json,
  render_status
)
select
  gen_random_uuid(),
  'a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  '4:5',
  1080,
  1350,
  jsonb_build_object('version', n, 'objects', '[]'::jsonb),
  'rendered'
from generate_series(1, 427) n;
