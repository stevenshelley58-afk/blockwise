-- Corrected prospect projection: all agents/agencies remain searchable even
-- with no advertiser page. No contact fields appear in this read surface.
drop view if exists research.v_ad_db_prospects;
create or replace view research.v_ad_db_prospects as
select 'agent'::text as prospect_type, ag.id as subject_id, ag.full_name as name,
       ag.state, ag.primary_suburb as suburb, ag.primary_postcode as postcode,
       ap.id as advertiser_page_id, ap.page_id, ap.page_name, ap.platform,
       ap.scan_enabled, ap.scan_state, ap.last_scan_started_at, ap.last_scan_completed_at,
       case when ay.id is null then null else jsonb_build_object('id', ay.id, 'name', ay.name, 'relationship', 'member_agency') end as agency,
       count(oa.id)::integer as observed_ad_count
from research.agents ag
left join research.advertiser_pages ap on ap.agent_id = ag.id
left join research.agencies ay on ay.id = ag.agency_id
left join research.observed_ads oa on oa.advertiser_page_id = ap.id
group by ag.id, ap.id, ay.id
union all
select 'agency'::text, ay.id, ay.name, ay.state, ay.primary_suburb, ay.primary_postcode,
       ap.id, ap.page_id, ap.page_name, ap.platform, ap.scan_enabled, ap.scan_state,
       ap.last_scan_started_at, ap.last_scan_completed_at, null::jsonb, count(oa.id)::integer
from research.agencies ay
left join research.advertiser_pages ap on ap.agency_id = ay.id
left join research.observed_ads oa on oa.advertiser_page_id = ap.id
group by ay.id, ap.id;

grant select on research.v_ad_db_prospects to service_role;

-- Index the predicates used by the internal adapter's stable cursor queries.
create index if not exists observed_ads_last_seen_id_idx
  on research.observed_ads (last_seen_at desc, id desc);
create index if not exists media_archive_objects_verified_idx
  on research.media_archive_objects (verified_at desc);
