-- Customer-safe projections published by the VPS research runtime.
-- The research pipeline itself is intentionally not stored in this project.

create table public.customer_ad_radar_cards (
  card_id uuid primary key,
  observed_ad_id uuid not null unique,
  source_ad_creative_id uuid,
  library_id text,
  external_ad_id text,
  advertiser_page_id uuid,
  page_id text,
  page_name text,
  page_url text,
  page_image_url text,
  active_status text,
  ad_delivery_started_at timestamptz,
  ad_delivery_stopped_at timestamptz,
  ad_creation_date date,
  publisher_platforms text[] not null default '{}',
  platform text,
  postcode text,
  suburb text,
  state text,
  postcodes text[] not null default '{}',
  headline text,
  body text,
  description text,
  cta text,
  cta_url text,
  destination_url text,
  primary_image_url text,
  image_urls text[] not null default '{}',
  image_storage_path text,
  video_url text,
  video_storage_path text,
  video_thumbnail_url text,
  media_assets jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_checked_at timestamptz,
  area_match_postcode text,
  area_match_suburb text,
  area_match_state text,
  area_match_type text,
  area_match_confidence numeric,
  ad_area_postcodes text[] not null default '{}',
  ad_area_suburbs text[] not null default '{}',
  service_area_postcodes text[] not null default '{}',
  service_area_suburbs text[] not null default '{}',
  agent_id uuid,
  agent_name text,
  agency_id uuid,
  agency_name text,
  attribution_links jsonb not null default '[]'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  snapshot_count bigint not null default 0,
  ad_type text,
  format text,
  primary_intent text,
  display_state text,
  hooks jsonb not null default '[]'::jsonb,
  hooks_text text,
  source_revision text not null,
  source_updated_at timestamptz,
  published_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(page_name, '') || ' ' ||
      coalesce(agent_name, '') || ' ' ||
      coalesce(agency_name, '') || ' ' ||
      coalesce(library_id, '') || ' ' ||
      coalesce(headline, '') || ' ' ||
      coalesce(body, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(postcode, '') || ' ' ||
      coalesce(suburb, '') || ' ' ||
      coalesce(state, '') || ' ' ||
      coalesce(destination_url, '') || ' ' ||
      coalesce(cta, '') || ' ' ||
      coalesce(hooks_text, '')
    )
  ) stored,
  constraint customer_ad_radar_cards_active_status_check
    check (active_status is null or active_status in ('active', 'inactive', 'unknown')),
  constraint customer_ad_radar_cards_media_assets_object_or_array_check
    check (jsonb_typeof(media_assets) in ('array', 'object')),
  constraint customer_ad_radar_cards_classification_object_check
    check (jsonb_typeof(classification) = 'object'),
  constraint customer_ad_radar_cards_attribution_links_array_check
    check (jsonb_typeof(attribution_links) = 'array')
);

comment on table public.customer_ad_radar_cards is
  'Customer-required Ad Radar read model published from the private VPS research database.';

create index customer_ad_radar_cards_last_seen_idx
  on public.customer_ad_radar_cards (last_seen_at desc nulls last);
create index customer_ad_radar_cards_started_idx
  on public.customer_ad_radar_cards (ad_delivery_started_at asc nulls last);
create index customer_ad_radar_cards_page_name_idx
  on public.customer_ad_radar_cards using gin (page_name gin_trgm_ops);
create index customer_ad_radar_cards_postcodes_idx
  on public.customer_ad_radar_cards using gin (postcodes);
create index customer_ad_radar_cards_ad_area_postcodes_idx
  on public.customer_ad_radar_cards using gin (ad_area_postcodes);
create index customer_ad_radar_cards_ad_area_suburbs_idx
  on public.customer_ad_radar_cards using gin (ad_area_suburbs);
create index customer_ad_radar_cards_search_idx
  on public.customer_ad_radar_cards using gin (search_vector);
create index customer_ad_radar_cards_filters_idx
  on public.customer_ad_radar_cards (active_status, ad_type, format);

alter table public.customer_ad_radar_cards enable row level security;
revoke all on public.customer_ad_radar_cards from anon, authenticated;
grant select on public.customer_ad_radar_cards to anon, authenticated;
grant all on public.customer_ad_radar_cards to service_role;

create policy customer_ad_radar_cards_public_read
  on public.customer_ad_radar_cards
  for select
  to anon, authenticated
  using (true);

create or replace function public.search_customer_meta_ad_library_cards(
  p_query text,
  p_limit integer default 200,
  p_sort text default 'recent'
)
returns setof public.customer_ad_radar_cards
language sql
stable
security invoker
set search_path = ''
as $$
  select card
  from public.customer_ad_radar_cards card
  where card.search_vector @@ websearch_to_tsquery('simple', coalesce(p_query, ''))
  order by
    case when p_sort = 'longest' then card.ad_delivery_started_at end asc nulls last,
    case when p_sort <> 'longest' then card.last_seen_at end desc nulls last,
    ts_rank(card.search_vector, websearch_to_tsquery('simple', coalesce(p_query, ''))) desc,
    card.card_id
  limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

revoke all on function public.search_customer_meta_ad_library_cards(text, integer, text) from public;
grant execute on function public.search_customer_meta_ad_library_cards(text, integer, text)
  to anon, authenticated, service_role;

create table public.customer_ad_radar_creative_versions (
  id uuid primary key,
  observed_ad_id uuid not null
    references public.customer_ad_radar_cards(observed_ad_id) on delete cascade,
  source_ad_creative_id uuid not null,
  version integer not null,
  creative_hash text not null,
  format text,
  headline text,
  body text,
  cta text,
  ad_type text,
  primary_intent text,
  display_state text,
  created_at timestamptz not null,
  source_revision text not null,
  published_at timestamptz not null default now(),
  unique (observed_ad_id, version)
);

create index customer_ad_radar_creative_versions_observed_idx
  on public.customer_ad_radar_creative_versions (observed_ad_id, version desc);

alter table public.customer_ad_radar_creative_versions enable row level security;
revoke all on public.customer_ad_radar_creative_versions from anon, authenticated;
grant select on public.customer_ad_radar_creative_versions to authenticated;
grant all on public.customer_ad_radar_creative_versions to service_role;

create policy customer_ad_radar_creative_versions_authenticated_read
  on public.customer_ad_radar_creative_versions
  for select
  to authenticated
  using (true);

create table public.customer_ad_radar_publications (
  id uuid primary key default gen_random_uuid(),
  source_revision text not null unique,
  source_card_count integer not null,
  source_version_count integer not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null,
  error text,
  constraint customer_ad_radar_publications_status_check
    check (status in ('running', 'complete', 'failed'))
);

alter table public.customer_ad_radar_publications enable row level security;
revoke all on public.customer_ad_radar_publications from anon, authenticated;
grant all on public.customer_ad_radar_publications to service_role;

create table public.infrastructure_cutovers (
  cutover_key text primary key,
  verified_at timestamptz not null,
  archive_uri text not null,
  archive_sha256 text not null,
  source_counts jsonb not null,
  destination_counts jsonb not null,
  verified_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint infrastructure_cutovers_source_counts_object_check
    check (jsonb_typeof(source_counts) = 'object'),
  constraint infrastructure_cutovers_destination_counts_object_check
    check (jsonb_typeof(destination_counts) = 'object'),
  constraint infrastructure_cutovers_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.infrastructure_cutovers enable row level security;
revoke all on public.infrastructure_cutovers from anon, authenticated;
grant all on public.infrastructure_cutovers to service_role;

create table public.owned_ad_performance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  adstudio_creative_id uuid references public.adstudio_creatives(id) on delete set null,
  adstudio_campaign_id uuid references public.adstudio_campaigns(id) on delete set null,
  template_key text,
  observed_ad_id uuid,
  meta_ad_id text,
  meta_adset_id text,
  meta_campaign_id text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  leads integer not null default 0,
  qualified_leads integer not null default 0,
  spend_cents integer not null default 0,
  ctr numeric(8,4),
  cpl_cents integer,
  lead_quality_score numeric(5,1),
  reported_at timestamptz not null default now(),
  source text not null default 'meta_monitor',
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owned_ad_performance_ctr_check check (ctr is null or ctr >= 0),
  constraint owned_ad_performance_non_negative_counts_check check (
    impressions >= 0 and clicks >= 0 and leads >= 0 and qualified_leads >= 0
    and spend_cents >= 0 and (cpl_cents is null or cpl_cents >= 0)
  ),
  constraint owned_ad_performance_quality_check check (
    lead_quality_score is null or lead_quality_score between 0 and 100
  ),
  constraint owned_ad_performance_raw_metrics_check check (jsonb_typeof(raw_metrics) = 'object')
);

do $$
begin
  if to_regclass('research.owned_ad_performance') is not null then
    execute $copy$
      insert into public.owned_ad_performance (
        id, workspace_id, adstudio_creative_id, adstudio_campaign_id, template_key,
        observed_ad_id, meta_ad_id, meta_adset_id, meta_campaign_id, impressions,
        clicks, leads, qualified_leads, spend_cents, ctr, cpl_cents,
        lead_quality_score, reported_at, source, raw_metrics, created_at, updated_at
      )
      select
        id, workspace_id, adstudio_creative_id, adstudio_campaign_id, template_key,
        observed_ad_id, meta_ad_id, meta_adset_id, meta_campaign_id, impressions,
        clicks, leads, qualified_leads, spend_cents, ctr, cpl_cents,
        lead_quality_score, reported_at, source, raw_metrics, created_at, updated_at
      from research.owned_ad_performance
      on conflict (id) do nothing
    $copy$;
  end if;
end
$$;

create unique index owned_ad_performance_workspace_meta_ad_reported_unique
  on public.owned_ad_performance (workspace_id, meta_ad_id, reported_at, source);
create index owned_ad_performance_workspace_reported_idx
  on public.owned_ad_performance (workspace_id, reported_at desc);
create index owned_ad_performance_template_idx
  on public.owned_ad_performance (workspace_id, template_key, reported_at desc)
  where template_key is not null;

alter table public.owned_ad_performance enable row level security;
revoke all on public.owned_ad_performance from anon, authenticated;
grant all on public.owned_ad_performance to service_role;
