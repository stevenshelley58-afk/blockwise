import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const required = [
  "PLAYWRIGHT_BASE_URL",
  "ADSTUDIO_E2E_LOGIN_URL",
  "ADSTUDIO_E2E_EMAIL",
  "ADSTUDIO_E2E_PASSWORD",
  "ADSTUDIO_META_CANARY_WORKSPACE_ID",
  "ADSTUDIO_META_CANARY_TEMPLATE_NAME",
  "ADSTUDIO_META_CANARY_LOCATION",
  "ADSTUDIO_META_CANARY_IMAGE_PATH",
];
const missing = required.filter((key) => !process.env[key]?.trim());

if (process.env.ADSTUDIO_META_CANARY_CONFIRM !== "PAUSED_META_CANARY") {
  fail("Set ADSTUDIO_META_CANARY_CONFIRM=PAUSED_META_CANARY. This manual canary creates real Meta objects in PAUSED state and never activates them.");
}
if (missing.length > 0) {
  fail(`Missing hosted Meta canary values: ${missing.join(", ")}`);
}

for (const [name, value] of [
  ["PLAYWRIGHT_BASE_URL", process.env.PLAYWRIGHT_BASE_URL],
  ["ADSTUDIO_E2E_LOGIN_URL", process.env.ADSTUDIO_E2E_LOGIN_URL],
]) {
  if (!isAllowedDeploymentUrl(value)) {
    fail(`${name} must be blockwise.sale or this project's HTTPS Vercel deployment origin.`);
  }
}

if (!isUuid(process.env.ADSTUDIO_META_CANARY_WORKSPACE_ID)) {
  fail("ADSTUDIO_META_CANARY_WORKSPACE_ID must be the UUID of a dedicated, Meta-connected canary workspace.");
}
if (!isSafePng(process.env.ADSTUDIO_META_CANARY_IMAGE_PATH)) {
  fail("ADSTUDIO_META_CANARY_IMAGE_PATH must name a regular 1KB–20MB PNG file outside this Git checkout that is safe for the selected canary template.");
}
console.log("Hosted Meta PAUSED canary environment is ready. The operator command captures a fresh real authenticated session before it runs and will not activate a campaign or bypass authentication.");

function isAllowedDeploymentUrl(value) {
  try {
    const url = new URL(value);
    const isProduction = url.hostname === "blockwise.sale";
    const isProjectPreview = /^blockwise(?:-[a-z0-9-]+)?-steven-shelleys-projects\.vercel\.app$/.test(url.hostname);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && (isProduction || isProjectPreview);
  } catch {
    return false;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "");
}

function isSafePng(value) {
  try {
    if (!value || !isAbsolute(value)) return false;
    const absolutePath = resolve(value);
    if (absolutePath.startsWith(`${resolve(process.cwd())}${sep}`)) return false;
    const file = lstatSync(absolutePath);
    if (!file.isFile() || file.size < 1024 || file.size > 20 * 1024 * 1024) return false;
    const signature = readFileSync(absolutePath).subarray(0, 8);
    return signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
