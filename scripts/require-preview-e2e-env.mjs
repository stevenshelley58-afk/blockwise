import { existsSync, readFileSync } from "node:fs";

const required = [
  "PLAYWRIGHT_BASE_URL",
  "ADSTUDIO_E2E_EMAIL",
  "ADSTUDIO_E2E_PASSWORD",
  "ADSTUDIO_E2E_WORKSPACE_ID",
  "ADSTUDIO_E2E_PACK_ID",
];
const missing = required.filter((key) => !process.env[key]?.trim());
const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";

if (missing.length > 0) {
  fail(`Missing preview E2E environment variables: ${missing.join(", ")}`);
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() ?? "";
const loginBaseUrl = process.env.ADSTUDIO_E2E_LOGIN_URL?.trim() || baseUrl;

requireDeploymentUrl(baseUrl, "PLAYWRIGHT_BASE_URL");
requireDeploymentUrl(loginBaseUrl, "ADSTUDIO_E2E_LOGIN_URL");

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

function requireDeploymentUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be an HTTPS Vercel Preview or Production URL.`);
  }

  const isProduction = url.hostname === "blockwise.sale";
  const isOwnedVercel = /^blockwise(?:-[a-z0-9-]+)?-steven-shelleys-projects\.vercel\.app$/i.test(url.hostname);
  const isCleanOrigin =
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === "443") &&
    (url.pathname === "/" || url.pathname === "") &&
    !url.search &&
    !url.hash;
  if ((!isProduction && !isOwnedVercel) || !isCleanOrigin) {
    fail(`${label} must be blockwise.sale or this project's HTTPS Vercel deployment origin.`);
  }
}
