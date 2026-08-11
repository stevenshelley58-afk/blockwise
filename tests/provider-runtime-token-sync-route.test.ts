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
  assert.match(route, /process\.env\.GOOGLE_AI_API_KEY/);
  assert.match(route, /provider !== "openai" && provider !== "google"/);
  assert.match(route, /upsertRuntimeProviderToken/);
  assert.match(route, /loadRuntimeProviderToken/);
  assert.doesNotMatch(route, /request\.json\(|NextResponse\.json\(\{[^}]*accessToken/);
  assert.match(route, /roundTripVerified: true/);
});

test("campaign generation provisions the encrypted worker credential before charging or queueing", () => {
  const ensureIndex = campaignsRoute.indexOf("runtimeImageCredentials.map");
  const reserveIndex = campaignsRoute.indexOf("await reserveAdStudioGenerationCredits(");
  const enqueueIndex = campaignsRoute.indexOf("await enqueueQueuedJob(");

  assert.ok(ensureIndex > 0);
  assert.ok(reserveIndex > ensureIndex);
  assert.ok(enqueueIndex > reserveIndex);
  assert.match(campaignsRoute, /provider: "openai" as const, accessToken: process\.env\.OPENAI_API_KEY/);
  assert.match(campaignsRoute, /provider: "google" as const, accessToken: process\.env\.GOOGLE_AI_API_KEY/);
  assert.match(campaignsRoute, /runtimeImageCredentials\.length === 0/);
  assert.match(campaignsRoute, /Promise\.all\(runtimeImageCredentials\.map/);
  assert.match(campaignsRoute, /allowWrite: process\.env\.VERCEL_ENV === "production"/);
  assert.doesNotMatch(campaignsRoute, /OPENAI_API_KEY[^\n]*payload/);
  assert.doesNotMatch(campaignsRoute, /GOOGLE_AI_API_KEY[^\n]*payload/);
});
