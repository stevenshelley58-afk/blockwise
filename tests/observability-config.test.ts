import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Next client Sentry initialization lives in the native instrumentation client file", () => {
  const client = readFileSync("src/instrumentation-client.ts", "utf8");

  assert.equal(existsSync("sentry.client.config.ts"), false);
  assert.equal(existsSync("sentry.server.config.ts"), false);
  assert.match(client, /Sentry\.init\(/);
  assert.match(client, /NEXT_PUBLIC_SENTRY_DSN/);
  assert.match(client, /replaysOnErrorSampleRate:\s*1\.0/);
});

test("Trigger runtime initializes and captures task failures through Sentry", () => {
  const config = readFileSync("trigger.config.ts", "utf8");
  const helper = readFileSync("trigger/sentry.ts", "utf8");

  assert.match(config, /initTriggerSentry/);
  assert.match(config, /requireTriggerProjectId\(\)/);
  assert.match(config, /TRIGGER_PROJECT_ID is required to deploy or run Trigger\.dev tasks\./);
  assert.match(config, /onFailure:\s*async\s*\(\{\s*error,\s*task\s*\}\)/);
  assert.match(config, /captureTriggerException\(error,\s*task\)/);
  assert.doesNotMatch(config, /proj_blockwise_local/);
  assert.match(helper, /Sentry\.init\(/);
  assert.match(helper, /process\.env\.SENTRY_DSN \?\? process\.env\.NEXT_PUBLIC_SENTRY_DSN/);
  assert.match(helper, /Sentry\.captureException\(error\)/);
});
