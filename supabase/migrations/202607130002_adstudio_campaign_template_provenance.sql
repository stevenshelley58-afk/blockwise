-- Restore the campaign template-provenance columns that the persistence RPC
-- has depended on since 202607020001. Production already has this shape; the
-- repository migration history did not, which made clean replays leave the RPC
-- invalid. Keep this migration idempotent so it is a no-op on production.

alter table public.adstudio_campaigns
  add column if not exists template_key text,
  add column if not exists template_source text,
  add column if not exists source_observed_ad_id uuid,
  add column if not exists template_snapshot_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adstudio_campaigns'::regclass
      and conname = 'adstudio_campaigns_template_snapshot_json_check'
  ) then
    alter table public.adstudio_campaigns
      add constraint adstudio_campaigns_template_snapshot_json_check
      check (jsonb_typeof(template_snapshot_json) = 'object');
  end if;
end
$$;

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
