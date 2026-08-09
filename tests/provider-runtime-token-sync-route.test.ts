import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/operator/runtime-provider-credentials/sync/route.ts",
  "utf8",
);
const campaignsRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

test("runtime credential sync is operator-only, confirmation-bound, and never accepts or returns a token", () => {
  assert.match(route, /await requireOperator\(\)/);
  assert.match(route, /x-blockwise-runtime-credential-sync/);
  assert.match(route, /process\.env\.OPENAI_API_KEY/);
  assert.match(route, /upsertRuntimeProviderToken/);
  assert.match(route, /loadRuntimeProviderToken/);
  assert.doesNotMatch(route, /request\.json\(|NextResponse\.json\(\{[^}]*accessToken/);
  assert.match(route, /roundTripVerified: true/);
});

test("campaign generation provisions the encrypted worker credential before charging or queueing", () => {
  const ensureIndex = campaignsRoute.indexOf("await ensureRuntimeProviderToken(");
  const reserveIndex = campaignsRoute.indexOf("await reserveAdStudioGenerationCredits(");
  const enqueueIndex = campaignsRoute.indexOf("await enqueueQueuedJob(");

  assert.ok(ensureIndex > 0);
  assert.ok(reserveIndex > ensureIndex);
  assert.ok(enqueueIndex > reserveIndex);
  assert.match(campaignsRoute, /accessToken: process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(campaignsRoute, /OPENAI_API_KEY[^\n]*payload/);
});
