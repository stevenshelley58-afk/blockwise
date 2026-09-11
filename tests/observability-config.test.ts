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
  assert.match(client, /beforeSend\(event\)/);
  assert.match(client, /redactValue\(event\)/);
});

test("Sentry names the environment it is actually running in", () => {
  // Vercel is retired, so VERCEL_ENV is never set on the VPS: every production
  // event was filed under "development". NODE_ENV is correct on the box, and the
  // SENTRY_ENVIRONMENT pair exists for a preview or a staging release.
  const server = readFileSync("src/instrumentation.ts", "utf8");
  const client = readFileSync("src/instrumentation-client.ts", "utf8");

  for (const [name, source, override] of [
    ["src/instrumentation.ts", server, "SENTRY_ENVIRONMENT"],
    ["src/instrumentation-client.ts", client, "NEXT_PUBLIC_SENTRY_ENVIRONMENT"],
  ] as const) {
    // Only the assignment is inspected: the surrounding comment names the old
    // variable on purpose, so a whole-file search would read its own prose.
    const start = source.indexOf("environment:");
    const assignment = source.slice(start, start + 200).replace(/\s+/g, " ");
    assert.match(assignment, new RegExp(override), `${name} must accept its environment override`);
    assert.match(assignment, /NODE_ENV/, `${name} must fall back to NODE_ENV`);
    assert.doesNotMatch(assignment, /VERCEL_ENV/, `${name} must not depend on the retired Vercel variable`);
  }
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
