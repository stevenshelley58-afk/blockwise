-- Advisor cleanup: foreign-key covering indexes + RLS initplan optimization.
--
-- Additive and idempotent. Safe to run on an existing production database:
-- it only ADDs indexes and rewrites three RLS policies to a behaviour-
-- preserving form. It changes no table data, no column, no API response
-- shape, no provider behaviour, and no auth behaviour (the policy predicates
-- are byte-for-byte equivalent; only the evaluation plan changes).
--
-- Part A — Unindexed foreign keys (Supabase linter 0001).
--   Adds a covering index for every foreign key in the app-owned schemas
--   (public, private, research) that lacked one. Supabase-managed schemas
--   (auth, storage) and the deprecated research_legacy schema are
--   intentionally excluded.
--
-- Part B — Auth RLS initplan (Supabase linter 0003).
--   Wraps auth.uid() in a scalar sub-select so it is evaluated once per
--   statement instead of once per row. See:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select p.is_operator from public.profiles p where p.id = (select auth.uid())), false)
    or exists (
      select 1
      from public.workspace_members wm
      where wm.profile_id = (select auth.uid())
        and wm.role = 'operator'
    );
$$;

comment on function public.is_operator() is
  'True for profile-level operators and users assigned the operator workspace role.';

-- =====================================================================
-- Part A: foreign-key covering indexes
-- =====================================================================

-- private
do $$
begin
  execute 'create index if not exists provider_token_vault_workspace_id_idx on private.provider_token_vault (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping provider_token_vault_workspace_id_idx: %', sqlerrm;
end
$$;

-- public
do $$
begin
  execute 'create index if not exists adstudio_brand_assets_brand_kit_id_idx on public.adstudio_brand_assets (brand_kit_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_brand_assets_brand_kit_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_brand_assets_workspace_id_idx on public.adstudio_brand_assets (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_brand_assets_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_brand_kits_created_by_idx on public.adstudio_brand_kits (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_brand_kits_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_campaign_variants_workspace_id_idx on public.adstudio_campaign_variants (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_campaign_variants_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_campaigns_brand_kit_id_idx on public.adstudio_campaigns (brand_kit_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_campaigns_brand_kit_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_campaigns_created_by_idx on public.adstudio_campaigns (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_campaigns_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_campaigns_legacy_campaign_id_idx on public.adstudio_campaigns (legacy_campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_campaigns_legacy_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_campaigns_offer_template_id_idx on public.adstudio_campaigns (offer_template_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_campaigns_offer_template_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_compliance_reports_campaign_id_idx on public.adstudio_compliance_reports (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_compliance_reports_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_compliance_reports_variant_id_idx on public.adstudio_compliance_reports (variant_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_compliance_reports_variant_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_compliance_reports_workspace_id_idx on public.adstudio_compliance_reports (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_compliance_reports_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_creative_objects_asset_id_idx on public.adstudio_creative_objects (asset_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_creative_objects_asset_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_creative_objects_creative_id_idx on public.adstudio_creative_objects (creative_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_creative_objects_creative_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_creative_objects_workspace_id_idx on public.adstudio_creative_objects (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_creative_objects_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_creatives_variant_id_idx on public.adstudio_creatives (variant_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_creatives_variant_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_creatives_workspace_id_idx on public.adstudio_creatives (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_creatives_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_exports_approval_request_id_idx on public.adstudio_exports (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_exports_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_exports_created_by_idx on public.adstudio_exports (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_exports_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_exports_workspace_id_idx on public.adstudio_exports (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_exports_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_performance_imports_campaign_id_idx on public.adstudio_performance_imports (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_performance_imports_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_performance_imports_imported_by_idx on public.adstudio_performance_imports (imported_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_performance_imports_imported_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_performance_imports_workspace_id_idx on public.adstudio_performance_imports (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_performance_imports_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_platform_copy_campaign_id_idx on public.adstudio_platform_copy (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_platform_copy_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_platform_copy_variant_id_idx on public.adstudio_platform_copy (variant_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_platform_copy_variant_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_platform_copy_workspace_id_idx on public.adstudio_platform_copy (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_platform_copy_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_provider_runs_ai_run_id_idx on public.adstudio_provider_runs (ai_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_provider_runs_ai_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_provider_runs_ai_usage_ledger_id_idx on public.adstudio_provider_runs (ai_usage_ledger_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_provider_runs_ai_usage_ledger_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_provider_runs_campaign_id_idx on public.adstudio_provider_runs (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_provider_runs_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_provider_runs_prompt_version_id_idx on public.adstudio_provider_runs (prompt_version_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_provider_runs_prompt_version_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_provider_runs_user_id_idx on public.adstudio_provider_runs (user_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_provider_runs_user_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists adstudio_template_versions_workspace_id_idx on public.adstudio_template_versions (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping adstudio_template_versions_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_artifacts_agent_run_id_idx on public.agent_artifacts (agent_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_artifacts_agent_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_reviews_agent_run_id_idx on public.agent_reviews (agent_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_reviews_agent_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_reviews_reviewer_profile_id_idx on public.agent_reviews (reviewer_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_reviews_reviewer_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_reviews_workspace_id_idx on public.agent_reviews (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_reviews_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_runs_agent_definition_id_idx on public.agent_runs (agent_definition_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_runs_agent_definition_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_runs_ai_run_id_idx on public.agent_runs (ai_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_runs_ai_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_runs_approval_request_id_idx on public.agent_runs (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_runs_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_runs_user_id_idx on public.agent_runs (user_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_runs_user_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_schedules_agent_definition_id_idx on public.agent_schedules (agent_definition_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_schedules_agent_definition_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_schedules_workspace_id_idx on public.agent_schedules (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_schedules_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_steps_agent_run_id_idx on public.agent_steps (agent_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_steps_agent_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_steps_workspace_id_idx on public.agent_steps (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_steps_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_cost_policies_model_profile_id_idx on public.ai_cost_policies (model_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_cost_policies_model_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_cost_policies_workspace_id_idx on public.ai_cost_policies (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_cost_policies_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_runs_model_profile_id_idx on public.ai_runs (model_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_runs_model_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_runs_prompt_version_id_idx on public.ai_runs (prompt_version_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_runs_prompt_version_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_runs_user_id_idx on public.ai_runs (user_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_runs_user_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_usage_ledger_ai_run_id_idx on public.ai_usage_ledger (ai_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_usage_ledger_ai_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ai_usage_ledger_user_id_idx on public.ai_usage_ledger (user_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ai_usage_ledger_user_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists approval_comments_approval_request_id_idx on public.approval_comments (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping approval_comments_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists approval_comments_profile_id_idx on public.approval_comments (profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping approval_comments_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists approval_comments_workspace_id_idx on public.approval_comments (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping approval_comments_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists approval_requests_approved_by_idx on public.approval_requests (approved_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping approval_requests_approved_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists approval_requests_requested_by_idx on public.approval_requests (requested_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping approval_requests_requested_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists audit_logs_actor_profile_id_idx on public.audit_logs (actor_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping audit_logs_actor_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists blocked_ai_outputs_ai_run_id_idx on public.blocked_ai_outputs (ai_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping blocked_ai_outputs_ai_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists blocked_ai_outputs_reviewer_profile_id_idx on public.blocked_ai_outputs (reviewer_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping blocked_ai_outputs_reviewer_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists blocked_ai_outputs_workspace_id_idx on public.blocked_ai_outputs (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping blocked_ai_outputs_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists campaign_assets_campaign_id_idx on public.campaign_assets (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping campaign_assets_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists campaign_assets_workspace_id_idx on public.campaign_assets (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping campaign_assets_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists campaigns_created_by_idx on public.campaigns (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping campaigns_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists campaigns_workspace_id_idx on public.campaigns (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping campaigns_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists content_artifacts_prompt_template_id_idx on public.content_artifacts (prompt_template_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping content_artifacts_prompt_template_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists content_artifacts_workspace_id_idx on public.content_artifacts (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping content_artifacts_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists content_reviews_workspace_id_idx on public.content_reviews (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping content_reviews_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists content_runs_operator_user_id_idx on public.content_runs (operator_user_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping content_runs_operator_user_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists content_runs_prompt_set_id_idx on public.content_runs (prompt_set_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping content_runs_prompt_set_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists creative_files_ai_run_id_idx on public.creative_files (ai_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping creative_files_ai_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists creative_files_campaign_asset_id_idx on public.creative_files (campaign_asset_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping creative_files_campaign_asset_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists creative_files_workspace_id_idx on public.creative_files (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping creative_files_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists cross_workspace_access_grants_agent_run_id_idx on public.cross_workspace_access_grants (agent_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping cross_workspace_access_grants_agent_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists cross_workspace_access_grants_approval_request_id_idx on public.cross_workspace_access_grants (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping cross_workspace_access_grants_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists cross_workspace_access_grants_created_by_idx on public.cross_workspace_access_grants (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping cross_workspace_access_grants_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists cross_workspace_access_grants_source_workspace_id_idx on public.cross_workspace_access_grants (source_workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping cross_workspace_access_grants_source_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists cross_workspace_access_grants_target_workspace_id_idx on public.cross_workspace_access_grants (target_workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping cross_workspace_access_grants_target_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists google_lead_forms_lead_id_idx on public.google_lead_forms (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping google_lead_forms_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_dedupe_records_duplicate_of_lead_id_idx on public.lead_dedupe_records (duplicate_of_lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_dedupe_records_duplicate_of_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_dedupe_records_lead_id_idx on public.lead_dedupe_records (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_dedupe_records_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_events_lead_id_idx on public.lead_events (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_events_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_events_workspace_id_idx on public.lead_events (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_events_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_export_audits_approval_request_id_idx on public.lead_export_audits (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_export_audits_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_export_audits_exported_by_idx on public.lead_export_audits (exported_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_export_audits_exported_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_imports_imported_by_idx on public.lead_imports (imported_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_imports_imported_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_imports_workspace_id_idx on public.lead_imports (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_imports_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_quality_labels_lead_id_idx on public.lead_quality_labels (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_quality_labels_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_quality_labels_workspace_id_idx on public.lead_quality_labels (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_quality_labels_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_source_attribution_adstudio_campaign_id_idx on public.lead_source_attribution (adstudio_campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_source_attribution_adstudio_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_source_attribution_approval_request_id_idx on public.lead_source_attribution (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_source_attribution_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_source_attribution_campaign_id_idx on public.lead_source_attribution (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_source_attribution_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists lead_source_attribution_lead_id_idx on public.lead_source_attribution (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping lead_source_attribution_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists meta_leads_lead_id_idx on public.meta_leads (lead_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping meta_leads_lead_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists model_fallbacks_fallback_version_id_idx on public.model_fallbacks (fallback_version_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping model_fallbacks_fallback_version_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists model_profile_versions_model_profile_id_idx on public.model_profile_versions (model_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping model_profile_versions_model_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists operator_approvals_approved_by_idx on public.operator_approvals (approved_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping operator_approvals_approved_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists operator_approvals_workspace_id_idx on public.operator_approvals (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping operator_approvals_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_runs_prompt_template_id_idx on public.prompt_runs (prompt_template_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_runs_prompt_template_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_runs_workspace_id_idx on public.prompt_runs (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_runs_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_set_items_prompt_template_id_idx on public.prompt_set_items (prompt_template_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_set_items_prompt_template_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_templates_created_by_idx on public.prompt_templates (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_templates_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_versions_created_by_idx on public.prompt_versions (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_versions_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_versions_model_profile_id_idx on public.prompt_versions (model_profile_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_versions_model_profile_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists prompt_versions_workspace_id_idx on public.prompt_versions (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping prompt_versions_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists provider_connections_created_by_idx on public.provider_connections (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping provider_connections_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists publish_statuses_approval_request_id_idx on public.publish_statuses (approval_request_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping publish_statuses_approval_request_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists publish_statuses_campaign_id_idx on public.publish_statuses (campaign_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping publish_statuses_campaign_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists publish_statuses_workspace_id_idx on public.publish_statuses (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping publish_statuses_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists sync_runs_workspace_id_idx on public.sync_runs (workspace_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping sync_runs_workspace_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists workspaces_created_by_idx on public.workspaces (created_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping workspaces_created_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists workspaces_plan_id_idx on public.workspaces (plan_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping workspaces_plan_id_idx: %', sqlerrm;
end
$$;

-- research
do $$
begin
  execute 'create index if not exists ad_creative_versions_ad_snapshot_id_idx on research.ad_creative_versions (ad_snapshot_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_creative_versions_ad_snapshot_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_creative_versions_observed_ad_id_idx on research.ad_creative_versions (observed_ad_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_creative_versions_observed_ad_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_creatives_ad_snapshot_id_idx on research.ad_creatives (ad_snapshot_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_creatives_ad_snapshot_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_fetch_runs_build_run_id_idx on research.ad_fetch_runs (build_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_fetch_runs_build_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_fetch_runs_source_document_id_idx on research.ad_fetch_runs (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_fetch_runs_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_fetch_runs_work_queue_id_idx on research.ad_fetch_runs (work_queue_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_fetch_runs_work_queue_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ad_snapshots_ad_fetch_run_id_idx on research.ad_snapshots (ad_fetch_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ad_snapshots_ad_fetch_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists advertiser_pages_resolution_decision_id_idx on research.advertiser_pages (resolution_decision_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping advertiser_pages_resolution_decision_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_decisions_superseded_by_idx on research.agent_decisions (superseded_by)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_decisions_superseded_by_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agent_service_areas_source_document_id_idx on research.agent_service_areas (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agent_service_areas_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists agents_primary_location_id_idx on research.agents (primary_location_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping agents_primary_location_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists build_run_reports_source_document_id_idx on research.build_run_reports (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping build_run_reports_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists build_runs_work_queue_id_idx on research.build_runs (work_queue_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping build_runs_work_queue_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_audits_decided_by_decision_id_idx on research.coverage_audits (decided_by_decision_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_audits_decided_by_decision_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_audits_source_document_id_idx on research.coverage_audits (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_audits_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_defects_resolution_decision_id_idx on research.coverage_defects (resolution_decision_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_defects_resolution_decision_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_defects_resolved_advertiser_page_id_idx on research.coverage_defects (resolved_advertiser_page_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_defects_resolved_advertiser_page_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_defects_resolved_agency_id_idx on research.coverage_defects (resolved_agency_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_defects_resolved_agency_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists coverage_defects_resolved_agent_id_idx on research.coverage_defects (resolved_agent_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping coverage_defects_resolved_agent_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ingest_events_ad_fetch_run_id_idx on research.ingest_events (ad_fetch_run_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ingest_events_ad_fetch_run_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ingest_events_agent_decision_id_idx on research.ingest_events (agent_decision_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ingest_events_agent_decision_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists ingest_events_source_document_id_idx on research.ingest_events (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping ingest_events_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists location_links_source_document_id_idx on research.location_links (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping location_links_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists real_estate_verifications_agency_id_idx on research.real_estate_verifications (agency_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping real_estate_verifications_agency_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists real_estate_verifications_agent_id_idx on research.real_estate_verifications (agent_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping real_estate_verifications_agent_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists real_estate_verifications_source_document_id_idx on research.real_estate_verifications (source_document_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping real_estate_verifications_source_document_id_idx: %', sqlerrm;
end
$$;
do $$
begin
  execute 'create index if not exists work_queue_advertiser_page_id_idx on research.work_queue (advertiser_page_id)';
exception when undefined_column or undefined_table then
  raise notice 'skipping work_queue_advertiser_page_id_idx: %', sqlerrm;
end
$$;

-- =====================================================================
-- Part B: RLS initplan optimization (behaviour-preserving)
-- Predicates are unchanged; auth.uid() is wrapped in (select ...) so the
-- planner evaluates it once per statement instead of once per row.
-- =====================================================================

drop policy if exists profiles_select_self_or_operator on public.profiles;
create policy profiles_select_self_or_operator on public.profiles
  for select using (id = (select auth.uid()) or public.is_operator());

drop policy if exists profiles_update_self_or_operator on public.profiles;
create policy profiles_update_self_or_operator on public.profiles
  for update using (id = (select auth.uid()) or public.is_operator())
  with check (id = (select auth.uid()) or public.is_operator());

drop policy if exists workspaces_insert_authenticated on public.workspaces;
create policy workspaces_insert_authenticated on public.workspaces
  for insert to authenticated
  with check (created_by = (select auth.uid()) or public.is_operator());
