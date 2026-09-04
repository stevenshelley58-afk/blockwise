import assert from "node:assert/strict";
import test from "node:test";

import { allowedManualStatusTransition } from "../src/lib/adstudio/manual-publish.ts";

test("manual Meta requests allow only safe forward/operator transitions", () => {
  assert.equal(allowedManualStatusTransition("requested", "in_progress"), true);
  assert.equal(allowedManualStatusTransition("requested", "cancelled"), true);
  assert.equal(allowedManualStatusTransition("in_progress", "completed"), true);
  assert.equal(allowedManualStatusTransition("in_progress", "cancelled"), true);
  assert.equal(allowedManualStatusTransition("completed", "requested"), false);
  assert.equal(allowedManualStatusTransition("cancelled", "in_progress"), false);
  assert.equal(allowedManualStatusTransition("requested", "completed"), false);
});

test("manual publishing backend has no provider activation side effects", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("src/lib/adstudio/manual-publish.ts", "utf8"));
  assert.doesNotMatch(source, /provider_connections|meta_connected_at|first_campaign_live_at|fetch\s*\(/i);
  assert.match(source, /audit_logs/);
  assert.match(source, /id:\s*mutationId/);
  assert.match(source, /publishSummary/);
  assert.match(source, /publishControls/);
  assert.match(source, /renders_missing/);
  assert.match(source, /stale_revision/);
  assert.match(source, /metaCopy/);
  assert.match(source, /documentHash/);
  assert.match(source, /32_000/);
  assert.match(source, /manual_meta_publish_transition:/);
  assert.match(source, /error\.code !== "23505"/);
});
