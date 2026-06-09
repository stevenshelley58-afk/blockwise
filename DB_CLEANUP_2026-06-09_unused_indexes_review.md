# Unused Indexes — Review List (2026-06-09)

These indexes currently show `idx_scan = 0` (never used since stats were last reset).
**They were NOT dropped automatically.** On this ~2-week-old, low-traffic database, "unused"
mostly means "the feature hasn't seen traffic yet," not "dead weight." Most are deliberate
**search** and **operator-analytics/traceability** indexes. Dropping them could silently slow
or break those features once they're exercised.

Review at your leisure. To drop any subset, tell me which and I'll remove them with
`DROP INDEX CONCURRENTLY` (and they're all recreatable from the definitions below).

> Already removed: `research.ad_creative_versions_creative_idx` — a true duplicate, fully
> covered by the unique index `ad_creative_versions_ad_creative_id_version_key`.

## Search indexes (GIN full-text / trigram) — keep unless the search feature is unused
| Index | Table | Size | Definition |
|---|---|---|---|
| ad_creatives_search_idx | research.ad_creatives | 6800 kB | GIN (search_tsv) |
| ad_creatives_classification_gin_idx | research.ad_creatives | 1792 kB | GIN (classification) |
| location_links_suburb_trgm_idx | research.location_links | 464 kB | GIN (suburb gin_trgm_ops) |
| agents_name_trgm_idx | research.agents | 368 kB | GIN (full_name gin_trgm_ops) |
| agencies_name_trgm_idx | research.agencies | 248 kB | GIN (name gin_trgm_ops) |
| agents_search_idx | research.agents | 128 kB | GIN (search_tsv) |
| advertiser_pages_search_idx | research.advertiser_pages | 96 kB | GIN (search_tsv) |
| locations_suburb_trgm_idx | research.locations | 64 kB | GIN (suburb gin_trgm_ops) |
| agencies_search_idx | research.agencies | 64 kB | GIN (search_tsv) |
| listings_search_idx | research.listings | 24 kB | GIN (search_tsv) |

## Operator analytics / traceability indexes — keep (back operator dashboards & cost reporting)
These are composite indexes on `workspace_id, correlation_id, created_at` and cost-filter
columns, added by the `traceability_edges`, `adstudio_provider_run_traceability`, and
`operator_role_access` migrations. Tables are near-empty today, so they read as unused.

adstudio_provider_runs: workspace_trace_idx, operator_cost_filters_idx, task_model_profile_idx,
ledger_idx, ai_run_idx, job_idx · ai_runs: workspace_created_idx, workspace_trace_idx,
operator_cost_filters_idx · ai_usage_ledger: operator_cost_filters_idx, workspace_trace_idx ·
audit_logs: workspace_correlation_idx, actor_target_idx · agent_runs: user_correlation_idx ·
agent_artifacts: correlation_idx, run_idx · lead_source_attribution: trace_idx,
publish_plan_idx, approval_idx · lead_export_audits: trace_idx · approval_requests:
correlation_idx · adstudio_exports: campaign_idx · adstudio_job_runs: workspace_status_idx

## Secondary lookup indexes — keep (will be used as tables fill)
research.ad_creatives.ad_creatives_hash_idx (creative_hash, 432 kB) ·
research.location_links.location_links_location_idx · research.listings.listings_agent_idx ·
research.listings.listings_type_idx · research.locations.locations_locality_key_idx ·
research.coverage_audits.coverage_audits_postcode_idx · research.agencies.agencies_brand_idx

## Note on the new FK indexes
The ~50 covering indexes added for foreign keys in this pass will also show as "unused" until
queries exercise them — that is expected and is the standard remedy for the
`unindexed_foreign_keys` advisor.
