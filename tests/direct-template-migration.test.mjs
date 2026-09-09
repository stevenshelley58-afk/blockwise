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

test("review activation defaults new imports closed and requires explicit service-only evidence", () => {
  const columnsName = "20260904010000_ad_template_review_activation_columns.sql";
  const quarantineName = "20260904011000_quarantine_unreviewed_ad_templates.sql";
  const activationName = "20260904012000_enforce_ad_template_review_activation.sql";
  const columns = readFileSync(`supabase/migrations/${columnsName}`, "utf8");
  const quarantine = readFileSync(`supabase/migrations/${quarantineName}`, "utf8");
  const activation = readFileSync(`supabase/migrations/${activationName}`, "utf8");
  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8");

  assert.match(columns, /add column if not exists library_review_run_id text/i);
  assert.match(columns, /add column if not exists library_reviewed_at timestamptz/i);
  assert.match(columns, /alter column library_status set default 'quarantined'/i);

  assert.match(quarantine, /update public\.ad_templates[\s\S]*library_status = 'quarantined'/i);
  assert.doesNotMatch(quarantine, /delete\s+from|drop\s+table/i);

  assert.match(activation, /constraint ad_templates_active_review_check[\s\S]*library_review_run_id is not null[\s\S]*library_reviewed_at is not null/i);
  assert.match(activation, /create or replace function public\.activate_reviewed_ad_template/i);
  assert.match(activation, /jsonb_object_keys\(current_template -> 'assets'\)[\s\S]*ad_template_assets_direct/i);
  assert.match(activation, /revoke all on function public\.activate_reviewed_ad_template\(text, text\) from public, anon, authenticated/i);
  assert.match(activation, /grant execute on function public\.activate_reviewed_ad_template\(text, text\) to service_role/i);

  const ordered = [columnsName, quarantineName, activationName].map(name => allowlist.indexOf(name));
  assert.ok(ordered.every(index => index >= 0));
  assert.ok(ordered[0] < ordered[1] && ordered[1] < ordered[2]);
});
