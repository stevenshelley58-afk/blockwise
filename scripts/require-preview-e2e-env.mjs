import { existsSync, readFileSync } from "node:fs";

const required = [
  "PLAYWRIGHT_BASE_URL",
  "BLOCKWISE_DEV_PASSWORD",
  "ADSTUDIO_E2E_WORKSPACE_ID",
];
const missing = required.filter((key) => !process.env[key]?.trim());
const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";

if (missing.length > 0) {
  fail(`Missing preview E2E environment variables: ${missing.join(", ")}`);
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() ?? "";

if (!/^https:\/\/.+/i.test(baseUrl) || /(?:localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl)) {
  fail("PLAYWRIGHT_BASE_URL must be an HTTPS Vercel Preview or Production URL.");
}

if (!hasAuthState(storageStatePath)) {
  fail(`ADSTUDIO_E2E_STORAGE_STATE must point at a non-empty authenticated storageState file: ${storageStatePath}`);
}

console.log("Preview E2E environment is ready.");

function hasAuthState(path) {
  if (!existsSync(path)) return false;

  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return (Array.isArray(state.cookies) && state.cookies.length > 0) ||
      (Array.isArray(state.origins) && state.origins.length > 0);
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
