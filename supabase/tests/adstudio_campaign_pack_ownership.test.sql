create extension if not exists pgtap with schema extensions;

begin;

select plan(19);

insert into public.workspaces (id, name) values
  ('d1000000-0000-4000-8000-000000000001', 'Pack Ownership A'),
  ('d1000000-0000-4000-8000-000000000002', 'Pack Ownership B');

insert into public.adstudio_brand_kits (id, workspace_id, business_name)
values ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'Foreign brand');

insert into public.adstudio_campaigns (id, workspace_id, brand_kit_id, name, goal, offer_id)
values (
  'd3000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000002',
  'Foreign campaign', 'seller_leads', 'foreign-offer'
);

insert into public.adstudio_campaign_variants (id, workspace_id, campaign_id, angle, headline, offer, cta)
values (
  'd4000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000002',
  'foreign-angle', 'Foreign headline', 'Foreign offer', 'Foreign CTA'
);

insert into public.adstudio_creatives (
  id, workspace_id, campaign_id, variant_id, format, width, height, canvas_json, render_status
) values (
  'd5000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000002',
  'd4000000-0000-4000-8000-000000000002',
  '4:5', 1080, 1350, '{"version":"foreign-original","objects":[]}'::jsonb, 'rendered'
);

insert into public.adstudio_platform_copy (
  id, workspace_id, campaign_id, variant_id, meta_json
) values (
  'd6000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000002',
  'd4000000-0000-4000-8000-000000000002',
  '{"primaryText":"foreign-original"}'::jsonb
);

insert into public.adstudio_compliance_reports (id, workspace_id, campaign_id, status, issues_json)
values (
  'd7000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000002',
  'passed', '[]'::jsonb
);

-- A same-workspace child is still owned by its original campaign and cannot
-- be re-homed under another campaign through a globally supplied ID.
insert into public.adstudio_brand_kits (id, workspace_id, business_name)
values ('d2000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000001', 'Same-workspace baseline');
insert into public.adstudio_campaigns (id, workspace_id, brand_kit_id, name, goal, offer_id)
values (
  'd3000000-0000-4000-8000-000000000009',
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000009',
  'Same-workspace baseline', 'seller_leads', 'baseline-offer'
);
insert into public.adstudio_campaign_variants (id, workspace_id, campaign_id, angle, headline, offer, cta)
values (
  'd4000000-0000-4000-8000-000000000009',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000009',
  'baseline', 'Baseline headline', 'Baseline offer', 'Baseline CTA'
);

create temp table pack_test_workspace_a_before as
select sum(row_count)::integer as row_count
from (
  select count(*) row_count from public.adstudio_brand_kits where workspace_id = 'd1000000-0000-4000-8000-000000000001'
  union all select count(*) from public.adstudio_campaigns where workspace_id = 'd1000000-0000-4000-8000-000000000001'
  union all select count(*) from public.adstudio_campaign_variants where workspace_id = 'd1000000-0000-4000-8000-000000000001'
  union all select count(*) from public.adstudio_creatives where workspace_id = 'd1000000-0000-4000-8000-000000000001'
  union all select count(*) from public.adstudio_platform_copy where workspace_id = 'd1000000-0000-4000-8000-000000000001'
  union all select count(*) from public.adstudio_compliance_reports where workspace_id = 'd1000000-0000-4000-8000-000000000001'
) counts;

create function pg_temp.persist_pack(
  p_brand_id uuid,
  p_campaign_id uuid,
  p_variants jsonb default '[]'::jsonb,
  p_creatives jsonb default '[]'::jsonb,
  p_copy_packs jsonb default '[]'::jsonb,
  p_compliance_id uuid default 'd7000000-0000-4000-8000-000000000001',
  p_campaign_brand_id uuid default null,
  p_compliance_variant_id uuid default null
) returns void
language sql
as $$
  select public.adstudio_persist_campaign_pack(
    jsonb_build_object(
      'id', p_brand_id,
      'workspace_id', 'd1000000-0000-4000-8000-000000000001',
      'business_name', 'ATTACKER'
    ),
    jsonb_build_object(
      'id', p_campaign_id,
      'workspace_id', 'd1000000-0000-4000-8000-000000000001',
      'brand_kit_id', coalesce(p_campaign_brand_id, p_brand_id),
      'name', 'ATTACKER',
      'goal', 'seller_leads',
      'offer_id', 'attacker-offer'
    ),
    p_variants,
    p_creatives,
    p_copy_packs,
    jsonb_strip_nulls(jsonb_build_object(
      'id', p_compliance_id,
      'workspace_id', 'd1000000-0000-4000-8000-000000000001',
      'campaign_id', p_campaign_id,
      'variant_id', p_compliance_variant_id,
      'status', 'failed',
      'issues_json', '[{"message":"ATTACKER"}]'::jsonb
    ))
  );
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$ select pg_temp.persist_pack('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000011') $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign brand-kit ID'
);
select throws_ok(
  $$ select pg_temp.persist_pack('d2000000-0000-4000-8000-000000000012', 'd3000000-0000-4000-8000-000000000002') $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign campaign ID'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000013',
      'd3000000-0000-4000-8000-000000000013',
      '[{"id":"d4000000-0000-4000-8000-000000000002","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000013"}]'
    )
  $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign variant ID'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000014',
      'd3000000-0000-4000-8000-000000000014',
      '[{"id":"d4000000-0000-4000-8000-000000000014","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000014"}]',
      '[{"id":"d5000000-0000-4000-8000-000000000002","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000014","variant_id":"d4000000-0000-4000-8000-000000000014"}]'
    )
  $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign creative ID'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000015',
      'd3000000-0000-4000-8000-000000000015',
      '[{"id":"d4000000-0000-4000-8000-000000000015","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000015"}]',
      '[]',
      '[{"id":"d6000000-0000-4000-8000-000000000002","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000015","variant_id":"d4000000-0000-4000-8000-000000000015"}]'
    )
  $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign platform-copy ID'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000016',
      'd3000000-0000-4000-8000-000000000016',
      '[]', '[]', '[]',
      'd7000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot re-home a foreign compliance-report ID'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000017',
      'd3000000-0000-4000-8000-000000000017',
      '[{"id":"d4000000-0000-4000-8000-000000000009","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000017"}]'
    )
  $$,
  '42501', 'ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION',
  'a service pack cannot move a same-workspace child ID between campaigns'
);

select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000021',
      'd3000000-0000-4000-8000-000000000021',
      '[]', '[]', '[]',
      'd7000000-0000-4000-8000-000000000021',
      'd2000000-0000-4000-8000-000000000022'
    )
  $$,
  '22023', 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
  'the campaign must reference the pack brand kit'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000023',
      'd3000000-0000-4000-8000-000000000023',
      '[{"id":"d4000000-0000-4000-8000-000000000023","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000099"}]'
    )
  $$,
  '22023', 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
  'a variant cannot point at a foreign campaign'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000024',
      'd3000000-0000-4000-8000-000000000024',
      '[{"id":"d4000000-0000-4000-8000-000000000024","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000024"}]',
      '[{"id":"d5000000-0000-4000-8000-000000000024","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000024","variant_id":"d4000000-0000-4000-8000-000000000099"}]'
    )
  $$,
  '22023', 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
  'a creative must reference a variant declared in the pack'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000025',
      'd3000000-0000-4000-8000-000000000025',
      '[]', '[]',
      '[{"id":"d6000000-0000-4000-8000-000000000025","workspace_id":"d1000000-0000-4000-8000-000000000001","campaign_id":"d3000000-0000-4000-8000-000000000025","variant_id":"d4000000-0000-4000-8000-000000000099"}]'
    )
  $$,
  '22023', 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
  'platform copy cannot reference a variant absent from the pack'
);
select throws_ok(
  $$
    select pg_temp.persist_pack(
      'd2000000-0000-4000-8000-000000000026',
      'd3000000-0000-4000-8000-000000000026',
      '[]', '[]', '[]',
      'd7000000-0000-4000-8000-000000000026',
      null,
      'd4000000-0000-4000-8000-000000000099'
    )
  $$,
  '22023', 'ADSTUDIO_INVALID_CAMPAIGN_PACK',
  'compliance cannot reference a variant absent from the pack'
);

select is(
  (select workspace_id::text || ':' || business_name from public.adstudio_brand_kits where id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:Foreign brand',
  'the foreign brand kit remains unchanged'
);
select is(
  (select workspace_id::text || ':' || name from public.adstudio_campaigns where id = 'd3000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:Foreign campaign',
  'the foreign campaign remains unchanged'
);
select is(
  (select workspace_id::text || ':' || headline from public.adstudio_campaign_variants where id = 'd4000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:Foreign headline',
  'the foreign variant remains unchanged'
);
select is(
  (select workspace_id::text || ':' || (canvas_json ->> 'version') from public.adstudio_creatives where id = 'd5000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:foreign-original',
  'the foreign creative remains unchanged'
);
select is(
  (select workspace_id::text || ':' || (meta_json ->> 'primaryText') from public.adstudio_platform_copy where id = 'd6000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:foreign-original',
  'the foreign platform copy remains unchanged'
);
select is(
  (select workspace_id::text || ':' || status from public.adstudio_compliance_reports where id = 'd7000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000002:passed',
  'the foreign compliance report remains unchanged'
);
reset role;
select is(
  (
    select sum(row_count)::integer
    from (
      select count(*) row_count from public.adstudio_brand_kits where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      union all select count(*) from public.adstudio_campaigns where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      union all select count(*) from public.adstudio_campaign_variants where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      union all select count(*) from public.adstudio_creatives where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      union all select count(*) from public.adstudio_platform_copy where workspace_id = 'd1000000-0000-4000-8000-000000000001'
      union all select count(*) from public.adstudio_compliance_reports where workspace_id = 'd1000000-0000-4000-8000-000000000001'
    ) counts
  ),
  (select row_count from pack_test_workspace_a_before),
  'every rejected pack rolls back without creating attacker-controlled rows'
);

select * from finish();
rollback;
