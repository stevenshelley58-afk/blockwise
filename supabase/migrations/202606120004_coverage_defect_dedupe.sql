alter table research.coverage_defects
  add column if not exists subject_type text,
  add column if not exists subject_key text,
  add column if not exists reason text,
  add column if not exists occurrences int not null default 1;

alter table research.coverage_defects
  drop constraint if exists coverage_defects_occurrences_check;

alter table research.coverage_defects
  add constraint coverage_defects_occurrences_check
  check (occurrences >= 1);

update research.coverage_defects
set
  reason = coalesce(
    nullif(reason, ''),
    nullif(resolution->>'reason', ''),
    case
      when lower(notes) like '%census could not verify%' then 'census_requires_verified_evidence'
      when lower(notes) like '%page resolver could not find%' then 'page_resolver_no_verified_meta_page'
      when lower(notes) like '%budget guard blocked candidate actor%' then 'apify_canary_budget_guard_blocked'
      when lower(notes) like '%budget guard blocked meta ad library capture%' then 'apify_budget_guard_blocked'
      when lower(notes) like '%spent money without ingesting ads%' then 'apify_spend_without_ingest'
      when lower(notes) like '%location ad search could not fetch%' then 'location_ad_search_capture_failed'
      when lower(notes) like '%ad collector could not fetch%' then 'ad_collector_capture_failed'
      when lower(notes) like '%still had more pages%' or lower(notes) like '%hit resultslimit%' then 'ad_collector_truncated'
      when lower(notes) like '%coverage audit found%' then 'coverage_audit_gap'
      else 'unknown:' || substr(md5(coalesce(reported_by, 'system') || ':' || coalesce(notes, '')), 1, 16)
    end
  ),
  subject_type = coalesce(
    nullif(subject_type, ''),
    case
      when resolved_advertiser_page_id is not null or nullif(resolution->>'advertiser_page_id', '') is not null then 'advertiser_page'
      when resolved_agent_id is not null then 'agent'
      when resolved_agency_id is not null then 'agency'
      when postcode is not null then 'coverage_area'
      when nullif(resolution->>'meta_page_id', '') is not null then 'meta_page'
      when nullif(resolution->>'actor_id', '') is not null then 'capture_actor'
      when platform is not null then 'platform'
      else 'system'
    end
  ),
  subject_key = coalesce(
    nullif(subject_key, ''),
    case
      when resolved_advertiser_page_id is not null then resolved_advertiser_page_id::text
      when nullif(resolution->>'advertiser_page_id', '') is not null then resolution->>'advertiser_page_id'
      when resolved_agent_id is not null then resolved_agent_id::text
      when resolved_agency_id is not null then resolved_agency_id::text
      when postcode is not null then upper(coalesce(state, 'WA')) || ':' || postcode
      when nullif(resolution->>'meta_page_id', '') is not null then coalesce(platform, 'facebook') || ':' || (resolution->>'meta_page_id')
      when nullif(resolution->>'actor_id', '') is not null then coalesce(platform, 'facebook') || ':' || (resolution->>'actor_id')
      when platform is not null then platform
      else substr(md5(coalesce(reason, '') || ':' || coalesce(notes, '')), 1, 32)
    end
  ),
  occurrences = greatest(coalesce(occurrences, 1), 1);

with ranked as (
  select
    id,
    first_value(id) over defect_group as canonical_id,
    row_number() over defect_group as rn
  from research.coverage_defects
  where status in ('open', 'investigating', 'blocked')
    and subject_type is not null
    and subject_key is not null
    and reason is not null
  window defect_group as (
    partition by subject_type, subject_key, reason
    order by created_at asc, id asc
  )
),
groups as (
  select
    r.canonical_id,
    count(*) as duplicate_count,
    sum(greatest(coalesce(cd.occurrences, 1), 1)) as total_occurrences,
    max(cd.updated_at) as latest_updated_at,
    bool_or(cd.status = 'investigating') as has_investigating,
    bool_or(cd.status = 'open') as has_open,
    array_agg(cd.id order by cd.created_at asc, cd.id asc) filter (where cd.id <> r.canonical_id) as duplicate_ids
  from ranked r
  join research.coverage_defects cd on cd.id = r.id
  group by r.canonical_id
  having count(*) > 1
)
update research.coverage_defects cd
set
  occurrences = g.total_occurrences,
  updated_at = g.latest_updated_at,
  status = case
    when g.has_investigating then 'investigating'
    when g.has_open then 'open'
    else 'blocked'
  end,
  resolution = cd.resolution || jsonb_build_object(
    'collapsed_duplicate_count', g.duplicate_count - 1,
    'collapsed_duplicate_ids', to_jsonb(g.duplicate_ids)
  )
from groups g
where cd.id = g.canonical_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by subject_type, subject_key, reason
      order by created_at asc, id asc
    ) as rn
  from research.coverage_defects
  where status in ('open', 'investigating', 'blocked')
    and subject_type is not null
    and subject_key is not null
    and reason is not null
)
delete from research.coverage_defects cd
using ranked r
where cd.id = r.id
  and r.rn > 1;

create unique index if not exists coverage_defects_active_subject_reason_uidx
  on research.coverage_defects (subject_type, subject_key, reason)
  where status in ('open', 'investigating', 'blocked')
    and subject_type is not null
    and subject_key is not null
    and reason is not null;

create or replace function research.upsert_coverage_defect(p_defect jsonb)
returns research.coverage_defects
language plpgsql
security definer
set search_path = research, public
as $$
declare
  v_now timestamptz := now();
  v_resolution jsonb := coalesce(p_defect->'resolution', '{}'::jsonb);
  v_reason text := nullif(p_defect->>'reason', '');
  v_subject_type text := nullif(p_defect->>'subject_type', '');
  v_subject_key text := nullif(p_defect->>'subject_key', '');
  v_occurrences int := greatest(coalesce(nullif(p_defect->>'occurrences', '')::int, 1), 1);
  v_existing_id uuid;
  v_row research.coverage_defects;
begin
  v_reason := coalesce(
    v_reason,
    nullif(v_resolution->>'reason', ''),
    case
      when lower(coalesce(p_defect->>'notes', '')) like '%census could not verify%' then 'census_requires_verified_evidence'
      when lower(coalesce(p_defect->>'notes', '')) like '%page resolver could not find%' then 'page_resolver_no_verified_meta_page'
      when lower(coalesce(p_defect->>'notes', '')) like '%budget guard blocked candidate actor%' then 'apify_canary_budget_guard_blocked'
      when lower(coalesce(p_defect->>'notes', '')) like '%budget guard blocked meta ad library capture%' then 'apify_budget_guard_blocked'
      when lower(coalesce(p_defect->>'notes', '')) like '%spent money without ingesting ads%' then 'apify_spend_without_ingest'
      when lower(coalesce(p_defect->>'notes', '')) like '%location ad search could not fetch%' then 'location_ad_search_capture_failed'
      when lower(coalesce(p_defect->>'notes', '')) like '%ad collector could not fetch%' then 'ad_collector_capture_failed'
      when lower(coalesce(p_defect->>'notes', '')) like '%still had more pages%' or lower(coalesce(p_defect->>'notes', '')) like '%hit resultslimit%' then 'ad_collector_truncated'
      when lower(coalesce(p_defect->>'notes', '')) like '%coverage audit found%' then 'coverage_audit_gap'
      else 'unknown:' || substr(md5(coalesce(p_defect->>'reported_by', 'system') || ':' || coalesce(p_defect->>'notes', '')), 1, 16)
    end
  );

  v_subject_type := coalesce(
    v_subject_type,
    case
      when nullif(p_defect->>'resolved_advertiser_page_id', '') is not null or nullif(v_resolution->>'advertiser_page_id', '') is not null then 'advertiser_page'
      when nullif(p_defect->>'resolved_agent_id', '') is not null then 'agent'
      when nullif(p_defect->>'resolved_agency_id', '') is not null then 'agency'
      when nullif(p_defect->>'postcode', '') is not null then 'coverage_area'
      when nullif(v_resolution->>'meta_page_id', '') is not null then 'meta_page'
      when nullif(v_resolution->>'actor_id', '') is not null then 'capture_actor'
      when nullif(p_defect->>'platform', '') is not null then 'platform'
      else 'system'
    end
  );

  v_subject_key := coalesce(
    v_subject_key,
    case
      when nullif(p_defect->>'resolved_advertiser_page_id', '') is not null then p_defect->>'resolved_advertiser_page_id'
      when nullif(v_resolution->>'advertiser_page_id', '') is not null then v_resolution->>'advertiser_page_id'
      when nullif(p_defect->>'resolved_agent_id', '') is not null then p_defect->>'resolved_agent_id'
      when nullif(p_defect->>'resolved_agency_id', '') is not null then p_defect->>'resolved_agency_id'
      when nullif(p_defect->>'postcode', '') is not null then upper(coalesce(nullif(p_defect->>'state', ''), 'WA')) || ':' || (p_defect->>'postcode')
      when nullif(v_resolution->>'meta_page_id', '') is not null then coalesce(nullif(p_defect->>'platform', ''), 'facebook') || ':' || (v_resolution->>'meta_page_id')
      when nullif(v_resolution->>'actor_id', '') is not null then coalesce(nullif(p_defect->>'platform', ''), 'facebook') || ':' || (v_resolution->>'actor_id')
      when nullif(p_defect->>'platform', '') is not null then p_defect->>'platform'
      else substr(md5(v_reason || ':' || coalesce(p_defect->>'notes', '')), 1, 32)
    end
  );

  select id
    into v_existing_id
  from research.coverage_defects
  where status in ('open', 'investigating', 'blocked')
    and subject_type = v_subject_type
    and subject_key = v_subject_key
    and reason = v_reason
  order by created_at asc, id asc
  for update
  limit 1;

  if v_existing_id is not null then
    update research.coverage_defects
    set
      occurrences = occurrences + v_occurrences,
      notes = coalesce(nullif(p_defect->>'notes', ''), notes),
      reported_by = coalesce(nullif(p_defect->>'reported_by', ''), reported_by),
      reporter_identity = coalesce(nullif(p_defect->>'reporter_identity', ''), reporter_identity),
      status = case
        when status = 'investigating' then 'investigating'
        else coalesce(nullif(p_defect->>'status', ''), status)
      end,
      resolution = resolution || jsonb_build_object(
        'last_occurrence_at', v_now,
        'last_occurrence', v_resolution
      ),
      resolution_decision_id = coalesce(nullif(p_defect->>'resolution_decision_id', '')::uuid, resolution_decision_id),
      resolved_agent_id = coalesce(nullif(p_defect->>'resolved_agent_id', '')::uuid, resolved_agent_id),
      resolved_agency_id = coalesce(nullif(p_defect->>'resolved_agency_id', '')::uuid, resolved_agency_id),
      resolved_advertiser_page_id = coalesce(nullif(p_defect->>'resolved_advertiser_page_id', '')::uuid, resolved_advertiser_page_id),
      updated_at = v_now
    where id = v_existing_id
    returning * into v_row;
    return v_row;
  end if;

  insert into research.coverage_defects (
    postcode,
    suburb,
    state,
    agent_name,
    agency_name,
    platform,
    evidence_url,
    notes,
    reported_by,
    reporter_identity,
    status,
    resolution,
    resolution_decision_id,
    resolved_agent_id,
    resolved_agency_id,
    resolved_advertiser_page_id,
    resolved_at,
    subject_type,
    subject_key,
    reason,
    occurrences
  )
  values (
    nullif(p_defect->>'postcode', ''),
    nullif(p_defect->>'suburb', ''),
    coalesce(nullif(p_defect->>'state', ''), 'WA'),
    nullif(p_defect->>'agent_name', ''),
    nullif(p_defect->>'agency_name', ''),
    nullif(p_defect->>'platform', ''),
    nullif(p_defect->>'evidence_url', ''),
    coalesce(nullif(p_defect->>'notes', ''), 'Hermes recorded a coverage defect.'),
    coalesce(nullif(p_defect->>'reported_by', ''), 'auditor'),
    nullif(p_defect->>'reporter_identity', ''),
    coalesce(nullif(p_defect->>'status', ''), 'open'),
    v_resolution,
    nullif(p_defect->>'resolution_decision_id', '')::uuid,
    nullif(p_defect->>'resolved_agent_id', '')::uuid,
    nullif(p_defect->>'resolved_agency_id', '')::uuid,
    nullif(p_defect->>'resolved_advertiser_page_id', '')::uuid,
    nullif(p_defect->>'resolved_at', '')::timestamptz,
    v_subject_type,
    v_subject_key,
    v_reason,
    v_occurrences
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function research.upsert_coverage_defect(jsonb) to service_role;

notify pgrst, 'reload schema';
