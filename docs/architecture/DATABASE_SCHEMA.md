# Database schema

Source of truth: `supabase/migrations/*.sql` (applied in filename order). This is
a human-readable digest — when in doubt, read the migrations.

Three Postgres schemas:

- **`public`** — the application (workspaces, AdStudio, AI Workforce, providers,
  leads, reporting).
- **`research`** — the Hermes research engine (real-estate agents/agencies,
  advertiser pages, observed ads). Rebuilt by `202605300003_…hard_reset…`.
- **`private`** — secrets not readable by clients (`provider_token_vault`).

> ## Naming: `public.agent_*` vs `research.agents`
> `public.agent_definitions / agent_runs / agent_steps / agent_artifacts /
> agent_schedules / agent_reviews / agent_permissions` belong to the **AI
> Workforce** (the automation bots; code in `src/modules/ai-workforce/`).
> `research.agents` and `research.agencies` are **real-estate people** (the
> entities Hermes researches). They are different concepts in different schemas
> and must never be conflated. See `CLAUDE.md`.

## `public` — core tenancy & access

| Table | Purpose |
| --- | --- |
| `profiles` | One per auth user. `is_operator boolean` is the sole operator source of truth. |
| `workspace_plans` | Plan tiers (limits, e.g. `max_agent_runs_per_month`). |
| `workspaces` | Tenant. `mode` ∈ {`monitor`,`self_serve`}, plus plan, region, managed-service flags. |
| `workspace_members` | Membership. `role` ∈ {`owner`,`admin`,`member`,`viewer`,`operator`} (text CHECK). |
| `audit_logs` | `workspace_id`, `actor_profile_id`, `action`, `target_type`, `target_id (uuid)`, `metadata jsonb`. Written via `recordAudit`. |
| `rate_limits` | Per-subject rate limiting. |
| `cross_workspace_access_grants` | Explicit, audited cross-workspace grants (default deny). |

## `public` — model & AI control

| Table | Purpose |
| --- | --- |
| `model_profiles`, `model_profile_versions`, `model_fallbacks` | Model registry + per-workspace overrides + fallback chains. |
| `prompt_versions` | Versioned prompts. |
| `ai_cost_policies` | Per-profile cost ceilings (`maxRunCostUsd`). |
| `ai_runs`, `ai_usage_ledger` | Every AI call + token/cost ledger. |
| `blocked_ai_outputs` | Runs blocked by cost/data-class policy. |

## `public` — AI Workforce (automation)

| Table | Purpose |
| --- | --- |
| `agent_definitions`, `agent_permissions` | The 9 automation agents + their allowed actions/data classes. |
| `agent_runs`, `agent_steps`, `agent_artifacts` | Run lifecycle, per-decision steps, reviewable outputs. |
| `agent_schedules`, `agent_reviews` | Scheduling + human review records. |

## `public` — AdStudio

`adstudio_brand_kits`, `adstudio_brand_assets`, `adstudio_offer_templates`,
`adstudio_campaigns`, `adstudio_campaign_variants`, `adstudio_creatives`,
`adstudio_creative_objects`, `adstudio_platform_copy`, `adstudio_exports`,
`adstudio_compliance_reports`, `adstudio_provider_runs`,
`adstudio_template_versions`, `adstudio_job_runs`, `adstudio_performance_imports`.

## `public` — providers, publishing & leads

| Table | Purpose |
| --- | --- |
| `provider_connections` | OAuth connection metadata (tokens live in `private.provider_token_vault`). |
| `meta_publish_plans`, `meta_publish_plan_mutations`, `lead_delivery_attempts` | Meta execution state machine + queued mutations + lead delivery. |
| `meta_data_deletion_requests` | Meta data-deletion callbacks. |
| `provider_mappings`, `publish_statuses` | Local↔provider object mapping + publish state. |
| `campaigns`, `campaign_assets`, `creative_files` | Legacy campaign entities. |
| `approval_requests`, `approval_comments` | Human approval gates. |
| `leads`, `lead_events`, `lead_dedupe_records`, `lead_quality_labels`, `lead_source_attribution` | Lead inbox, dedupe, quality, attribution. |
| `meta_leads`, `google_lead_forms`, `lead_imports`, `lead_export_audits` | Provider lead intake + export audit. |
| `reporting_snapshots`, `sync_runs` | Reporting aggregates + sync job history. |

> Legacy competitor/research tables in `public` (`competitors`, `observed_ads`,
> `pattern_classifications`, `campaign_ideas`, …) predate the Hermes research
> engine. New research work uses the `research` schema.

## `research` (Hermes) — current schema

Defined by `202605300003_blockwise_hard_reset_clean_schema.sql`:

| Group | Tables |
| --- | --- |
| Entities | `agencies`, `agents`, `agent_service_areas`, `real_estate_verifications` |
| Evidence | `source_documents`, `agent_decisions` (every write needs a decision row) |
| Advertiser pages & ads | `advertiser_pages`, `ad_fetch_runs`, `observed_ads`, `ad_snapshots`, `ad_creatives`, `ad_creative_versions`, `media_assets`, `ad_area_matches` |
| Coverage | `coverage_audits`, `coverage_defects` |
| Orchestration | `work_queue`, `build_runs`, `build_run_reports`, `refresh_policies`, `ingest_events` |

Read views (`research.v_*`) back the operator research console and the
`/api/operator/research/*` endpoints. See `docs/research-engine/`.

## `private`

| Table | Purpose |
| --- | --- |
| `provider_token_vault` | Encrypted OAuth/refresh tokens + app secrets. Never workspace-readable. |

## RLS

Workspace-scoped `public` tables enable RLS with policies of the form
`public.is_operator() OR public.is_workspace_member(workspace_id)` for select and
role-gated inserts (see `202605260001` / `202605270001`). Trigger.dev jobs use the
service-role key and **bypass RLS**, so they enforce access in code via
`assertJobCapability`.
