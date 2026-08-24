import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const packId = process.env.ADSTUDIO_E2E_PACK_ID;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const loginBaseUrl = process.env.ADSTUDIO_E2E_LOGIN_URL || baseUrl;
const email = process.env.ADSTUDIO_E2E_EMAIL;
const password = process.env.ADSTUDIO_E2E_PASSWORD;

// This file creates and updates customer data. Override Playwright's global
// fullyParallel setting so login/create/save cannot race another test using
// the same seeded workspace and pack.
test.describe.configure({ mode: "serial" });

const baseUrlIsAllowed = (() => {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && (url.hostname === "blockwise.sale" || url.hostname.endsWith(".vercel.app"));
  } catch { return false; }
})();
const loginBaseUrlIsAllowed = (() => {
  if (!loginBaseUrl) return false;
  try {
    const url = new URL(loginBaseUrl);
    return url.protocol === "https:" && (url.hostname === "blockwise.sale" || url.hostname.endsWith(".vercel.app"));
  } catch { return false; }
})();
const loginUsesDifferentOrigin = (() => {
  if (!baseUrl || !loginBaseUrl || !baseUrlIsAllowed || !loginBaseUrlIsAllowed) return false;
  return new URL(baseUrl).origin !== new URL(loginBaseUrl).origin;
})();
const hasAuthState = existsSync(storageStatePath) && (() => {
  try {
    const state = JSON.parse(readFileSync(storageStatePath, "utf8")) as { cookies?: unknown[]; origins?: unknown[] };
    return (state.cookies?.length ?? 0) > 0 || (state.origins?.length ?? 0) > 0;
  } catch { return false; }
})();
const hasWorkspace = Boolean(workspaceId?.trim());
const hasPack = Boolean(packId?.trim());
const canRun = Boolean(baseUrlIsAllowed && hasWorkspace && hasPack && hasAuthState);
const canLogin = Boolean(baseUrlIsAllowed && loginBaseUrlIsAllowed && email?.trim() && password);
const canLoginAndCreate = Boolean(canLogin && hasWorkspace && hasPack);
const missingPreconditions = [
  !baseUrl && "PLAYWRIGHT_BASE_URL",
  baseUrl && !baseUrlIsAllowed && "PLAYWRIGHT_BASE_URL (must be https://blockwise.sale or https://*.vercel.app)",
  loginBaseUrl && !loginBaseUrlIsAllowed && "ADSTUDIO_E2E_LOGIN_URL (must be https://blockwise.sale or https://*.vercel.app)",
  !hasWorkspace && "ADSTUDIO_E2E_WORKSPACE_ID",
  !hasPack && "ADSTUDIO_E2E_PACK_ID (must identify an imported usable pack)",
  !hasAuthState && `authenticated storage state at ${storageStatePath}`,
].filter(Boolean);
if ((!canRun || !canLogin) && process.env.CI) {
  test("Ad Studio real-loop preconditions are present in CI", () => {
    throw new Error(`Ad Studio E2E preconditions missing or invalid: ${[...missingPreconditions, !email && "ADSTUDIO_E2E_EMAIL", !password && "ADSTUDIO_E2E_PASSWORD"].filter(Boolean).join(", ")}.`);
  });
}

test.describe("Ad Studio login", () => {
  test.skip(!canLoginAndCreate, "Set Vercel PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_EMAIL, ADSTUDIO_E2E_PASSWORD, ADSTUDIO_E2E_WORKSPACE_ID and ADSTUDIO_E2E_PACK_ID.");
  test.use({ storageState: { cookies: [], origins: [] } });
  test("logs in and creates an ad in one authenticated flow", async ({ page }) => {
    // Production may enforce Turnstile. The login helper can authenticate on
    // an explicitly configured captcha-free Preview and transfer only the
    // Supabase session cookies to PLAYWRIGHT_BASE_URL. Prove that login on
    // that origin, then separately prove the target starts unauthenticated.
    await page.goto(`${loginBaseUrl!.replace(/\/+$/, "")}/login`);
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/home(?:\?|$)/, { timeout: 30_000 });
    if (loginUsesDifferentOrigin) {
      await page.goto(`${baseUrl!.replace(/\/+$/, "")}/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    } else {
      await runEditorFlow(page);
    }
  });
});

test.describe("Ad Studio authenticated real loop", () => {
  test.skip(!canRun, "Set Vercel PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_WORKSPACE_ID, ADSTUDIO_E2E_PACK_ID and authenticated storage state.");
  test.use({ storageState: storageStatePath });
  test.setTimeout(180_000);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    test(`opens the gallery without overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
      await expect(page.getByRole("heading", { name: "Ad Studio" })).toBeVisible();
      await expect(page.getByText(/templates$/)).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  test("lets a test user choose a template, fill inputs, render, edit, and save", async ({ page }) => {
    await runEditorFlow(page);
  });
});

async function runEditorFlow(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
  const template = page.locator(`a[href="/ad-studio/packs/${encodeURIComponent(packId!)}"]`);
  await expect(template, `ADSTUDIO_E2E_PACK_ID=${packId} is not present in the usable pack gallery`).toHaveCount(1);
  await expect(template).toBeVisible();
  await template.click();
  await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();

  const imageInputs = page.locator('input[type="file"]');
  const imageCount = await imageInputs.count();
  expect(imageCount, "the selected pack should expose at least one image input").toBeGreaterThan(0);
  for (let i = 0; i < imageCount; i += 1) {
    await imageInputs.nth(i).setInputFiles("tests/fixtures/adstudio-v2/public/slots/photo-portrait.png");
  }
  await expect(page.locator('img[alt$="preview"]')).toHaveCount(imageCount);
  // The preview appears before the direct storage upload finishes. Saving is
  // only valid after every prepare/upload/finalize sequence has completed.
  await expect(page.getByText("Uploading image...", { exact: true })).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  const overlayInputs = page.locator('section[aria-label="Text"] input[type="text"]');
  for (let i = 0; i < await overlayInputs.count(); i += 1) await overlayInputs.nth(i).fill(`Sample overlay ${i + 1}`);
  const metaCopy = page.getByRole("complementary", { name: "Meta copy" });
  await expect(metaCopy).toBeVisible();
  await expect(metaCopy.getByLabel("Primary text", { exact: true })).toBeVisible();
  await metaCopy.getByLabel("Primary text", { exact: true }).fill("A clear test listing for a real estate campaign.");
  await metaCopy.getByLabel("Headline", { exact: true }).fill("Open home this Saturday");
  await metaCopy.getByLabel("Description", { exact: true }).fill("Book your inspection today");

  const save = () => page.waitForResponse(response => response.url().includes("/api/adstudio/ads/") && response.url().includes("/save?") && response.request().method() === "POST");
  const firstSaveRequest = page.waitForRequest(request => request.url().includes("/api/adstudio/ads/") && request.url().includes("/save?") && request.method() === "POST");
  const firstSave = save();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const firstSaveBodyRequest = await firstSaveRequest;
  const firstDocument = (firstSaveBodyRequest.postDataJSON() as { document?: { sharedImageValues?: Record<string, string> } }).document;
  for (const ref of Object.values(firstDocument?.sharedImageValues ?? {})) {
    expect(ref).toContain("/api/adstudio/media?");
    expect(ref).not.toMatch(/^data:image\//i);
  }
  const firstSaveResponse = await firstSave;
  const firstSaveBody = await firstSaveResponse.json() as { ad?: { feedPngHash?: string; storyPngHash?: string; revisionNumber?: number } };
  expect(firstSaveResponse.ok(), JSON.stringify(firstSaveBody)).toBe(true);
  expect(firstSaveBody.ad?.feedPngHash).toBeTruthy();
  expect(firstSaveBody.ad?.storyPngHash).toBeTruthy();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await metaCopy.getByLabel("Headline", { exact: true }).fill("JUST LISTED TODAY");
  const secondSave = save();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const secondSaveResponse = await secondSave;
  expect(secondSaveResponse.ok(), await secondSaveResponse.text()).toBe(true);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Meta copy" }).getByLabel("Headline", { exact: true })).toHaveValue("JUST LISTED TODAY");

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `editor should not create horizontal document overflow at ${viewport.width}px`,
    ).toBe(true);

    await page.getByRole("button", { name: "Content", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Content" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Content" }).getByLabel(/Choose image for/).first()).toBeAttached();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();

    await page.getByRole("button", { name: "Meta copy", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Meta copy" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Meta copy" }).getByLabel("Headline", { exact: true })).toHaveValue("JUST LISTED TODAY");
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
  }
}
