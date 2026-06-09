-- ============================================================================
-- Blockwise DB Cleanup 2026-06-09 — structural backup of research_legacy
-- ----------------------------------------------------------------------------
-- Captured definitions of the research_legacy VIEWS and FUNCTIONS before the
-- schema was dropped. This is a REFERENCE for restoring logic if ever needed.
-- Authoritative data + exact DDL recovery is via Supabase PITR / daily backups.
-- research_archive contained only hard_reset_202605300003_* snapshot tables
-- (no functions/views; recover via PITR).
-- ============================================================================

-- ===================== FUNCTIONS (research_legacy) ==========================

CREATE OR REPLACE FUNCTION research_legacy.set_updated_at()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION research_legacy.jsonb_int(p_doc jsonb, p_keys text[], p_default integer DEFAULT 0)
 RETURNS integer LANGUAGE plpgsql IMMUTABLE
AS $function$
declare
  k text;
  v text;
begin
  foreach k in array p_keys loop
    v := p_doc ->> k;
    if v is not null and v ~ '^-?[0-9]+$' then
      return v::int;
    end if;
  end loop;
  return p_default;
end;
$function$;

CREATE OR REPLACE FUNCTION research_legacy.valid_external_ad_id(p_external_ad_id text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  select p_external_ad_id is not null
    and length(btrim(p_external_ad_id)) > 0
    and lower(btrim(p_external_ad_id)) not in ('0', 'unknown', 'null', 'none', 'n/a', 'na', 'undefined');
$function$;

CREATE OR REPLACE FUNCTION research_legacy.creative_is_real_estate(p_classification jsonb, p_ad_type text, p_primary_intent text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
AS $function$
  select
    lower(coalesce(p_classification ->> 'industry', p_classification ->> 'vertical', '')) in ('real_estate', 'real estate', 'property')
    or lower(coalesce(p_primary_intent, p_classification ->> 'primary_intent', p_classification ->> 'intent', '')) in (
      'appraisal','listing','just_sold','open_home','market_update','property_management',
      'lead_magnet','agent_branding','agency_brand','real_estate')
    or lower(coalesce(p_ad_type, p_classification ->> 'type', p_classification ->> 'ad_type', '')) in (
      'appraisal','listing','just_sold','open_home','market_update','property_management',
      'lead_magnet','brand','agent_branding','agency_brand','real_estate');
$function$;

-- NOTE: page_is_verified_real_estate, claim_work_queue_jobs, record_ad_creative_version,
-- and watchdog_record_missing_media / _provider_failures / _unclassified_creatives /
-- _zero_ad_anomalies / watchdog_requeue_stale_jobs ALSO EXIST (live) in the active
-- `research` schema. The research_legacy copies pointed at research.* tables and were
-- redundant. Recover exact source via PITR if a legacy-specific copy is ever needed.

-- ===================== VIEWS (research_legacy) ==============================
-- Reporting views; superseded by the active research schema. Bodies preserved below.

CREATE VIEW research_legacy.v_operator_work_queue_summary AS
 SELECT queue_name, job_type, status, count(*) AS jobs,
    min(available_at) AS oldest_available_at, max(updated_at) AS newest_update_at,
    count(*) FILTER (WHERE status = 'claimed'::text AND claim_expires_at < now()) AS stale_claims
   FROM research_legacy.work_queue
  GROUP BY queue_name, job_type, status;

CREATE VIEW research_legacy.v_operator_work_queue_diagnostics AS
 SELECT id, queue_name, job_type, dedupe_key, status, priority, available_at, claimed_at,
    claimed_by, claim_expires_at, attempts, max_attempts, last_error, blocked_reason,
    created_at, updated_at, completed_at,
    status = 'claimed'::text AND claim_expires_at < now() AS is_stale_claim
   FROM research_legacy.work_queue q;

CREATE VIEW research_legacy.v_operator_provider_failures AS
 SELECT id AS ad_fetch_run_id, source_provider, role, trigger, target_kind, target_value,
    started_at, completed_at, status, error, result_summary, cost_usd
   FROM research_legacy.ad_fetch_runs afr
  WHERE status = 'failed'::text ORDER BY started_at DESC;

CREATE VIEW research_legacy.v_operator_build_reports AS
 SELECT brr.id, brr.build_run_id, br.mode, br.market, br.target_postcodes, br.source_provider,
    brr.report_type, brr.severity, brr.status, brr.title, brr.report, brr.dedupe_key,
    brr.first_seen_at, brr.last_seen_at, brr.occurrences, brr.created_at
   FROM research_legacy.build_run_reports brr
     LEFT JOIN research_legacy.build_runs br ON br.id = brr.build_run_id
  ORDER BY brr.last_seen_at DESC;

CREATE VIEW research_legacy.v_missing_competitors AS
 SELECT id, postcode, suburb, state, agent_name, agency_name, platform, evidence_url, notes,
    reported_by, status, created_at, updated_at, resolved_at, resolved_agent_id,
    resolved_agency_id, resolved_advertiser_page_id
   FROM research_legacy.coverage_defects cd
  WHERE status = ANY (ARRAY['open'::text, 'investigating'::text, 'blocked'::text]);

-- The following larger views (v_coverage_status, v_customer_meta_ad_library_cards,
-- v_agent_ad_history, v_recent_creative_patterns, v_ad_hooks_by_suburb,
-- v_active_ads_by_postcode, v_competitors_by_postcode, v_operator_missing_media,
-- v_operator_unclassified_creatives, v_operator_zero_ad_anomalies,
-- v_operator_page_verification_gaps) depend on research_legacy.page_is_verified_real_estate /
-- creative_is_real_estate / valid_external_ad_id / jsonb_int and the research_legacy tables.
-- Their full definitions are preserved in Supabase PITR; restore from there if a legacy
-- reporting view is ever required. They were unused by the live app at drop time.
