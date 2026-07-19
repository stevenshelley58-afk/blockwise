import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GitHub deploys Trigger.dev tasks after main branch checks pass", () => {
  const workflow = readFileSync(".github/workflows/hard-reset-verification.yml", "utf8");
  const manualWorkflow = readFileSync(".github/workflows/trigger-deploy.yml", "utf8");
  const keySyncAction = readFileSync(".github/actions/sync-trigger-key-to-vercel/action.yml", "utf8");
  const environmentSync = readFileSync("scripts/sync-trigger-production-env.mjs", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const triggerWrapper = readFileSync("scripts/run-trigger-with-project-ref.mjs", "utf8");

  assert.match(workflow, /trigger-deploy:/);
  assert.match(workflow, /needs:\s*\n\s*- contracts\s*\n\s*- database-contracts/);
  assert.match(workflow, /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /TRIGGER_ACCESS_TOKEN:\s*\$\{\{ secrets\.TRIGGER_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /TRIGGER_PROJECT_ID:\s*\$\{\{ secrets\.TRIGGER_PROJECT_ID \}\}/);
  assert.match(workflow, /TRIGGER_PROJECT_REF:\s*\$\{\{ secrets\.TRIGGER_PROJECT_ID \}\}/);
  assert.match(workflow, /test -n "\$TRIGGER_ACCESS_TOKEN"/);
  assert.match(workflow, /test -n "\$TRIGGER_PROJECT_ID"/);
  assert.match(workflow, /test -n "\$TRIGGER_PROJECT_REF"/);
  assert.match(workflow, /test -n "\$GOOGLE_AI_API_KEY"/);
  assert.match(workflow, /npm run trigger:deploy/);
  assert.match(workflow, /uses:\s*\.\/\.github\/actions\/sync-trigger-key-to-vercel/);
  assert.match(manualWorkflow, /uses:\s*\.\/\.github\/actions\/sync-trigger-key-to-vercel/);
  assert.match(keySyncAction, /api\.trigger\.dev\/api\/v1\/projects\/\$TRIGGER_PROJECT_ID\/prod/);
  assert.match(keySyncAction, /startsWith\("tr_prod_"\)/);
  assert.match(keySyncAction, /::add-mask::\$trigger_key/);
  assert.match(keySyncAction, /env add TRIGGER_SECRET_KEY production/);
  assert.match(keySyncAction, /for variable in OPENAI_API_KEY GOOGLE_AI_API_KEY/);
  assert.match(keySyncAction, /for environment in production preview/);
  assert.match(keySyncAction, /env add "\$variable" "\$environment"/);
  assert.match(keySyncAction, /node scripts\/sync-trigger-production-env\.mjs/);
  assert.match(manualWorkflow, /GOOGLE_AI_API_KEY:\s*\$\{\{ secrets\.GOOGLE_AI_API_KEY \}\}/);
  assert.match(workflow, /SUPABASE_SECRET_KEY:\s*\$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}/);
  assert.match(environmentSync, /envvars\.upload\(projectRef, "prod", \{ variables, override: true \}\)/);
  assert.match(environmentSync, /SUPABASE_SECRET_KEY/);
  assert.match(environmentSync, /GOOGLE_AI_API_KEY/);
  assert.doesNotMatch(environmentSync, /FAL_KEY|FAL_API_KEY/);
  assert.doesNotMatch(environmentSync, /STRIPE_SECRET_KEY|RESEND_API_KEY/);
  assert.doesNotMatch(keySyncAction, /console\.log\(key\)|echo "\$trigger_key"/);
  assert.match(packageJson, /"trigger:deploy":\s*"node scripts\/run-trigger-with-project-ref\.mjs deploy"/);
  assert.match(triggerWrapper, /process\.env\.TRIGGER_PROJECT_ID\?\.trim\(\)/);
  assert.match(triggerWrapper, /process\.env\.TRIGGER_PROJECT_REF\?\.trim\(\)/);
  assert.match(triggerWrapper, /@trigger\.dev\/sdk/);
  assert.match(triggerWrapper, /triggerCliPackage = `trigger\.dev@\$\{String\(triggerSdkVersion\)\.replace/);
  assert.match(triggerWrapper, /"--yes", triggerCliPackage/);
  assert.match(triggerWrapper, /"--project-ref", projectRef/);
  assert.match(triggerWrapper, /TRIGGER_PROJECT_ID or TRIGGER_PROJECT_REF is required to deploy or run Trigger\.dev tasks\./);
});

test("GitHub replays migrations and runs pgTAP before release jobs", () => {
  const workflow = readFileSync(".github/workflows/hard-reset-verification.yml", "utf8");
  const packageJson = readFileSync("package.json", "utf8");

  assert.match(workflow, /database-contracts:/);
  assert.match(workflow, /uses:\s*supabase\/setup-cli@v2/);
  assert.match(workflow, /version:\s*2\.108\.0/);
  assert.match(workflow, /run:\s*supabase db start/);
  assert.match(workflow, /run:\s*npm run test:db/);
  assert.match(workflow, /if:\s*always\(\)[\s\S]*run:\s*supabase stop --no-backup/);
  assert.match(packageJson, /"test:db":\s*"supabase db reset --local && supabase test db"/);
});

test("Trigger runbook lists required production task environment", () => {
  const runbook = readFileSync("docs/runbooks/rollback.md", "utf8");

  assert.match(runbook, /Trigger\.dev Deployments And Env/);
  assert.match(runbook, /Missing `TRIGGER_PROJECT_ID` is a hard failure in the GitHub deploy workflow/);
  for (const key of [
    "TRIGGER_PROJECT_ID",
    "SUPABASE_URL",
    "META_APP_ID",
    "META_APP_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "BLOCKWISE_ENABLE_PROVIDER_WRITES",
  ]) {
    assert.match(runbook, new RegExp(`- \`${key}\``), `expected ${key} in Trigger env runbook`);
  }
  assert.match(runbook, /`SUPABASE_SECRET_KEY` \(preferred\) or legacy `SUPABASE_SERVICE_ROLE_KEY`/);
  assert.match(runbook, /`SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`/);
});
