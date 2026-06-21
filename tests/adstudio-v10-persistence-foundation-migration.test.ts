import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606210001_adstudio_template_design_persistence.sql";
const sql = readFileSync(migrationPath, "utf8");

function tableBody(schema: "public" | "research", table: string): string {
  const match = sql.match(
    new RegExp(`create table if not exists ${schema}\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"),
  );
  assert.ok(match, `expected ${schema}.${table} create table statement`);
  return match[1];
}

function assertColumns(schema: "public" | "research", table: string, columns: string[]): void {
  const body = tableBody(schema, table);
  for (const column of columns) {
    assert.match(body, new RegExp(`\\b${column}\\b`, "i"), `expected ${schema}.${table}.${column}`);
  }
}

test("v10 migration creates the canonical template catalog and version tables", () => {
  assertColumns("public", "ad_templates", [
    "id",
    "workspace_id",
    "key",
    "name",
    "status",
    "brief_schema",
    "formats",
    "source",
    "source_asset_url",
    "latest_version",
  ]);
  assertColumns("public", "ad_template_versions", [
    "id",
    "template_id",
    "version",
    "design",
    "design_schema_version",
    "thumbnail_path",
    "approved_by",
    "approved_at",
  ]);

  assert.match(sql, /create unique index if not exists ad_templates_workspace_key_unique/i);
  assert.match(sql, /unique \(template_id, version\)/i);
  assert.match(sql, /jsonb_typeof\(design\) = 'object'/i);
});

test("v10 template tables have RLS, global read, and operator/workspace write policies", () => {
  for (const table of ["ad_templates", "ad_template_versions"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant select on public\\.${table} to authenticated`, "i"));
    assert.match(sql, new RegExp(`grant all on public\\.${table} to service_role`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_service_role_all on public\\.${table}`, "i"));
  }

  assert.match(sql, /workspace_id is null\s+or public\.is_operator\(\)\s+or public\.is_workspace_member\(workspace_id\)/i);
  assert.match(sql, /workspace_id is null and public\.is_operator\(\)/i);
  assert.match(sql, /public\.has_workspace_role\(workspace_id, array\['owner', 'admin', 'operator'\]\)/i);
});

test("v10 migration creates font registry and generation job ledger", () => {
  assertColumns("public", "ad_fonts", [
    "family",
    "display_name",
    "category",
    "css_src",
    "weights",
    "file_path",
    "status",
  ]);
  assertColumns("public", "adstudio_generation_jobs", [
    "id",
    "workspace_id",
    "campaign_id",
    "template_id",
    "template_version_id",
    "kind",
    "status",
    "correlation_id",
    "result",
    "error",
    "attempts",
  ]);

  assert.match(sql, /create policy ad_fonts_authenticated_select on public\.ad_fonts/i);
  assert.match(sql, /create policy adstudio_generation_jobs_select on public\.adstudio_generation_jobs/i);
  assert.match(sql, /kind in \('copy', 'photo_prep', 'render', 'qa', 'publish'\)/i);
  assert.match(sql, /status in \('queued', 'running', 'done', 'failed', 'cancelled'\)/i);
});

test("v10 migration links campaigns to immutable template versions and jobs", () => {
  assert.match(sql, /alter table if exists public\.adstudio_campaigns[\s\S]*add column if not exists template_id uuid references public\.ad_templates/i);
  assert.match(sql, /add column if not exists template_version_id uuid references public\.ad_template_versions/i);
  assert.match(sql, /add column if not exists template_version_hash text/i);
  assert.match(sql, /add column if not exists generation_job_id uuid references public\.adstudio_generation_jobs/i);
  assert.match(sql, /adstudio_campaigns_template_version_idx/i);
  assert.match(sql, /adstudio_campaigns_generation_job_idx/i);
});

test("v10 migration exposes template_designs through the approved research view", () => {
  assert.match(sql, /alter table if exists research\.ad_template_candidates[\s\S]*add column if not exists template_designs jsonb/i);
  assert.match(sql, /alter table if exists research\.ad_template_image_briefs[\s\S]*add column if not exists template_designs jsonb/i);
  assert.match(sql, /coalesce\(c\.template_designs, b\.template_designs\) as template_designs/i);
  assert.match(sql, /c\.template_version/i);
  assert.match(sql, /coalesce\(c\.brief_schema, b\.brief_schema\) as brief_schema/i);
  assert.match(sql, /grant select on research\.v_ad_template_library to service_role/i);
});
