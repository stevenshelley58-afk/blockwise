# Blockwise DB Cleanup — Drop Manifest (2026-06-09)

Project: **blockwise** (`uwwbvdloschaccycjozr`), region ap-southeast-2, Postgres 17.6, plan Pro.

This file records exactly what was removed during the 2026-06-09 database cleanup so the
action is auditable and reversible.

## What is being dropped

Two schemas that are **superseded duplicates / one-time snapshots**, confirmed unused by the
live application:

| Schema | Tables | Size | What it is |
|---|---|---|---|
| `research_legacy` | 21 | ~29 MB | Pre-"hard reset" copies of the research tables/views/functions. Superseded by the active `research` schema. |
| `research_archive` | 27 | ~14 MB | `hard_reset_202605300003_*` point-in-time snapshots taken during the 2026-05-30 reset, plus `hard_reset_manifests`. |

Total reclaimed: **~43 MB** and **48 tables**.

## Why this is safe (verified before dropping)

1. **No cross-schema foreign keys** in or out of either schema.
2. **No active view or function** (in `public`, `research`, etc.) references either schema.
3. **No trigger** on any live table uses a function from either schema.
4. The active `research` schema contains live equivalents of every function the app calls
   (`claim_work_queue_jobs`, `watchdog_record_missing_media`, `watchdog_record_provider_failures`,
   `watchdog_record_unclassified_creatives`, `watchdog_record_zero_ad_anomalies`,
   `watchdog_requeue_stale_jobs`, `page_is_verified_real_estate`).
5. The application's REST/RPC traffic resolves to `public` and `research`, not `research_legacy`.

## Recovery

- **Exact data + DDL recovery:** Supabase daily backups / PITR (Dashboard → Database → Backups).
- **Structure reference:** `DB_CLEANUP_2026-06-09_legacy_archive_backup.sql` (in this folder) contains
  the captured view and function definitions for `research_legacy`.

---

## research_legacy — tables (rows / size)

| Table | Est. rows | Size |
|---|---|---|
| ad_area_matches | 1431 | 1080 kB |
| ad_creative_versions | 904 | 2808 kB |
| ad_creatives | 332 | 3216 kB |
| ad_fetch_runs | 133 | 352 kB |
| ad_snapshots | 333 | 2464 kB |
| advertiser_pages | 212 | 320 kB |
| agencies | 179 | 240 kB |
| agent_decisions | 2929 | 4040 kB |
| agent_service_areas | 758 | 552 kB |
| agents | 415 | 416 kB |
| build_run_reports | 379 | 544 kB |
| build_runs | (empty) | 72 kB |
| coverage_audits | (empty) | 32 kB |
| coverage_defects | (empty) | 88 kB |
| ingest_events | 6420 | 3280 kB |
| media_assets | 570 | 1608 kB |
| observed_ads | 309 | 2344 kB |
| real_estate_verifications | 3675 | 2320 kB |
| refresh_policies | 25 | 64 kB |
| source_documents | 1778 | 1376 kB |
| work_queue | 1944 | 2312 kB |

### research_legacy — views (16, dropped with CASCADE)
v_active_ads_by_postcode, v_ad_hooks_by_suburb, v_agent_ad_history, v_competitors_by_postcode,
v_coverage_status, v_customer_meta_ad_library_cards, v_missing_competitors, v_operator_build_reports,
v_operator_missing_media, v_operator_page_verification_gaps, v_operator_provider_failures,
v_operator_unclassified_creatives, v_operator_work_queue_diagnostics, v_operator_work_queue_summary,
v_operator_zero_ad_anomalies, v_recent_creative_patterns

### research_legacy — functions (dropped with CASCADE)
claim_work_queue_jobs, creative_is_real_estate, jsonb_int, page_is_verified_real_estate,
record_ad_creative_version, set_updated_at, valid_external_ad_id, watchdog_record_missing_media,
watchdog_record_provider_failures, watchdog_record_unclassified_creatives,
watchdog_record_zero_ad_anomalies, watchdog_requeue_stale_jobs

---

## research_archive — tables (rows / size)

`hard_reset_202605300003_` snapshot tables (no indexes/PKs other than `hard_reset_manifests_pkey`):

ad_area_matches (988, 264 kB), ad_creatives (116, 328 kB), ad_fetch_runs (603, 520 kB),
ad_snapshots (232, 3080 kB), advertiser_pages (178, 72 kB), agencies (61, 24 kB),
agent_decisions (125, 72 kB), agent_service_areas (238, 72 kB), agents (16 kB),
coverage_audits (8 kB), coverage_defects (8 kB), ingest_events (1104, 8808 kB),
observed_ads (116, 920 kB), public_ad_screenshots/_campaign_ideas/_competitor_watchlists/
_competitors/_hooks/_landing_captures/_lead_magnets/_market_signals/_observed_ads/
_pattern_classifications/_source_evidence (all empty, 8 kB each), refresh_policies (121, 24 kB),
source_documents (288, 136 kB), and `hard_reset_manifests` (32 kB).

---

## Other changes applied in the same maintenance pass

See `DB_CLEANUP_2026-06-09_CHANGE_REPORT.md` for the full list (function lock-down, search_path
pinning, FK index additions, unused-index removal) and the deferred RLS/auth items.
