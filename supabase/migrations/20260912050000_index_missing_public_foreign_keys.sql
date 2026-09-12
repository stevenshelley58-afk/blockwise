-- Item 8 of the perf-top20 plan: index the referencing side of public foreign
-- keys that have no leading-column index.
--
-- Evidence (read-only catalog query, 2026-09-12): 22 public FKs have no index
-- whose first column is the FK column. The audit reported 30 (check 116) plus
-- 21 more (check 138); the live schema only has 22. Query used:
--
--   select n.nspname, c.conrelid::regclass, c.conname
--   from pg_constraint c
--   join pg_namespace n on n.oid = c.connamespace
--   where c.contype = 'f'
--     and n.nspname in ('public','private')
--     and not exists (
--       select 1 from pg_index i
--       where i.indrelid = c.conrelid
--         and i.indisvalid
--         and i.indkey[0] = c.conkey[1]
--     );
--
-- Locking: scripts/vps/product-migrate.sh wraps each migration in an explicit
-- begin/commit transaction, so CREATE INDEX CONCURRENTLY is not usable here
-- (it is rejected inside a transaction block). The precedent migration
-- 20260608214641_add_fk_covering_indexes_public_private.sql hit the same limit:
-- it was applied out-of-band and uses plain CREATE INDEX inside a DO block.
-- All 15 target tables are tiny (24 kB to 368 kB; the largest is
-- adstudio_provider_runs), so the ACCESS EXCLUSIVE lock from a plain CREATE
-- INDEX is held for milliseconds. If any table grows large before apply, run
-- that one index out-of-band with CONCURRENTLY instead.

-- adstudio_provider_runs
create index if not exists adstudio_provider_runs_model_profile_version_id_fk_idx
  on public.adstudio_provider_runs (model_profile_version_id);
comment on index public.adstudio_provider_runs_model_profile_version_id_fk_idx is
  'FK support for adstudio_provider_runs_model_profile_version_id_fkey lookups and parent delete/update checks.';

create index if not exists adstudio_provider_runs_pricing_snapshot_id_fk_idx
  on public.adstudio_provider_runs (pricing_snapshot_id);
comment on index public.adstudio_provider_runs_pricing_snapshot_id_fk_idx is
  'FK support for adstudio_provider_runs_pricing_snapshot_id_fkey lookups and parent delete/update checks.';

-- adstudio_provider_run_attempts
create index if not exists adstudio_provider_run_attempts_model_profile_version_id_fk_idx
  on public.adstudio_provider_run_attempts (model_profile_version_id);
comment on index public.adstudio_provider_run_attempts_model_profile_version_id_fk_idx is
  'FK support for adstudio_provider_run_attempts_model_profile_version_id_fkey lookups and parent delete/update checks.';

create index if not exists adstudio_provider_run_attempts_pricing_snapshot_id_fk_idx
  on public.adstudio_provider_run_attempts (pricing_snapshot_id);
comment on index public.adstudio_provider_run_attempts_pricing_snapshot_id_fk_idx is
  'FK support for adstudio_provider_run_attempts_pricing_snapshot_id_fkey lookups and parent delete/update checks.';

-- meta_publish_plans
create index if not exists meta_publish_plans_customer_ad_id_fk_idx
  on public.meta_publish_plans (customer_ad_id);
comment on index public.meta_publish_plans_customer_ad_id_fk_idx is
  'FK support for meta_publish_plans_customer_ad_id_fkey; existing composite index leads with workspace_id so it cannot serve a customer_ad_id lookup.';

create index if not exists meta_publish_plans_publication_snapshot_id_fk_idx
  on public.meta_publish_plans (publication_snapshot_id);
comment on index public.meta_publish_plans_publication_snapshot_id_fk_idx is
  'FK support for meta_publish_plans_publication_snapshot_id_fkey lookups and parent delete/update checks.';

-- property_checks
create index if not exists property_checks_created_by_fk_idx
  on public.property_checks (created_by);
comment on index public.property_checks_created_by_fk_idx is
  'FK support for property_checks_created_by_fkey lookups and parent delete/update checks.';

-- adstudio_generation_locks
create index if not exists adstudio_generation_locks_job_id_fk_idx
  on public.adstudio_generation_locks (job_id);
comment on index public.adstudio_generation_locks_job_id_fk_idx is
  'FK support for adstudio_generation_locks_job_id_fkey; existing index leads with workspace_id and is partial so it cannot serve a job_id lookup.';

-- adstudio_creative_revisions
create index if not exists adstudio_creative_revisions_created_by_fk_idx
  on public.adstudio_creative_revisions (created_by);
comment on index public.adstudio_creative_revisions_created_by_fk_idx is
  'FK support for adstudio_creative_revisions_created_by_fkey lookups and parent delete/update checks.';

-- workspace_credit_ledger
create index if not exists workspace_credit_ledger_actor_profile_id_fk_idx
  on public.workspace_credit_ledger (actor_profile_id);
comment on index public.workspace_credit_ledger_actor_profile_id_fk_idx is
  'FK support for workspace_credit_ledger_actor_profile_id_fkey lookups and parent delete/update checks.';

create index if not exists workspace_credit_ledger_workspace_id_fk_idx
  on public.workspace_credit_ledger (workspace_id);
comment on index public.workspace_credit_ledger_workspace_id_fk_idx is
  'FK support for workspace_credit_ledger_workspace_id_fkey; also serves per-workspace credit ledger reads.';

-- workspace_invitations
create index if not exists workspace_invitations_accepted_by_fk_idx
  on public.workspace_invitations (accepted_by);
comment on index public.workspace_invitations_accepted_by_fk_idx is
  'FK support for workspace_invitations_accepted_by_fkey lookups and parent delete/update checks.';

create index if not exists workspace_invitations_invited_by_fk_idx
  on public.workspace_invitations (invited_by);
comment on index public.workspace_invitations_invited_by_fk_idx is
  'FK support for workspace_invitations_invited_by_fkey lookups and parent delete/update checks.';

-- meta_partner_account_assignments
create index if not exists meta_partner_account_assignments_assigned_by_fk_idx
  on public.meta_partner_account_assignments (assigned_by);
comment on index public.meta_partner_account_assignments_assigned_by_fk_idx is
  'FK support for meta_partner_account_assignments_assigned_by_fkey lookups and parent delete/update checks.';

-- account_deletion_requests
create index if not exists account_deletion_requests_requested_by_fk_idx
  on public.account_deletion_requests (requested_by);
comment on index public.account_deletion_requests_requested_by_fk_idx is
  'FK support for account_deletion_requests_requested_by_fkey lookups and parent delete/update checks.';

-- ad_customer_ads
create index if not exists ad_customer_ads_template_id_direct_fk_idx
  on public.ad_customer_ads (template_id);
comment on index public.ad_customer_ads_template_id_direct_fk_idx is
  'FK support for ad_customer_ads_template_id_direct_fkey; existing index leads with workspace_id so it cannot serve a template_id lookup.';

-- ad_publication_snapshots
create index if not exists ad_publication_snapshots_form_draft_id_fk_idx
  on public.ad_publication_snapshots (form_draft_id);
comment on index public.ad_publication_snapshots_form_draft_id_fk_idx is
  'FK support for ad_publication_snapshots_form_draft_id_fkey lookups and parent delete/update checks.';

create index if not exists ad_publication_snapshots_revision_id_fk_idx
  on public.ad_publication_snapshots (revision_id);
comment on index public.ad_publication_snapshots_revision_id_fk_idx is
  'FK support for ad_publication_snapshots_revision_id_fkey; revision_id is only a trailing column of the existing unique index.';

-- adstudio_customer_image_uploads
create index if not exists adstudio_customer_image_uploads_ad_id_fk_idx
  on public.adstudio_customer_image_uploads (ad_id);
comment on index public.adstudio_customer_image_uploads_ad_id_fk_idx is
  'FK support for adstudio_customer_image_uploads_ad_id_fkey lookups and parent delete/update checks.';

-- outreach_campaign_drafts
create index if not exists outreach_campaign_drafts_area_snapshot_id_fk_idx
  on public.outreach_campaign_drafts (area_snapshot_id);
comment on index public.outreach_campaign_drafts_area_snapshot_id_fk_idx is
  'FK support for outreach_campaign_drafts_area_snapshot_id_fkey lookups and parent delete/update checks.';

create index if not exists outreach_campaign_drafts_prospect_id_fk_idx
  on public.outreach_campaign_drafts (prospect_id);
comment on index public.outreach_campaign_drafts_prospect_id_fk_idx is
  'FK support for outreach_campaign_drafts_prospect_id_fkey lookups and parent delete/update checks.';

-- lead_notice_records
create index if not exists lead_notice_records_recipient_profile_id_fk_idx
  on public.lead_notice_records (recipient_profile_id);
comment on index public.lead_notice_records_recipient_profile_id_fk_idx is
  'FK support for lead_notice_records_recipient_profile_id_fkey lookups and parent delete/update checks.';
