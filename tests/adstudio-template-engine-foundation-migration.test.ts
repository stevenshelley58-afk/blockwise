import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606150006_adstudio_template_engine_foundation.sql";
const sql = readFileSync(migrationPath, "utf8");

test("template engine migration extends image briefs and candidates with skeleton columns", () => {
  assert.match(sql, /alter table if exists research\.ad_template_image_briefs/i);
  for (const column of ["creative_skeleton", "skeleton_version"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected image brief column ${column}`);
  }

  assert.match(sql, /jsonb_typeof\(creative_skeleton\) = 'object'/i);

  assert.match(sql, /alter table if exists research\.ad_template_candidates/i);
  for (const column of ["creative_skeleton", "exemplar_observed_ad_ids"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected candidate column ${column}`);
  }
  assert.match(sql, /ad_template_candidates_exemplars_gin_idx/i);
});

test("template engine migration creates per-observed-ad creative skeleton store under RLS", () => {
  assert.match(sql, /create table if not exists research\.creative_skeletons/i);
  for (const column of [
    "observed_ad_id",
    "ad_creative_id",
    "creative_skeleton",
    "skeleton_version",
    "extractor_version",
    "model",
    "confidence",
    "extracted_at",
    "decision_id",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected creative_skeletons column ${column}`);
  }

  assert.match(sql, /observed_ad_id uuid primary key references research\.observed_ads \(id\) on delete cascade/i);
  assert.match(sql, /ad_creative_id uuid references research\.ad_creatives \(id\) on delete set null/i);
  assert.match(sql, /alter table research\.creative_skeletons enable row level security/i);
  assert.match(sql, /revoke all on research\.creative_skeletons from public, anon, authenticated/i);
  assert.match(sql, /grant all on research\.creative_skeletons to service_role/i);
  assert.match(sql, /for all to service_role using \(true\) with check \(true\)/i);
});

test("template engine migration creates workspace-scoped owned performance table under RLS", () => {
  assert.match(sql, /create table if not exists research\.owned_ad_performance/i);
  for (const column of [
    "workspace_id",
    "adstudio_creative_id",
    "template_key",
    "observed_ad_id",
    "impressions",
    "clicks",
    "leads",
    "qualified_leads",
    "spend_cents",
    "ctr",
    "cpl_cents",
    "lead_quality_score",
    "raw_metrics",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected owned performance column ${column}`);
  }

  assert.match(sql, /workspace_id uuid not null references public\.workspaces \(id\) on delete cascade/i);
  assert.match(sql, /create unique index if not exists owned_ad_performance_workspace_meta_ad_reported_unique/i);
  assert.match(sql, /alter table research\.owned_ad_performance enable row level security/i);
  assert.match(sql, /revoke all on research\.owned_ad_performance from public, anon, authenticated/i);
  assert.match(sql, /grant all on research\.owned_ad_performance to service_role/i);
  assert.match(sql, /for all to service_role using \(true\) with check \(true\)/i);
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*on research\.owned_ad_performance\s+to[^;]*(authenticated|anon)/i,
  );
});

test("template engine migration exposes skeletons and exemplars through approved template view", () => {
  assert.match(sql, /drop view if exists research\.v_ad_template_library/i);
  assert.match(sql, /create view research\.v_ad_template_library as/i);
  assert.match(sql, /coalesce\(c\.creative_skeleton, b\.creative_skeleton\) as creative_skeleton/i);
  assert.match(sql, /\bc\.exemplar_observed_ad_ids\b/i);
  assert.match(sql, /where c\.status = 'approved'/i);
  assert.match(sql, /grant select on research\.v_ad_template_library to service_role/i);
});

test("template engine migration seeds the vision extraction model profile", () => {
  assert.match(sql, /insert into public\.model_profiles/i);
  assert.match(sql, /'vision_extract'/i);
  assert.match(sql, /Schema-bound creative skeleton extraction from winning ad images/i);
  assert.match(sql, /insert into public\.model_profile_versions/i);
  assert.match(sql, /gpt-4\.1-mini/i);
});
