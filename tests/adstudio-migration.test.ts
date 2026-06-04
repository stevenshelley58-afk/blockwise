import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202605270003_adstudio.sql";
const alignmentMigrationPath = "supabase/migrations/202605270004_adstudio_live_schema_alignment.sql";

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
  "adstudio_template_versions",
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
