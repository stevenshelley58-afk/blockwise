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

const loginUrl = `${baseUrl.replace(/\/+$/, "")}/login`;

async function attemptLogin(attempt) {
  await page.goto(loginUrl, { waitUntil: "networkidle" });
  // Clicking before React hydrates submits the form natively (URL becomes
  // /login?) and the JS auth handler never runs — cold previews are slow to
  // hydrate, so give the page a beat and verify the fields hold their values.
  await page.waitForTimeout(1_500 * attempt);
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await Promise.race([
    page.waitForURL(/\/home/, { timeout: 30_000 }),
    page
      .waitForURL(/\/login\?/, { timeout: 30_000 })
      .then(() => {
        throw new Error("hydration-race");
      }),
    page
      .locator(".form-error")
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(async () => {
        const formError = (await page.locator(".form-error").textContent().catch(() => null))?.trim();
        throw new Error(`form-error: ${formError || "unknown"}`);
      }),
  ]);
}

try {
  let lastError = null;
  let loggedIn = false;
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt += 1) {
    try {
      await attemptLogin(attempt);
      loggedIn = true;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // The hydration race is retryable; real auth errors are not.
      if (!message.includes("hydration-race") && !message.includes("Timeout")) throw error;
      console.warn(`Login attempt ${attempt} hit "${message}" — retrying.`);
    }
  }
  if (!loggedIn) throw lastError ?? new Error("Login did not complete.");

  mkdirSync(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  console.log(`Saved authenticated storage state to ${storageStatePath}`);
} catch (error) {
  const formError = await page.locator(".form-error").textContent().catch(() => null);
  const turnstilePresent = await page.locator("iframe[src*='challenges.cloudflare.com']").count().catch(() => 0);
  throw new Error(
    `Login failed against ${baseUrl}: ${error instanceof Error ? error.message : String(error)}` +
      (formError ? ` (form error: "${formError.trim()}")` : "") +
      (turnstilePresent ? " — Turnstile is enforcing on this deployment; use Cloudflare's always-pass test sitekey on previews." : ""),
  );
} finally {
  await browser.close();
}
