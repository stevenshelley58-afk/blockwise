import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runInactiveAdPurge } from "../hermes/tools/research-runtime/bin/inactive-ad-purge.mjs";

test("inactive-ad maintenance runs only through the VPS research RPC", async () => {
  const calls: Array<{ schema: string; path: string; init: RequestInit }> = [];
  const result = await runInactiveAdPurge({
    intervalHours: 24,
    researchRest: async (schema: string, path: string, init: RequestInit = {}) => {
      calls.push({ schema, path, init });
      return [{
        skipped: false,
        reason: "complete",
        confirmed_inactive: 12,
        active_missing_media: 0,
        deleted: 12,
      }];
    },
  });

  assert.deepEqual(result, {
    skipped: false,
    reason: "complete",
    confirmedInactive: 12,
    activeMissingMedia: 0,
    deleted: 12,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.schema, "research");
  assert.equal(calls[0]?.path, "rpc/purge_confirmed_inactive_ads");
  assert.equal(calls[0]?.init.method, "POST");
});

test("GitHub no longer runs research maintenance against customer Supabase", () => {
  const workflow = readFileSync(".github/workflows/hard-reset-verification.yml", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const migration = readFileSync(
    "infra/research-db/migrations/001_purge_confirmed_inactive_ads.sql",
    "utf8",
  );

  assert.doesNotMatch(workflow, /production-ad-maintenance|purge confirmed inactive ads/iu);
  assert.doesNotMatch(packageJson, /research:purge-inactive-ads/iu);
  assert.match(migration, /oa\.active_status = 'active'/u);
  assert.match(migration, /raise exception[\s\S]*active creatives still need media recovery/iu);
  assert.match(migration, /where active_status = 'inactive'/u);
});
