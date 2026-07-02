// Produces the authenticated Playwright storage state for the Ad Studio
// real-loop e2e by driving the real /login page against the target deployment.
//
// Env: PLAYWRIGHT_BASE_URL (the Vercel Preview URL),
//      ADSTUDIO_E2E_EMAIL, ADSTUDIO_E2E_PASSWORD,
//      ADSTUDIO_E2E_STORAGE_STATE (default e2e/.auth/adstudio-test.storage-state.json).
//
// Note: if the deployment renders Cloudflare Turnstile on /login
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY set to a real key), headless login cannot
// pass it — configure the preview environment with Cloudflare's always-pass
// test sitekey or leave the variable unset for previews.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const email = process.env.ADSTUDIO_E2E_EMAIL?.trim();
const password = process.env.ADSTUDIO_E2E_PASSWORD?.trim();
const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE?.trim() || "e2e/.auth/adstudio-test.storage-state.json";

if (!baseUrl) throw new Error("Set PLAYWRIGHT_BASE_URL to the deployment to log into.");
if (!email || !password) throw new Error("Set ADSTUDIO_E2E_EMAIL and ADSTUDIO_E2E_PASSWORD.");

// ADSTUDIO_E2E_CHROMIUM lets sandboxes with a system chromium (but a different
// Playwright browser revision) run this without downloading browsers; the
// proxy option honours sandbox egress proxies (no-op when unset, as in CI).
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM || undefined,
  proxy: proxyServer ? { server: proxyServer } : undefined,
});
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${baseUrl.replace(/\/+$/, "")}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30_000 });

  mkdirSync(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  console.log(`Saved authenticated storage state to ${storageStatePath}`);
} catch (error) {
  const formError = await page.locator(".form-error").textContent().catch(() => null);
  throw new Error(
    `Login failed against ${baseUrl}: ${error instanceof Error ? error.message : String(error)}` +
      (formError ? ` (form error: "${formError.trim()}")` : "") +
      " — check the e2e credentials are seeded and Turnstile is not enforcing on this deployment.",
  );
} finally {
  await browser.close();
}
