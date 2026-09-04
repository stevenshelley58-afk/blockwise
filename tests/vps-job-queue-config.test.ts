import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the external task runner is absent and background work uses the VPS queue", () => {
  const packageJson = readFileSync("package.json", "utf8");
  const worker = readFileSync("worker/index.ts", "utf8");

  assert.doesNotMatch(packageJson, /@trigger\.dev|trigger:deploy|trigger:dev/);
  assert.equal(existsSync("trigger.config.ts"), false);
  assert.equal(existsSync("trigger"), false);
  assert.equal(existsSync(".github/workflows/trigger-deploy.yml"), false);
  assert.doesNotMatch(worker, /BLOCKWISE_QUEUED_KINDS/);
  assert.match(worker, /handler\(job\.payload/);
  for (const kind of [
    "publish.meta.execute",
    "publish.meta.mutate",
    "sync.meta.leads",
    "deliver.lead",
    "reporting.refresh",
    "reconcile.customer.activation",
    "check.meta.token-health",
    "sync.provider.reports",
  ]) {
    assert.match(worker, new RegExp(kind.replaceAll(".", "\\.")));
  }
});

test("GitHub replays migrations and runs pgTAP", () => {
  const workflow = readFileSync(".github/workflows/hard-reset-verification.yml", "utf8");
  assert.match(workflow, /database-contracts:/);
  assert.match(workflow, /uses:\s*supabase\/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf/);
  assert.match(workflow, /run:\s*npm run test:db/);
});
