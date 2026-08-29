import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("preview E2E command requires Vercel URL credentials and auth state before Playwright", () => {
  const pkg = readFileSync("package.json", "utf8");
  const script = readFileSync("scripts/require-preview-e2e-env.mjs", "utf8");
  const deploymentContract = readFileSync("docs/deployment/vercel.md", "utf8");
  const realLoop = readFileSync("e2e/adstudio-real-loop.spec.ts", "utf8");

  assert.match(pkg, /"test:e2e:preview": "node scripts\/require-preview-e2e-env\.mjs && playwright test"/);
  assert.match(script, /PLAYWRIGHT_BASE_URL/);
  assert.match(script, /ADSTUDIO_E2E_EMAIL/);
  assert.match(script, /ADSTUDIO_E2E_LOGIN_URL/);
  assert.match(script, /ADSTUDIO_E2E_PASSWORD/);
  assert.match(script, /ADSTUDIO_E2E_WORKSPACE_ID/);
  assert.match(script, /ADSTUDIO_E2E_PACK_ID/);
  assert.match(script, /ADSTUDIO_E2E_STORAGE_STATE/);
  assert.match(script, /blockwise\.sale or this project's HTTPS Vercel deployment origin/);
  assert.match(script, /non-empty authenticated storageState/);
  assert.match(deploymentContract, /npm run test:e2e:preview/);
  assert.match(deploymentContract, /ADSTUDIO_E2E_LOGIN_URL/);
  assert.match(realLoop, /input\[type="file"\]\[required\]/);
  assert.match(realLoop, /revisionNumber/);
  assert.match(realLoop, /contentType.*image\\\/png/i);
  assert.match(realLoop, /PUBLISH_TEST_MODE.*dry-run/);
});
