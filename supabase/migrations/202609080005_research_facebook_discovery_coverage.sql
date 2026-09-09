-- Truthful, per-entity Facebook discovery coverage.
-- Only current-version entity receipts count. Older completed jobs remain
-- historical evidence and do not turn an entity green in this read model.
begin;

create or replace view research.v_ad_radar_facebook_discovery_coverage
with (security_invoker = true) as
with roster as (
  select 'agent'::text as entity_kind, a.id as entity_id,
         a.full_name as entity_name, a.state, a.primary_postcode,
         a.website_url
    from research.agents a
   where a.state = 'WA'
  union all
  select 'agency'::text as entity_kind, a.id as entity_id,
         a.name as entity_name, a.state, a.primary_postcode,
         a.website_url
    from research.agencies a
   where a.state = 'WA'
), latest_receipt as (
  select distinct on (w.payload->>'entity_kind', w.payload->>'entity_id')
         w.id as work_queue_id,
         w.payload->>'entity_kind' as entity_kind,
         w.payload->>'entity_id' as entity_id,
         w.updated_at,
         w.result->'discovery_receipt' as receipt
    from research.work_queue w
   where w.job_type = 'blockwise-ad-directory-discovery-entity'
     and w.status = 'complete'
     and w.payload->>'directory_coverage_version' = 'ad-radar-directory-coverage-v2'
     and w.result->>'coverage_version' = 'ad-radar-directory-coverage-v2'
   order by w.payload->>'entity_kind', w.payload->>'entity_id', w.updated_at desc, w.id desc
)
select r.entity_kind,
       r.entity_id,
       r.entity_name,
       r.state,
       r.primary_postcode,
       r.website_url,
       lr.work_queue_id,
       lr.updated_at as receipt_updated_at,
       coalesce(lr.receipt->>'searchOutcome', lr.receipt->>'search_outcome', 'not_checked') as search_outcome,
       lr.receipt->>'checkedAt' as checked_at,
       coalesce((lr.receipt->>'actualAttempted')::boolean, false) as actual_attempted,
       lr.receipt->>'reason' as reason,
       coalesce(lr.receipt->'evidence', '{}'::jsonb) as evidence,
       case when lr.work_queue_id is null then 'not_checked'::text
            else coalesce(lr.receipt->>'searchOutcome', lr.receipt->>'search_outcome', 'unresolved') end as coverage_state
  from roster r
  left join latest_receipt lr
    on lr.entity_kind = r.entity_kind
   and lr.entity_id = r.entity_id::text;

comment on view research.v_ad_radar_facebook_discovery_coverage is
  'Every WA agent and agency with the latest v2 Facebook discovery receipt, or not_checked. Legacy jobs are excluded.';

grant select on research.v_ad_radar_facebook_discovery_coverage to service_role;
commit;
