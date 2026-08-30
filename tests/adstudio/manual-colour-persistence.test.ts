import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationName = "20260830050000_adstudio_manual_colour_mode.sql";
const sql = readFileSync(`supabase/migrations/${migrationName}`, "utf8");

test("manual colour mode expands the exact customer-ad constraint without an unprotected write window", () => {
  assert.match(sql, /ad_customer_ads_colour_mode_check/);
  assert.match(sql, /check \(colour_mode in \('template', 'brand_pack', 'manual'\)\)/i);
  assert.match(sql, /add constraint ad_customer_ads_colour_mode_expanded_check[\s\S]*not valid/i);

  const validateAt = sql.indexOf("validate constraint ad_customer_ads_colour_mode_expanded_check");
  const dropAt = sql.indexOf("drop constraint ad_customer_ads_colour_mode_check");
  const renameAt = sql.indexOf("rename constraint ad_customer_ads_colour_mode_expanded_check");
  assert.ok(validateAt >= 0 && validateAt < dropAt, "replacement constraint must validate before the old check is dropped");
  assert.ok(dropAt < renameAt, "the validated replacement must take over the canonical name");

  assert.doesNotMatch(sql, /^\s*(?:begin|commit);\s*$/im);
  assert.doesNotMatch(sql, /drop table|drop column|cascade/i);
});

test("manual colour migration is the unique latest product migration", () => {
  const allowlist = readFileSync("infra/product/product-migrations.txt", "utf8")
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);

  assert.equal(allowlist.at(-1), migrationName);
  assert.equal(allowlist.filter(name => name === migrationName).length, 1);
});
