import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202605270003_adstudio.sql";
const alignmentMigrationPath = "supabase/migrations/202605270004_adstudio_live_schema_alignment.sql";
const traceabilityMigrationPath = "supabase/migrations/202606050002_adstudio_provider_run_traceability.sql";
const traceEdgesMigrationPath = "supabase/migrations/202606050004_traceability_edges.sql";
const providerCostMigrationPath = "supabase/migrations/202607130001_adstudio_provider_cost_accounting.sql";
const providerCostDbTestPath = "supabase/tests/adstudio_provider_cost_accounting.test.sql";

const workspaceTables = [
  "adstudio_brand_kits",
  "adstudio_brand_assets",
  "adstudio_offer_templates",
  "adstudio_campaigns",
  "adstudio_campaign_variants",
  "adstudio_creatives",
  "adstudio_creative_objects",
  "adstudio_platform_copy",
  "adstudio_exports",
  "adstudio_compliance_reports",
  "adstudio_provider_runs",
  "adstudio_job_runs",
  "adstudio_performance_imports",
];

test("adstudio migration creates all workspace-scoped tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const tableName of workspaceTables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}`, "i"));
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}[\\s\\S]*workspace_id uuid not null`, "i"));
  }
});

test("adstudio migration enables RLS and workspace policies for all adstudio tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const tableName of workspaceTables) {
    assert.match(sql, new RegExp(`alter table public\\.${tableName} enable row level security`, "i"));
  }

  assert.match(sql, /create policy adstudio_workspace_select/i);
  assert.match(sql, /create policy adstudio_workspace_insert/i);
  assert.match(sql, /create policy adstudio_workspace_update/i);
  assert.match(sql, /create policy adstudio_workspace_delete/i);
});

test("adstudio migration makes provider and job run writes server-owned", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const tableName of ["adstudio_provider_runs", "adstudio_job_runs"]) {
    assert.match(sql, new RegExp(`drop policy if exists adstudio_workspace_insert on public\\.${tableName}`, "i"));
    assert.match(sql, new RegExp(`create policy ${tableName}_server_owned_no_client_insert`, "i"));
  }
});

test("adstudio migrations do not reinstall the removed template registry table", () => {
  const migrationSql = readFileSync(migrationPath, "utf8");
  const alignmentSql = readFileSync(alignmentMigrationPath, "utf8");
  const removedRegistryTable = ["adstudio", "template", "versions"].join("_");

  assert.equal(`${migrationSql}\n${alignmentSql}`.toLowerCase().includes(removedRegistryTable), false);
});

test("adstudio live alignment guards legacy column alters for fresh preview databases", () => {
  const sql = readFileSync(alignmentMigrationPath, "utf8");

  for (const [tableName, columnName] of [
    ["adstudio_platform_copy", "platform"],
    ["adstudio_provider_runs", "provider"],
  ]) {
    const guardedAlter = new RegExp(
      `information_schema\\.columns[\\s\\S]*table_name = '${tableName}'[\\s\\S]*column_name = '${columnName}'[\\s\\S]*alter table public\\.${tableName} alter column ${columnName} drop not null`,
      "i",
    );

    assert.match(sql, guardedAlter);
  }
});

test("adstudio provider run traceability migration links users, ledger rows, and correlation ids", () => {
  const sql = readFileSync(traceabilityMigrationPath, "utf8");

  assert.match(sql, /alter table public\.adstudio_provider_runs[\s\S]*add column if not exists user_id uuid references public\.profiles/i);
  assert.match(sql, /add column if not exists correlation_id text/i);
  assert.match(sql, /add column if not exists ai_run_id uuid references public\.ai_runs/i);
  assert.match(sql, /add column if not exists task_type text/i);
  assert.match(sql, /add column if not exists model_profile text/i);
  assert.match(sql, /add column if not exists ai_usage_ledger_id uuid references public\.ai_usage_ledger/i);
  assert.match(sql, /alter table public\.ai_runs[\s\S]*add column if not exists correlation_id text/i);
  assert.match(sql, /alter table public\.ai_usage_ledger[\s\S]*add column if not exists correlation_id text/i);
  assert.match(sql, /adstudio_provider_runs_operator_cost_filters_idx/i);
  assert.match(sql, /adstudio_provider_runs_task_model_profile_idx/i);
  assert.match(sql, /adstudio_provider_runs_ledger_idx/i);
  assert.match(sql, /adstudio_provider_runs_ai_run_idx/i);
  assert.match(sql, /adstudio_provider_runs_job_idx/i);
  assert.match(sql, /ai_runs_operator_cost_filters_idx/i);
  assert.match(sql, /ai_usage_ledger_operator_cost_filters_idx/i);
  assert.match(sql, /workspace_id, correlation_id, created_at desc/i);
});

test("traceability edge migration adds correlation ids across approvals artifacts leads and audit logs", () => {
  const sql = readFileSync(traceEdgesMigrationPath, "utf8");

  for (const [tableName, columnName] of [
    ["audit_logs", "correlation_id"],
    ["agent_runs", "correlation_id"],
    ["agent_artifacts", "correlation_id"],
    ["lead_source_attribution", "correlation_id"],
    ["lead_delivery_attempts", "correlation_id"],
    ["lead_export_audits", "correlation_id"],
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${tableName}[\\s\\S]*add column if not exists ${columnName} text`, "i"));
  }

  assert.match(sql, /alter table public\.agent_runs[\s\S]*add column if not exists user_id uuid references public\.profiles/i);
  assert.match(sql, /add column if not exists meta_publish_plan_id uuid/i);
  assert.match(sql, /add column if not exists adstudio_campaign_id uuid/i);
  assert.match(sql, /add column if not exists approval_request_id uuid/i);
  assert.match(sql, /to_regclass\('public\.meta_publish_plans'\) is not null/i);
  assert.match(sql, /references public\.meta_publish_plans \(id\)/i);
  assert.match(sql, /to_regclass\('public\.adstudio_campaigns'\) is not null/i);
  assert.match(sql, /references public\.adstudio_campaigns \(id\)/i);
  assert.match(sql, /to_regclass\('public\.approval_requests'\) is not null/i);
  assert.match(sql, /references public\.approval_requests \(id\)/i);
  assert.match(
    sql,
    /if to_regclass\('public\.approval_requests'\) is not null then\s*alter table public\.approval_requests\s*add column if not exists correlation_id text;\s*end if;/i,
  );
  assert.match(
    sql,
    /if to_regclass\('public\.approval_requests'\) is not null then[\s\S]*table_name = 'approval_requests'[\s\S]*approval_requests_target_idx[\s\S]*approval_requests_correlation_idx[\s\S]*end if;\s*end \$\$/i,
  );
  assert.match(sql, /to_regclass\('public\.lead_delivery_attempts'\) is not null[\s\S]*alter table public\.lead_delivery_attempts[\s\S]*add column if not exists correlation_id text/i);
  assert.match(sql, /to_regclass\('public\.lead_export_audits'\) is not null[\s\S]*alter table public\.lead_export_audits[\s\S]*add column if not exists correlation_id text/i);
  assert.match(sql, /to_regclass\('public\.lead_delivery_attempts'\) is not null[\s\S]*lead_delivery_attempts_trace_idx/i);
  assert.match(sql, /to_regclass\('public\.lead_export_audits'\) is not null[\s\S]*lead_export_audits_trace_idx/i);
  assert.match(sql, /audit_logs_workspace_correlation_idx/i);
  assert.match(sql, /approval_requests_correlation_idx/i);
  assert.match(sql, /agent_runs_user_correlation_idx/i);
  assert.match(sql, /agent_artifacts_correlation_idx/i);
  assert.match(sql, /lead_source_attribution_trace_idx/i);
  assert.match(sql, /lead_delivery_attempts_trace_idx/i);
  assert.match(sql, /lead_export_audits_trace_idx/i);
});

test("provider cost migration installs precise attempt accounting and atomic service-role RPC", () => {
  assert.equal(existsSync(providerCostMigrationPath), true);
  const sql = readFileSync(providerCostMigrationPath, "utf8");

  assert.match(sql, /create table public\.adstudio_provider_run_attempts/i);
  assert.match(sql, /estimated_cost_usd numeric\(14,\s*6\)/i);
  assert.match(sql, /actual_cost_usd numeric\(14,\s*6\)/i);
  assert.match(sql, /billing_status text[^;]*check[^;]*unreconciled/is);
  assert.match(sql, /foreign key \(workspace_id, provider_run_id\)[\s\S]*references public\.adstudio_provider_runs \(workspace_id, id\)/i);
  assert.match(sql, /unique \(workspace_id, mutation_id\)/i);
  assert.match(sql, /alter table public\.adstudio_provider_run_attempts enable row level security/i);
  assert.match(sql, /private\.adstudio_has_workspace_access\(workspace_id\)/i);
  assert.match(sql, /create (?:or replace )?function public\.adstudio_record_provider_run/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.adstudio_record_provider_run[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.adstudio_record_provider_run[\s\S]*to service_role/i);
  assert.match(sql, /insert into public\.ai_runs[\s\S]*insert into public\.ai_usage_ledger[\s\S]*insert into public\.adstudio_provider_runs[\s\S]*insert into public\.adstudio_provider_run_attempts/i);
  assert.match(sql, /payload_hash[\s\S]*idempot/i);
  assert.match(sql, /adstudio_provider_attempt_outbox/i);
  assert.match(sql, /'acquired', true/i);
  assert.match(sql, /'acquired', false/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /SQL owns aggregate truth/i);
  assert.match(sql, /create or replace function public\.adstudio_mark_provider_attempt_submitted/i);
  assert.match(sql, /create or replace function public\.adstudio_cancel_provider_attempt/i);
  assert.match(sql, /create or replace function public\.adstudio_recover_provider_run/i);
  assert.match(sql, /Dispatch outcome requires reconciliation/i);
  assert.match(sql, /Legacy money fields are estimates only/i);
  assert.match(sql, /alter column billing_status set not null/i);
  assert.match(sql, /Provider run identity does not match normalized attempts/i);
  assert.match(sql, /ai_usage_ledger_workspace_ai_run_fk/i);
  assert.match(sql, /adstudio_provider_runs_workspace_ai_run_fk/i);
  assert.match(sql, /adstudio_provider_runs_workspace_ledger_fk/i);
  assert.doesNotMatch(sql, /grant select on public\.adstudio_provider_attempt_outbox to authenticated/i);
  assert.equal(existsSync(providerCostDbTestPath), true);
  const dbTest = readFileSync(providerCostDbTestPath, "utf8");
  assert.match(dbTest, /dblink_send_query[\s\S]*concurrent finalizers create one provider run/i);
  assert.match(dbTest, /SQL derives the aggregate from normalized attempts/i);
  assert.match(dbTest, /post-dispatch recovery materializes missing usage as unreconciled/i);
  assert.match(dbTest, /top-level run identity cannot disagree with its normalized attempt/i);
  assert.match(dbTest, /attempt RLS hides rows from an authenticated non-member/i);
});
