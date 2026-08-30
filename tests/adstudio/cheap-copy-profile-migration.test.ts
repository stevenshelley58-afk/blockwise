import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationName = "20260830040000_adstudio_cheap_copy_deepseek.sql";
const sql = readFileSync(`supabase/migrations/${migrationName}`, "utf8");

test("cheap-copy migration only rotates the exact untouched OpenAI seed", () => {
  assert.match(sql, /profile\.key = 'cheap_draft_text'/);
  assert.match(sql, /version\.provider = 'openai'/);
  assert.match(sql, /version\.model = 'gpt-4\.1-mini'/);
  assert.match(sql, /input_usd_per_million_tokens = 0\.4000/);
  assert.match(sql, /output_usd_per_million_tokens = 1\.6000/);
  assert.match(sql, /image_usd_per_unit = 0\.0000/);
  assert.match(sql, /supports_structured_output is true/);
  assert.match(sql, /max_context_tokens = 128000/);
  assert.match(sql, /not exists \([\s\S]*other_active\.id <> version\.id/);
  assert.doesNotMatch(sql, /key in\s*\(/i);
  assert.doesNotMatch(sql, /where\s+active_to\s+is\s+null\s*;/i);
});

test("cheap-copy migration appends DeepSeek once and replays as a no-op", () => {
  assert.match(sql, /with eligible_seed as materialized/);
  assert.match(sql, /closed_seed as \([\s\S]*update public\.model_profile_versions[\s\S]*returning current_version\.model_profile_id/);
  assert.match(sql, /insert into public\.model_profile_versions/);
  assert.match(sql, /'deepseek',\s*'deepseek-chat',\s*0\.2700,\s*1\.1000/);
  assert.match(sql, /from closed_seed/);
  assert.equal((sql.match(/insert into public\.model_profile_versions/g) ?? []).length, 1);
  assert.equal((sql.match(/update public\.model_profile_versions/g) ?? []).length, 1);

  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  assert.equal(allowlist.filter(name => name === migrationName).length, 1);
  assert.ok(
    allowlist.indexOf(migrationName) > allowlist.indexOf("20260830030000_direct_customer_meta_publish_plans.sql"),
    "cheap-copy migration must remain after its direct-publish predecessor",
  );
});
