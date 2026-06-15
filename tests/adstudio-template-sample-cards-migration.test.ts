import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606150009_template_sample_cards.sql";
const sql = readFileSync(migrationPath, "utf8");

test("template sample card migration adds candidate preview fields", () => {
  assert.match(sql, /alter table if exists research\.ad_template_candidates/i);
  assert.match(sql, /\bsample_card_image_path\b/i);
  assert.match(sql, /\bsample_style\b/i);
  assert.match(sql, /jsonb_typeof\(sample_style\) = 'object'/i);
  assert.match(sql, /ad_template_candidates_sample_card_path_check/i);
});

test("template sample card migration keeps generated previews in the public template-cards bucket", () => {
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(sql, /'template-cards'/i);
  assert.match(sql, /public\s*=\s*true/i);
});

test("template sample card migration exposes sample fields through the approved template view only", () => {
  assert.match(sql, /drop view if exists research\.v_ad_template_library/i);
  assert.match(sql, /create view research\.v_ad_template_library as/i);
  assert.match(sql, /\bc\.sample_card_image_path\b/i);
  assert.match(sql, /\bc\.sample_style\b/i);
  assert.match(sql, /where c\.status = 'approved'/i);
  assert.match(sql, /revoke all on research\.v_ad_template_library from public, anon, authenticated/i);
  assert.match(sql, /grant select on research\.v_ad_template_library to service_role/i);
});
