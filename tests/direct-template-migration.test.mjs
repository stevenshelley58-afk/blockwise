import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("direct template migration is nested in the product migration transaction", () => {
  const sql = readFileSync("supabase/migrations/20260830020000_direct_template_artifact.sql", "utf8");
  assert.doesNotMatch(sql, /^\s*(?:begin|commit);\s*$/im);
  assert.match(sql, /create table if not exists public\.ad_templates/);
  assert.match(sql, /finalize_ad_template_artifact/);
});
