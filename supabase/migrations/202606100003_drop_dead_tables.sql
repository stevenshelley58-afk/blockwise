-- Retire dead tables (verified zero code references on 2026-06-10).
-- Most v1 tables were already removed by the 2026-06-09 DB cleanup; this
-- migration moves the remaining never-wired tables out of the API surface
-- into legacy_archive (non-destructive, reversible). Once confirmed safe,
-- a follow-up `drop schema legacy_archive cascade;` removes them for good.
-- Kept deliberately (live or in-flight): research.runtime_settings (watchdog
-- state), research.capture_actors + research.real_estate_verifications
-- (Hermes supervisor), research.ad_style_profiles, research.media_blobs,
-- research.target_manifest, research.source_fetch_log (Phase 1 feature).

begin;

create schema if not exists legacy_archive;
revoke all on schema legacy_archive from public, anon, authenticated;

-- The live campaigns table carried an FK column to the dead offer-templates
-- table; nothing in code reads offer_template_id. Dropping the column severs
-- the FK so the referenced table can leave the public schema.
alter table if exists public.adstudio_campaigns drop column if exists offer_template_id;

-- Empty, never-wired tables (agent_permissions holds 11 seeded rows; all
-- others were empty at archive time).
alter table if exists public.agent_permissions set schema legacy_archive;
alter table if exists public.adstudio_creative_objects set schema legacy_archive;
alter table if exists public.adstudio_exports set schema legacy_archive;
alter table if exists public.adstudio_offer_templates set schema legacy_archive;
alter table if exists public.adstudio_template_versions set schema legacy_archive;
alter table if exists public.agent_reviews set schema legacy_archive;
alter table if exists public.agent_schedules set schema legacy_archive;
alter table if exists public.ai_cost_policies set schema legacy_archive;
alter table if exists public.approval_comments set schema legacy_archive;
alter table if exists public.blocked_ai_outputs set schema legacy_archive;
alter table if exists public.creative_files set schema legacy_archive;
alter table if exists public.campaign_assets set schema legacy_archive;
alter table if exists public.cross_workspace_access_grants set schema legacy_archive;
alter table if exists public.google_lead_forms set schema legacy_archive;
alter table if exists public.lead_export_audits set schema legacy_archive;
alter table if exists public.lead_imports set schema legacy_archive;
alter table if exists public.model_fallbacks set schema legacy_archive;
alter table if exists public.provider_mappings set schema legacy_archive;
alter table if exists research.synthetic_agents set schema legacy_archive;

-- Status columns filtered by Hermes matching and AdStudio list queries.
create index if not exists agents_status_idx on research.agents (status);
create index if not exists agencies_status_idx on research.agencies (status);
create index if not exists adstudio_campaigns_status_idx on public.adstudio_campaigns (status);

commit;
