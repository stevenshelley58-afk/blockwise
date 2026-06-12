import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GitHub deploys Trigger.dev tasks after main branch checks pass", () => {
  const workflow = readFileSync(".github/workflows/hard-reset-verification.yml", "utf8");

  assert.match(workflow, /trigger-deploy:/);
  assert.match(workflow, /needs:\s*contracts/);
  assert.match(workflow, /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /TRIGGER_ACCESS_TOKEN:\s*\$\{\{ secrets\.TRIGGER_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /TRIGGER_PROJECT_ID:\s*\$\{\{ secrets\.TRIGGER_PROJECT_ID \}\}/);
  assert.match(workflow, /test -n "\$TRIGGER_ACCESS_TOKEN"/);
  assert.match(workflow, /test -n "\$TRIGGER_PROJECT_ID"/);
  assert.match(workflow, /npm run trigger:deploy/);
});

test("Trigger runbook lists required production task environment", () => {
  const runbook = readFileSync("docs/runbooks/rollback.md", "utf8");

  assert.match(runbook, /Trigger\.dev Deployments And Env/);
  assert.match(runbook, /Missing `TRIGGER_PROJECT_ID` is a hard failure/);
  for (const key of [
    "TRIGGER_PROJECT_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "META_APP_ID",
    "META_APP_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "BLOCKWISE_ENABLE_PROVIDER_WRITES",
  ]) {
    assert.match(runbook, new RegExp(`- \`${key}\``), `expected ${key} in Trigger env runbook`);
  }
  assert.match(runbook, /`SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`/);
});
