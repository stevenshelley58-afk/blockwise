-- Canonical contact-safe ad DB read projections.  Agencies, agents and
-- locations remain normal research tables; this does not introduce a second DB.
create or replace view research.v_ad_db_ads as
select
  oa.id,
  oa.external_ad_id as library_id,
  oa.advertiser_page_id,
  ap.page_id as advertiser_page_meta_id,
  ap.page_name,
  oa.active_status,
  oa.first_seen_at,
  oa.last_seen_at,
  oa.last_checked_at,
  oa.ad_delivery_started_at,
  oa.ad_delivery_stopped_at,
  oa.ad_creation_date,
  ac.id as ad_creative_id,
  ac.format,
  ac.headline,
  ac.body,
  ac.cta,
  ac.ad_type,
  ac.primary_intent,
  ac.classification,
  ac.display_state,
  jsonb_build_object(
    'agent', case when ag.id is null then null else jsonb_build_object('id', ag.id, 'name', ag.full_name, 'relationship', case when ap.owner_type = 'agent' then 'owner' else 'ad_page_association' end) end,
    'agency', case when ay.id is null then null else jsonb_build_object('id', ay.id, 'name', ay.name, 'relationship', case when ap.agency_id is null and ag.agency_id = ay.id then 'member_agency' when ap.owner_type = 'agency' then 'owner' else 'ad_page_association' end) end
  ) as ownership,
  coalesce(loc.locations, '[]'::jsonb) as locations,
  coalesce(media.media, '[]'::jsonb) as media
from research.observed_ads oa
join research.advertiser_pages ap on ap.id = oa.advertiser_page_id
left join research.agents ag on ag.id = ap.agent_id
left join research.agencies ay on ay.id = coalesce(ap.agency_id, ag.agency_id)
left join research.ad_creatives ac on ac.observed_ad_id = oa.id
left join lateral (
  select jsonb_agg(distinct jsonb_build_object('id', l.id, 'suburb', l.suburb, 'state', l.state, 'postcode', l.postcode, 'relation', x.relation)) as locations
  from (
    select ag.primary_location_id as location_id, 'office'::text as relation where ag.primary_location_id is not null
    union all select ay.primary_location_id, 'office'::text where ay.primary_location_id is not null
    union all select li.location_id, 'property'::text from research.listings li where li.id = oa.listing_id and li.location_id is not null
    union all select service_location.id, 'service_area'::text
      from research.agent_service_areas asa
      join research.locations service_location on service_location.postcode = asa.postcode and service_location.suburb = asa.suburb and service_location.state = asa.state
      where asa.agent_id = ag.id or asa.agency_id = ay.id
    union all select ll.location_id, ll.relation_type from research.location_links ll where ll.subject_type = 'observed_ad' and ll.subject_id = oa.id and ll.relation_type in ('meta_targeting', 'copy_mention') and ll.location_id is not null
  ) x join research.locations l on l.id = x.location_id
) loc on true
left join lateral (
  select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'storageBucket', m.storage_bucket, 'objectKey', m.object_key, 'sha256', m.content_hash, 'byteSize', m.byte_size, 'mimeType', m.mime_type, 'width', m.width, 'height', m.height, 'durationMs', m.duration_ms) order by m.id) as media
  from research.v_ad_db_archived_media m where m.observed_ad_id = oa.id
) media on true;

create or replace view research.v_ad_db_prospects as
select ap.id, ap.page_id, ap.page_name, ap.platform, ap.scan_enabled, ap.scan_state,
       ap.last_scan_started_at, ap.last_scan_completed_at,
       case when ag.id is null then null else jsonb_build_object('id', ag.id, 'name', ag.full_name) end as agent,
       case when ay.id is null then null else jsonb_build_object('id', ay.id, 'name', ay.name) end as agency,
       count(oa.id)::integer as observed_ad_count
from research.advertiser_pages ap
left join research.agents ag on ag.id = ap.agent_id
left join research.agencies ay on ay.id = ap.agency_id
left join research.observed_ads oa on oa.advertiser_page_id = ap.id
group by ap.id, ag.id, ay.id;

create or replace view research.v_ad_db_runs as
select r.id, r.advertiser_page_id, r.scan_mode, r.status, r.started_at, r.completed_at,
       r.coverage_complete, r.pagination_exhausted, r.stop_reason,
       coalesce((r.result_summary ->> 'ads_seen')::integer, 0) as ads_seen,
       coalesce((r.result_summary ->> 'media_captured')::integer, 0) as media_captured
from research.ad_fetch_runs r;

grant select on research.v_ad_db_ads, research.v_ad_db_prospects, research.v_ad_db_runs to service_role;
