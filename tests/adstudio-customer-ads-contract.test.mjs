import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const create = readFileSync("src/lib/adstudio/create-customer-ad.ts", "utf8");
const template = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/202609030001_adstudio_customer_ad_creation.sql", "utf8");
const library = readFileSync("src/lib/adstudio/library-read-model.ts", "utf8");

test("creation is explicit, replayable by key, and permits intentional duplicates", () => {
  assert.match(create, /export async function createCustomerAd/);
  assert.match(create, /eq\("creation_key", idempotencyKey\)/);
  assert.doesNotMatch(create, /getOrCreateCustomerAd/);
  assert.match(migration, /unique index if not exists .*workspace_creation_key/);
  assert.match(migration, /on public\.ad_customer_ads/);
});

test("template GET has no creation call and carries one stable form key", () => {
  assert.doesNotMatch(template.split('async function createAdAction')[0].replace(/import .*createCustomerAd.*\n/, ""), /createCustomerAd\(/);
  assert.match(template, /name="creationKey"/);
  assert.match(template, /createCustomerAd\(supabase, access\.workspaceId, pack, creationKey/);
});

test("library reads current ads and includes ads without a rendered preview", () => {
  assert.match(library, /from\(input\.kind === "assets" \? "adstudio_brand_assets" : "ad_customer_ads"\)/);
  assert.match(library, /src: src \?\? .*sample\?placement=feed/);
  assert.match(library, /status: "Saved"/);
});
