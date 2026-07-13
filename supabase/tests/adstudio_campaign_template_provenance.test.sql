create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'adstudio_campaigns', 'template_key');
select has_column('public', 'adstudio_campaigns', 'template_source');
select has_column('public', 'adstudio_campaigns', 'source_observed_ad_id');
select has_column('public', 'adstudio_campaigns', 'template_snapshot_json');

select col_type_is('public', 'adstudio_campaigns', 'template_key', 'text');
select col_type_is('public', 'adstudio_campaigns', 'template_source', 'text');
select col_type_is('public', 'adstudio_campaigns', 'source_observed_ad_id', 'uuid');
select col_type_is('public', 'adstudio_campaigns', 'template_snapshot_json', 'jsonb');

select col_not_null('public', 'adstudio_campaigns', 'template_snapshot_json');
select col_has_default('public', 'adstudio_campaigns', 'template_snapshot_json');
select has_check(
  'public',
  'adstudio_campaigns',
  'adstudio_campaigns_template_snapshot_json_check'
);
select has_index(
  'public',
  'adstudio_campaigns',
  'adstudio_campaigns_workspace_template_idx'
);

select * from finish();
