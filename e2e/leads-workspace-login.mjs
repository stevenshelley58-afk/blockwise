// Produces the authenticated storage state used by
// e2e/leads-workspace-review.spec.ts by driving the real /login page of the
// deployment under test. Unlike the Ad Studio real-loop login this accepts any
// PLAYWRIGHT_BASE_URL because the lead review runs against a loopback preview
// of a real build, not the public origin.
//
// Env: PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_EMAIL, ADSTUDIO_E2E_PASSWORD,
//      ADSTUDIO_E2E_STORAGE_STATE (default
//      /srv/blockwise/e2e-runs/leads-workspace-20260908/browser-state.json),
//      ADSTUDIO_E2E_CHROMIUM (optional explicit browser path).

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const email = process.env.ADSTUDIO_E2E_EMAIL?.trim();
const password = process.env.ADSTUDIO_E2E_PASSWORD?.trim();
const storageStatePath =
  process.env.ADSTUDIO_E2E_STORAGE_STATE?.trim() ||
  "/srv/blockwise/e2e-runs/leads-workspace-20260908/browser-state.json";

if (!baseUrl) throw new Error("Set PLAYWRIGHT_BASE_URL to the deployment to log into.");
if (!email || !password) throw new Error("Set ADSTUDIO_E2E_EMAIL and ADSTUDIO_E2E_PASSWORD.");

const browser = await chromium.launch({
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM || undefined,
});
try {
  const context = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
  await mkdir(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  console.log(`Saved lead review login state for ${email} at ${storageStatePath}`);
} finally {
  await browser.close();
}
