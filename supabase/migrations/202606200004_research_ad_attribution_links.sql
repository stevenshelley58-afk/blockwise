-- First-class ad attribution links for DB-backed customer ad cards.
--
-- Raw attribution evidence remains service-role only. Customer-facing access is
-- through research.v_customer_meta_ad_library_cards, which keeps the existing
-- real-estate and displayability gates.

begin;

create table if not exists research.ad_attribution_links (
  id uuid primary key default gen_random_uuid(),
  observed_ad_id uuid not null references research.observed_ads (id) on delete cascade,
  link_type text not null
    check (link_type in ('agent', 'agency', 'postcode')),
  agent_id uuid references research.agents (id) on delete cascade,
  agency_id uuid references research.agencies (id) on delete cascade,
  postcode text,
  suburb text,
  state text,
  evidence_type text not null
    check (btrim(evidence_type) <> ''),
  confidence numeric(5, 2) not null default 0
    check (confidence >= 0 and confidence <= 100),
  source text not null
    check (btrim(source) <> ''),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_attribution_links_subject_matches_type
    check (
      (
        link_type = 'agent'
        and agent_id is not null
        and agency_id is null
        and postcode is null
        and suburb is null
        and state is null
      )
      or (
        link_type = 'agency'
        and agency_id is not null
        and agent_id is null
        and postcode is null
        and suburb is null
        and state is null
      )
      or (
        link_type = 'postcode'
        and postcode is not null
        and agent_id is null
        and agency_id is null
      )
    ),
  constraint ad_attribution_links_seen_order
    check (last_seen_at >= first_seen_at)
);

drop trigger if exists trg_ad_attribution_links_updated_at on research.ad_attribution_links;
create trigger trg_ad_attribution_links_updated_at
  before update on research.ad_attribution_links
  for each row execute function research.set_updated_at();

create unique index if not exists ad_attribution_links_agent_unique_idx
  on research.ad_attribution_links (observed_ad_id, agent_id, evidence_type, source)
  where link_type = 'agent';

create unique index if not exists ad_attribution_links_agency_unique_idx
  on research.ad_attribution_links (observed_ad_id, agency_id, evidence_type, source)
  where link_type = 'agency';

create unique index if not exists ad_attribution_links_postcode_unique_idx
  on research.ad_attribution_links (
    observed_ad_id,
    postcode,
    coalesce(suburb, ''),
    coalesce(state, ''),
    evidence_type,
    source
  )
  where link_type = 'postcode';

create index if not exists ad_attribution_links_observed_idx
  on research.ad_attribution_links (observed_ad_id);
create index if not exists ad_attribution_links_type_confidence_idx
  on research.ad_attribution_links (link_type, confidence desc, last_seen_at desc);
create index if not exists ad_attribution_links_agent_idx
  on research.ad_attribution_links (agent_id)
  where link_type = 'agent';
create index if not exists ad_attribution_links_agency_idx
  on research.ad_attribution_links (agency_id)
  where link_type = 'agency';
create index if not exists ad_attribution_links_postcode_idx
  on research.ad_attribution_links (postcode, suburb, state)
  where link_type = 'postcode';

insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  agent_id,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  oa.id,
  'agent',
  ap.agent_id,
  'advertiser_page_resolution',
  ap.confidence,
  'research.advertiser_pages',
  jsonb_build_object(
    'advertiserPageId', ap.id,
    'pageId', ap.page_id,
    'pageName', ap.page_name,
    'pageStatus', ap.status,
    'resolutionDecisionId', ap.resolution_decision_id
  ),
  least(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now())
  ),
  greatest(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now())
  )
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
where ap.agent_id is not null
  and not exists (
    select 1
    from research.ad_attribution_links existing
    where existing.observed_ad_id = oa.id
      and existing.link_type = 'agent'
      and existing.agent_id = ap.agent_id
      and existing.evidence_type = 'advertiser_page_resolution'
      and existing.source = 'research.advertiser_pages'
  );

with page_agent_name_matches as (
  select
    oa.id as observed_ad_id,
    ap.id as advertiser_page_id,
    ap.page_id,
    ap.page_name,
    ap.status as page_status,
    agent.id as agent_id,
    agent.full_name as agent_name,
    agent.agency_id,
    normalized.page_name_normalized,
    normalized.agent_name_normalized,
    count(*) over (partition by oa.id) as match_count,
    least(
      coalesce(oa.first_seen_at, oa.created_at, now()),
      coalesce(oa.last_seen_at, oa.created_at, now()),
      coalesce(ap.first_seen_at, ap.created_at, now()),
      coalesce(ap.last_seen_at, ap.created_at, now()),
      coalesce(agent.first_seen_at, agent.created_at, now()),
      coalesce(agent.last_seen_at, agent.created_at, now())
    ) as first_seen_at,
    greatest(
      coalesce(oa.first_seen_at, oa.created_at, now()),
      coalesce(oa.last_seen_at, oa.created_at, now()),
      coalesce(ap.first_seen_at, ap.created_at, now()),
      coalesce(ap.last_seen_at, ap.created_at, now()),
      coalesce(agent.first_seen_at, agent.created_at, now()),
      coalesce(agent.last_seen_at, agent.created_at, now())
    ) as last_seen_at
  from research.observed_ads oa
  join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
  join research.agents agent on agent.status <> 'inactive'
  cross join lateral (
    select
      btrim(regexp_replace(lower(coalesce(ap.page_name, '')), '[^a-z0-9]+', ' ', 'g')) as page_name_normalized,
      btrim(regexp_replace(lower(coalesce(agent.full_name, '')), '[^a-z0-9]+', ' ', 'g')) as agent_name_normalized
  ) normalized
  where ap.agent_id is null
    and normalized.agent_name_normalized ~ '^[a-z0-9]+ [a-z0-9]+'
    and length(normalized.agent_name_normalized) >= 7
    and position(
      ' ' || normalized.agent_name_normalized || ' '
      in ' ' || normalized.page_name_normalized || ' '
    ) > 0
    and (
      ap.agency_id is null
      or agent.agency_id is null
      or ap.agency_id = agent.agency_id
    )
)
insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  agent_id,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  matched.observed_ad_id,
  'agent',
  matched.agent_id,
  'page_name_agent_exact',
  85.00,
  'codex.direct_page_name_match',
  jsonb_build_object(
    'advertiserPageId', matched.advertiser_page_id,
    'pageId', matched.page_id,
    'pageName', matched.page_name,
    'pageStatus', matched.page_status,
    'agentId', matched.agent_id,
    'agentName', matched.agent_name,
    'agencyId', matched.agency_id,
    'pageNameNormalized', matched.page_name_normalized,
    'agentNameNormalized', matched.agent_name_normalized
  ),
  matched.first_seen_at,
  matched.last_seen_at
from page_agent_name_matches matched
where matched.match_count = 1
  and not exists (
    select 1
    from research.ad_attribution_links existing
    where existing.observed_ad_id = matched.observed_ad_id
      and existing.link_type = 'agent'
      and existing.agent_id = matched.agent_id
      and existing.evidence_type = 'page_name_agent_exact'
      and existing.source = 'codex.direct_page_name_match'
  );

insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  agency_id,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  oa.id,
  'agency',
  ap.agency_id,
  'advertiser_page_resolution',
  ap.confidence,
  'research.advertiser_pages',
  jsonb_build_object(
    'advertiserPageId', ap.id,
    'pageId', ap.page_id,
    'pageName', ap.page_name,
    'pageStatus', ap.status,
    'resolutionDecisionId', ap.resolution_decision_id
  ),
  least(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now())
  ),
  greatest(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now())
  )
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
where ap.agency_id is not null
  and not exists (
    select 1
    from research.ad_attribution_links existing
    where existing.observed_ad_id = oa.id
      and existing.link_type = 'agency'
      and existing.agency_id = ap.agency_id
      and existing.evidence_type = 'advertiser_page_resolution'
      and existing.source = 'research.advertiser_pages'
  );

insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  agency_id,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  agent_link.observed_ad_id,
  'agency',
  agent.agency_id,
  'page_name_agent_agency',
  least(agent_link.confidence, agent.confidence),
  'codex.direct_page_name_match',
  jsonb_build_object(
    'agentAttributionLinkId', agent_link.id,
    'agentId', agent.id,
    'agentName', agent.full_name,
    'agencyId', agent.agency_id
  ),
  least(
    coalesce(agent_link.first_seen_at, agent_link.created_at, now()),
    coalesce(agent_link.last_seen_at, agent_link.created_at, now()),
    coalesce(agent.first_seen_at, agent.created_at, now()),
    coalesce(agent.last_seen_at, agent.created_at, now())
  ),
  greatest(
    coalesce(agent_link.first_seen_at, agent_link.created_at, now()),
    coalesce(agent_link.last_seen_at, agent_link.created_at, now()),
    coalesce(agent.first_seen_at, agent.created_at, now()),
    coalesce(agent.last_seen_at, agent.created_at, now())
  )
from research.ad_attribution_links agent_link
join research.agents agent on agent.id = agent_link.agent_id
where agent_link.link_type = 'agent'
  and agent_link.evidence_type = 'page_name_agent_exact'
  and agent_link.source = 'codex.direct_page_name_match'
  and agent.agency_id is not null
  and not exists (
    select 1
    from research.ad_attribution_links existing
    where existing.observed_ad_id = agent_link.observed_ad_id
      and existing.link_type = 'agency'
      and existing.agency_id = agent.agency_id
      and existing.evidence_type = 'page_name_agent_agency'
      and existing.source = 'codex.direct_page_name_match'
  );

insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  agency_id,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  oa.id,
  'agency',
  agent.agency_id,
  'agent_agency_resolution',
  least(ap.confidence, agent.confidence),
  'research.agents',
  jsonb_build_object(
    'advertiserPageId', ap.id,
    'pageId', ap.page_id,
    'pageName', ap.page_name,
    'agentId', agent.id,
    'agentName', agent.full_name,
    'agencyId', agent.agency_id
  ),
  least(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now()),
    coalesce(agent.first_seen_at, agent.created_at, now()),
    coalesce(agent.last_seen_at, agent.created_at, now())
  ),
  greatest(
    coalesce(oa.first_seen_at, oa.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, now()),
    coalesce(ap.first_seen_at, ap.created_at, now()),
    coalesce(ap.last_seen_at, ap.created_at, now()),
    coalesce(agent.first_seen_at, agent.created_at, now()),
    coalesce(agent.last_seen_at, agent.created_at, now())
  )
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.agents agent on agent.id = ap.agent_id
where agent.agency_id is not null
  and not exists (
    select 1
    from research.ad_attribution_links existing
    where existing.observed_ad_id = oa.id
      and existing.link_type = 'agency'
      and existing.agency_id = agent.agency_id
      and existing.evidence_type = 'agent_agency_resolution'
      and existing.source = 'research.agents'
  );

insert into research.ad_attribution_links (
  observed_ad_id,
  link_type,
  postcode,
  suburb,
  state,
  evidence_type,
  confidence,
  source,
  evidence,
  first_seen_at,
  last_seen_at
)
select
  am.observed_ad_id,
  'postcode',
  am.postcode,
  am.suburb,
  am.state,
  am.match_type,
  am.confidence,
  'research.ad_area_matches',
  jsonb_build_object(
    'adAreaMatchId', am.id,
    'matchType', am.match_type,
    'evidence', am.evidence
  ),
  least(
    coalesce(oa.first_seen_at, oa.created_at, am.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, am.created_at, now()),
    coalesce(am.created_at, now())
  ),
  greatest(
    coalesce(oa.first_seen_at, oa.created_at, am.created_at, now()),
    coalesce(oa.last_seen_at, oa.created_at, am.created_at, now()),
    coalesce(am.created_at, now())
  )
from research.ad_area_matches am
join research.observed_ads oa on oa.id = am.observed_ad_id
where not exists (
  select 1
  from research.ad_attribution_links existing
  where existing.observed_ad_id = am.observed_ad_id
    and existing.link_type = 'postcode'
    and existing.postcode = am.postcode
    and coalesce(existing.suburb, '') = coalesce(am.suburb, '')
    and coalesce(existing.state, '') = coalesce(am.state, '')
    and existing.evidence_type = am.match_type
    and existing.source = 'research.ad_area_matches'
);

alter table research.ad_attribution_links enable row level security;

revoke all on research.ad_attribution_links from public, anon, authenticated;
grant select, insert, update, delete on research.ad_attribution_links to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'research'
      and tablename = 'ad_attribution_links'
      and policyname = 'ad_attribution_links_service_role_all'
  ) then
    create policy ad_attribution_links_service_role_all
      on research.ad_attribution_links
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

create or replace view research.v_customer_meta_ad_library_cards as
select
  oa.id as card_id,
  oa.external_ad_id as library_id,
  ap.page_id,
  ap.page_name,
  ap.page_url,
  coalesce(ap.metadata ->> 'page_image_url', ap.metadata ->> 'profile_image_url') as page_image_url,
  oa.active_status,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.meta_publisher_platforms as publisher_platforms,
  area_link.postcode,
  area_link.suburb,
  area_link.state,
  coalesce(service_areas.postcodes, array[area_link.postcode]) as postcodes,
  ac.headline,
  ac.body,
  coalesce(ac.metadata ->> 'description', ac.classification ->> 'description') as description,
  ac.cta,
  ac.cta_url,
  coalesce(ac.landing_url, ac.cta_url) as destination_url,
  null::text as primary_image_url,
  '{}'::text[] as image_urls,
  coalesce(ac.image_storage_path, media.image_storage_path) as image_storage_path,
  null::text as video_url,
  coalesce(ac.video_storage_path, media.video_storage_path) as video_storage_path,
  coalesce(ac.video_thumbnail_url, media.video_thumbnail_storage_path) as video_thumbnail_url,
  case
    when jsonb_typeof(ac.media_assets) = 'array' and jsonb_array_length(ac.media_assets) > 0 then ac.media_assets
    else coalesce(media.assets, '[]'::jsonb)
  end as media_assets,
  oa.last_seen_at,
  area_link.postcode as area_match_postcode,
  area_link.suburb as area_match_suburb,
  area_link.state as area_match_state,
  area_link.evidence_type as area_match_type,
  area_link.confidence as area_match_confidence,
  coalesce(ad_areas.postcodes, array[area_link.postcode]) as ad_area_postcodes,
  coalesce(ad_areas.suburbs, array[area_link.suburb]) as ad_area_suburbs,
  coalesce(service_areas.postcodes, '{}'::text[]) as service_area_postcodes,
  coalesce(service_areas.suburbs, '{}'::text[]) as service_area_suburbs,
  agent_link.agent_id,
  agent.full_name as agent_name,
  agency_link.agency_id,
  agency.name as agency_name,
  coalesce(attribution.links, '[]'::jsonb) as attribution_links
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
join research.ad_creatives ac on ac.observed_ad_id = oa.id
join research.ad_attribution_links area_link
  on area_link.observed_ad_id = oa.id
  and area_link.link_type = 'postcode'
left join lateral (
  select aal.agent_id
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'agent'
  order by aal.confidence desc, aal.last_seen_at desc, aal.created_at desc
  limit 1
) agent_link on true
left join research.agents agent on agent.id = agent_link.agent_id
left join lateral (
  select aal.agency_id
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'agency'
  order by aal.confidence desc, aal.last_seen_at desc, aal.created_at desc
  limit 1
) agency_link on true
left join research.agencies agency on agency.id = agency_link.agency_id
left join lateral (
  select
    array_agg(distinct aal.postcode order by aal.postcode) filter (where aal.postcode is not null) as postcodes,
    array_agg(distinct aal.suburb order by aal.suburb) filter (where aal.suburb is not null) as suburbs
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
    and aal.link_type = 'postcode'
) ad_areas on true
left join lateral (
  select
    array_agg(distinct asa.postcode order by asa.postcode) filter (where asa.postcode is not null) as postcodes,
    array_agg(distinct asa.suburb order by asa.suburb) filter (where asa.suburb is not null) as suburbs
  from research.agent_service_areas asa
  where asa.postcode is not null
    and (
      asa.agent_id = agent_link.agent_id
      or asa.agency_id = agency_link.agency_id
    )
) service_areas on true
left join lateral (
  select jsonb_agg(
    jsonb_strip_nulls(
      jsonb_build_object(
        'linkType', aal.link_type,
        'agentId', aal.agent_id,
        'agencyId', aal.agency_id,
        'postcode', aal.postcode,
        'suburb', aal.suburb,
        'state', aal.state,
        'evidenceType', aal.evidence_type,
        'confidence', aal.confidence,
        'source', aal.source,
        'firstSeenAt', aal.first_seen_at,
        'lastSeenAt', aal.last_seen_at
      )
    )
    order by aal.link_type, aal.confidence desc, aal.last_seen_at desc
  ) as links
  from research.ad_attribution_links aal
  where aal.observed_ad_id = oa.id
) attribution on true
left join lateral (
  select
    max(ma.storage_path) filter (where ma.kind = 'image' and ma.storage_path is not null) as image_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'video' and ma.storage_path is not null) as video_storage_path,
    max(ma.storage_path) filter (where ma.kind = 'thumbnail' and ma.storage_path is not null) as video_thumbnail_storage_path,
    jsonb_agg(
      jsonb_build_object(
        'kind', ma.kind,
        'storagePath', ma.storage_path,
        'contentType', coalesce(ma.content_type, ma.mime_type),
        'byteSize', ma.byte_size,
        'capturedAt', coalesce(ma.captured_at, ma.created_at)
      )
      order by ma.created_at
    ) filter (where ma.id is not null) as assets
  from research.media_assets ma
  where ma.ad_creative_id = ac.id
    and ma.capture_status = 'captured'
) media on true
where ap.status in ('resolved_collectable', 'no_ads_confirmed')
  and research.valid_external_ad_id(oa.external_ad_id)
  and research.page_is_verified_real_estate(ap.id)
  and research.creative_is_real_estate(ac.classification, ac.ad_type, ac.primary_intent)
  and ac.display_state = 'displayable';

comment on column research.v_customer_meta_ad_library_cards.postcodes is
  'Legacy display field. Prefer ad_area_postcodes for ad-location evidence and service_area_postcodes for advertiser coverage.';
comment on column research.v_customer_meta_ad_library_cards.ad_area_postcodes is
  'All postcodes from research.ad_attribution_links where link_type = postcode for this observed ad.';
comment on column research.v_customer_meta_ad_library_cards.service_area_postcodes is
  'Advertiser/agent service-area postcodes. These are coverage hints, not exact ad-location evidence.';
comment on column research.v_customer_meta_ad_library_cards.attribution_links is
  'Customer-safe attribution summary from research.ad_attribution_links; raw evidence remains service-role only.';

grant select on research.v_customer_meta_ad_library_cards to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;
