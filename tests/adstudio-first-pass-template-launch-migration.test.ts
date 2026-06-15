import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606150007_first_pass_adstudio_template_launch.sql";
const sql = readFileSync(migrationPath, "utf8");

test("first-pass template launch migration stores template metadata on campaigns", () => {
  assert.match(sql, /alter table if exists public\.adstudio_campaigns/i);
  for (const column of ["template_key", "template_source", "source_observed_ad_id", "template_snapshot_json"]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `expected campaign column ${column}`);
  }
  assert.match(sql, /jsonb_typeof\(template_snapshot_json\) = 'object'/i);
  assert.match(sql, /adstudio_campaigns_workspace_template_idx/i);
});

test("first-pass template launch migration approves the ten live launch templates", () => {
  for (const key of [
    "just_listed",
    "coming_soon",
    "new_to_market",
    "open_home",
    "just_sold",
    "price_update",
    "market_update",
    "free_appraisal",
    "buyer_demand",
    "seller_checklist",
  ]) {
    assert.match(sql, new RegExp(`'${key}'`, "i"), `expected seeded template ${key}`);
  }

  assert.match(sql, /insert into research\.ad_template_candidates/i);
  assert.match(sql, /'approved'/i);
  assert.match(sql, /first_pass_manual_v1/i);
  assert.match(sql, /First-pass\/manual operator-approved template skeleton/i);
  assert.match(sql, /on conflict \(template_key\) do update/i);
});

test("first-pass template launch migration seeds skeleton-backed image briefs", () => {
  assert.match(sql, /insert into research\.ad_template_image_briefs/i);
  assert.match(sql, /creative_skeleton/i);
  assert.match(sql, /skeleton_version/i);
  assert.match(sql, /copy_safe_zones/i);
  assert.match(sql, /array\['9:16','4:5','1:1'\]/i);
});
