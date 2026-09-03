import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("direct template migration is nested in the product migration transaction", () => {
  const sql = readFileSync("supabase/migrations/20260830020000_direct_template_artifact.sql", "utf8");
  assert.doesNotMatch(sql, /^\s*(?:begin|commit);\s*$/im);
  assert.match(sql, /create table if not exists public\.ad_templates/);
  assert.match(sql, /finalize_ad_template_artifact/);
});

test("direct Meta publish plans have their own customer-ad parent", () => {
  const sql = readFileSync("supabase/migrations/20260830030000_direct_customer_meta_publish_plans.sql", "utf8");
  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8");
  assert.doesNotMatch(sql, /^\s*(?:begin|commit);\s*$/im);
  assert.match(sql, /add column if not exists customer_ad_id uuid/i);
  assert.match(sql, /alter column adstudio_campaign_id drop not null/i);
  assert.match(sql, /foreign key \(customer_ad_id\)[\s\S]*references public\.ad_customer_ads \(id\)/i);
  assert.match(sql, /num_nonnulls\(adstudio_campaign_id, customer_ad_id\) = 1/i);
  assert.match(sql, /meta_publish_plans_customer_ad_updated_idx/i);
  assert.match(allowlist, /20260830030000_direct_customer_meta_publish_plans\.sql/);
});

test("direct template quarantine is a chronological, reversible customer-read boundary", () => {
  const migrationName = "20260903130000_ad_template_library_status.sql";
  const sql = readFileSync(`supabase/migrations/${migrationName}`, "utf8");
  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8");

  assert.match(sql, /add column if not exists library_status text not null default 'active'/i);
  assert.match(sql, /constraint ad_templates_library_status_check[\s\S]*library_status in \('active', 'quarantined'\)/i);
  assert.match(sql, /create policy ad_templates_authenticated_select[\s\S]*using \(library_status = 'active'\)/i);
  assert.match(sql, /create policy ad_template_assets_direct_authenticated_select[\s\S]*visible_template\.library_status = 'active'/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.ad_templates|delete\s+from\s+public\.ad_template_assets_direct/i);
  assert.match(allowlist, new RegExp(`${migrationName.replaceAll(".", "\\.")}\\s*$`, "m"));
});
