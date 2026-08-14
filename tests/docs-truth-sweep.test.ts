import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("production readiness references real release commands", () => {
  const readiness = read("docs/runbooks/production-readiness.md");

  assert.match(readiness, /There is no `lint` script and no `audit:repo` script/);
  assert.match(readiness, /npm run verify:hard-reset/);
  assert.match(readiness, /VPS.*job_queue.*worker/);
  assert.match(readiness, /paid-service watchdog as the Vercel Cron configured in\s+`vercel\.json`/);
  assert.doesNotMatch(readiness, /Verify Trigger\.dev deployed tasks[^\r\n]*(?:\r?\n {2}[^\r\n]*)*paid-service watchdog/);
});

test("rollback documents export, publish, and VPS worker posture", () => {
  const rollback = read("docs/runbooks/rollback.md");

  assert.match(rollback, /Manual Ad Studio export is not a provider write/);
  assert.match(rollback, /created\s+paused/i);
  assert.match(rollback, /VPS.*job_queue.*worker/);
  assert.match(rollback, /BLOCKWISE_ENABLE_PROVIDER_WRITES=false/);
});
