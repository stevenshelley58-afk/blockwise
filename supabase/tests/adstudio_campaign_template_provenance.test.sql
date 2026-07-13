create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'adstudio_campaigns', 'template_key', 'campaigns record the selected template key');
select has_column('public', 'adstudio_campaigns', 'template_source', 'campaigns record the template source');
select has_column(
  'public',
  'adstudio_campaigns',
  'source_observed_ad_id',
  'campaigns record the source observed ad'
);
select has_column(
  'public',
  'adstudio_campaigns',
  'template_snapshot_json',
  'campaigns retain the resolved template snapshot'
);

select col_type_is('public', 'adstudio_campaigns', 'template_key', 'text', 'template key is text');
select col_type_is('public', 'adstudio_campaigns', 'template_source', 'text', 'template source is text');
select col_type_is('public', 'adstudio_campaigns', 'source_observed_ad_id', 'uuid', 'source observed ad is a UUID');
select col_type_is('public', 'adstudio_campaigns', 'template_snapshot_json', 'jsonb', 'template snapshot is JSONB');

select col_not_null('public', 'adstudio_campaigns', 'template_snapshot_json', 'template snapshot is required');
select col_has_default('public', 'adstudio_campaigns', 'template_snapshot_json', 'template snapshot defaults safely');
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adstudio_campaigns'::regclass
      and conname = 'adstudio_campaigns_template_snapshot_json_check'
      and contype = 'c'
  ),
  'the named template snapshot object check exists'
);
select ok(
  to_regclass('public.adstudio_campaigns_workspace_template_idx') is not null,
  'the workspace-template lookup index exists'
);

select * from finish();
