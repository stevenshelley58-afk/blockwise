import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("preview E2E command requires Vercel URL credentials and auth state before Playwright", () => {
  const pkg = readFileSync("package.json", "utf8");
  const script = readFileSync("scripts/require-preview-e2e-env.mjs", "utf8");
  const runbook = readFileSync("docs/runbooks/production-readiness.md", "utf8");
  const workflow = readFileSync(".github/workflows/adstudio-e2e-preview.yml", "utf8");

  assert.match(pkg, /"test:e2e:preview": "node scripts\/require-preview-e2e-env\.mjs && playwright test"/);
  assert.match(script, /PLAYWRIGHT_BASE_URL/);
  assert.match(script, /BLOCKWISE_DEV_PASSWORD/);
  assert.match(script, /ADSTUDIO_E2E_WORKSPACE_ID/);
  assert.match(script, /ADSTUDIO_E2E_STORAGE_STATE/);
  assert.match(script, /HTTPS Vercel Preview or Production URL/);
  assert.match(script, /non-empty authenticated storageState/);
  assert.match(runbook, /npm run test:e2e:preview/);
  assert.match(workflow, /node scripts\/e2e\/seed-adstudio-e2e\.mjs/);
  assert.match(workflow, /vercel@54\.6\.1 env pull \.vercel\/e2e-preview\.env/);
  assert.match(workflow, /secrets\.VERCEL_TOKEN/);
  assert.match(workflow, /ADSTUDIO_E2E_OPERATOR: "true"/);
  assert.match(workflow, /ADSTUDIO_E2E_OPERATOR=false/);
  assert.match(workflow, /PLAYWRIGHT_USE_CHROME: "1"/);
  const seed = readFileSync("scripts/e2e/seed-adstudio-e2e.mjs", "utf8");
  assert.match(seed, /ADSTUDIO_E2E_OPERATOR/);
  assert.match(seed, /Upsert approved E2E brand kit/);
  assert.match(readFileSync("playwright.config.ts", "utf8"), /channel: chromeChannel/);
});
