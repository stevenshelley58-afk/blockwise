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

test("VPS queue runtime durably records and logs task failures", () => {
  const worker = readFileSync("worker/index.ts", "utf8");

  assert.equal(existsSync("trigger.config.ts"), false);
  assert.equal(existsSync("trigger"), false);
  assert.match(worker, /supabase\.rpc\("fail_job_v2"/);
  assert.match(worker, /log\(`job \$\{job\.id\} \(\$\{job\.kind\}\)/);
  assert.match(worker, /console\.error\("\[worker\] fatal:"/);
  assert.match(worker, /reap_stale_jobs/);
});
