import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260613163000_template_library_schema.sql";
const sql = readFileSync(migrationPath, "utf8");

const tables = [
  "ad_quality_scores",
  "ad_template_image_briefs",
  "ad_template_candidates",
] as const;

function tableBody(table: string): string {
  const match = sql.match(
    new RegExp(`create table if not exists research\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"),
  );
  assert.ok(match, `expected research.${table} create table statement`);
  return match[1];
}

function assertColumns(table: string, columns: string[]): void {
  const body = tableBody(table);
  for (const column of columns) {
    assert.match(body, new RegExp(`\\b${column}\\b`, "i"), `expected ${table}.${column}`);
  }
}

test("template-library migration creates the three research tables", () => {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`create table if not exists research\\.${table}`, "i"),
      `expected research.${table}`,
    );
  }
});

test("template-library migration defines ad quality score columns", () => {
  assertColumns("ad_quality_scores", [
    "id",
    "observed_ad_id",
    "scored_at",
    "scorer_version",
    "model",
    "image_model",
    "longevity_days",
    "is_active",
    "creative_versions",
    "cross_agency_count",
    "objective_score",
    "market_relevant",
    "offer_clarity",
    "local_relevance",
    "lead_intent",
    "brand_fit",
    "compliance_safety",
    "visual_hierarchy",
    "ai_score",
    "composite_score",
    "is_winner",
    "rationale",
    "warnings",
    "decision_id",
    "created_at",
  ]);
});

test("template-library migration defines image brief and candidate columns", () => {
  assertColumns("ad_template_image_briefs", [
    "brief_id",
    "name",
    "concept",
    "layout",
    "imagery",
    "palette",
    "text_rules",
    "formats",
    "ai_prompt_seed",
    "updated_at",
  ]);

  assertColumns("ad_template_candidates", [
    "id",
    "template_key",
    "status",
    "created_at",
    "updated_at",
    "category",
    "audience",
    "format",
    "hook_style",
    "funnel_stage",
    "adstudio_template_id",
    "offer_id",
    "goal",
    "headline",
    "primary_text",
    "description",
    "cta",
    "variables",
    "image_brief_id",
    "evidence_score",
    "source_observed_ad_ids",
    "winner_rationale",
    "compliance_note",
    "scorer_version",
    "decision_id",
    "approved_by",
    "approved_at",
  ]);
});

test("template-library migration enforces rubric ceilings and status values", () => {
  const quality = tableBody("ad_quality_scores");
  for (const [column, ceiling] of [
    ["offer_clarity", 20],
    ["local_relevance", 15],
    ["lead_intent", 20],
    ["brand_fit", 15],
    ["compliance_safety", 20],
    ["visual_hierarchy", 10],
  ] as const) {
    assert.match(
      quality,
      new RegExp(`${column} is null or \\(${column} >= 0 and ${column} <= ${ceiling}\\)`, "i"),
      `expected ${column} ceiling ${ceiling}`,
    );
  }

  for (const column of ["objective_score", "composite_score"]) {
    assert.match(
      quality,
      new RegExp(`${column} >= 0 and ${column} <= 100`, "i"),
      `expected ${column} 0..100 check`,
    );
  }
  assert.match(quality, /ai_score is null or \(ai_score >= 0 and ai_score <= 100\)/i);

  const candidates = tableBody("ad_template_candidates");
  assert.match(candidates, /status in \('draft', 'approved', 'archived'\)/i);
  assert.match(candidates, /evidence_score >= 0 and evidence_score <= 100/i);
});

test("template-library tables are service-role-only under RLS", () => {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`alter table research\\.${table} enable row level security`, "i"),
      `expected RLS on research.${table}`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on research\\.${table} from public, anon, authenticated`, "i"),
      `expected revoked non-service access on research.${table}`,
    );
    assert.match(
      sql,
      new RegExp(`grant all on research\\.${table} to service_role`, "i"),
      `expected service_role grant on research.${table}`,
    );
    assert.match(
      sql,
      new RegExp(
        `create policy "${table}_service_role_all" on research\\.${table}[\\s\\S]*for all to service_role using \\(true\\) with check \\(true\\)`,
        "i",
      ),
      `expected service_role policy on research.${table}`,
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant\\s+[^;]*on research\\.${table}\\s+to[^;]*(authenticated|anon)`, "i"),
      `research.${table} must not be granted to authenticated or anon`,
    );
  }
});

test("template-library migration creates the approved template view", () => {
  assert.match(sql, /create or replace view research\.v_ad_template_library as/i);
  for (const column of [
    "template_key",
    "status",
    "category",
    "audience",
    "format",
    "hook_style",
    "funnel_stage",
    "adstudio_template_id",
    "offer_id",
    "goal",
    "headline",
    "primary_text",
    "description",
    "cta",
    "variables",
    "image_brief_id",
    "image_brief_name",
    "ai_prompt_seed",
    "evidence_score",
    "winner_rationale",
    "compliance_note",
    "updated_at",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected view column ${column}`);
  }

  assert.match(
    sql,
    /left join research\.ad_template_image_briefs b on b\.brief_id = c\.image_brief_id/i,
  );
  assert.match(sql, /where c\.status = 'approved'/i);
  assert.match(sql, /revoke all on research\.v_ad_template_library from public, anon, authenticated/i);
  assert.match(sql, /grant select on research\.v_ad_template_library to service_role/i);
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*on research\.v_ad_template_library\s+to[^;]*(authenticated|anon)/i,
  );
});
