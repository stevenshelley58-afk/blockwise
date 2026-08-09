import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginScript = readFileSync("scripts/e2e/login-storage-state.mjs", "utf8");
const workflow = readFileSync(".github/workflows/adstudio-e2e-preview.yml", "utf8");

test("Production E2E authenticates on Preview without weakening Production Turnstile", () => {
  assert.match(workflow, /auth_base_url:/);
  assert.match(workflow, /ADSTUDIO_E2E_LOGIN_URL:/);
  assert.match(loginScript, /process\.env\.ADSTUDIO_E2E_LOGIN_URL/);
  assert.match(loginScript, /url\.hostname === "blockwise\.sale"/);
  assert.match(loginScript, /steven-shelleys-projects\\\.vercel\\\.app/);
  assert.match(loginScript, /url\.protocol === "https:"/);
  assert.match(loginScript, /cookie\.name\.startsWith\("sb-"\)/);
  assert.match(loginScript, /domain: targetHost/);
  assert.match(loginScript, /origins: \[\]/);
  assert.doesNotMatch(loginScript, /process\.env\.NEXT_PUBLIC_TURNSTILE|captcha.*disable|password.*console/i);
});
