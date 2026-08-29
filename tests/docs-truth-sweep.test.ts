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

  assert.match(readiness, /`npm run check:nul`, `npm run typecheck`, `npm test`, `npm run build`/);
  assert.match(readiness, /scripts\/vps\/product-health\.sh/);
  assert.match(readiness, /durable worker jobs/i);
  assert.match(readiness, /product-worker/);
  assert.match(readiness, /Scheduled enqueueing is a separate[\s\S]*not a Vercel requirement/);
  assert.doesNotMatch(readiness, /Vercel Cron configured in\s+`vercel\.json`/);
});

test("rollback documents export, publish, and VPS worker posture", () => {
  const rollback = read("docs/runbooks/rollback.md");

  assert.match(rollback, /product-worker[\s\S]*public\.job_queue/);
  assert.match(rollback, /BLOCKWISE_ENABLE_PROVIDER_WRITES=false/);
  assert.match(rollback, /scripts\/vps\/product-health\.sh/);
  assert.match(rollback, /BLOCKWISE_RESTORE_APPROVED=I_HAVE_VERIFIED_THE_BACKUP/);
  assert.match(rollback, /Frank\/Hermes separation is a migration invariant/);
});
