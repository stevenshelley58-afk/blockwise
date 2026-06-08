import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const storageStatePath =
  process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const previewUrl = process.env.PLAYWRIGHT_BASE_URL;
const canRun = Boolean(previewUrl && workspaceId && hasAuthState(storageStatePath));
const describeAdStudioRealLoop = canRun ? test.describe : test.describe.skip;

describeAdStudioRealLoop("Ad Studio real loop", () => {
  test.use({ storageState: storageStatePath });
  test.setTimeout(180_000);

  test("gates first-run, creates a real ad, persists edits, reloads, and exports selected variant", async ({ page }, testInfo) => {
    await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);

    if (await page.getByRole("heading", { name: /approve your brand kit first/i }).isVisible().catch(() => false)) {
      await page.getByRole("link", { name: /open brand studio/i }).click();
      await approveBrandKit(page);
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
    }

    await openNewAd(page);
    await chooseBlankTemplate(page);
    await uploadGeneratedListingImage(page, testInfo.outputPath("listing.png"));
    await page.getByLabel(/short description/i).fill("Open home this Saturday, renovated family home in Scarborough.");
    const generationResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/adstudio/campaigns" && response.request().method() === "POST";
      },
      { timeout: 90_000 },
    );
    await page.getByRole("button", { name: /generate ad/i }).click();
    const generated = await generationResponse;
    expect(generated.ok(), await generated.text()).toBe(true);
    const generatedPayload = (await generated.json()) as { campaignPack?: { campaign?: { campaignId?: string } } };
    const campaignId = generatedPayload.campaignPack?.campaign?.campaignId;
    expect(campaignId).toBeTruthy();

    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 90_000 });
    await openPanel(page, "Copy");
    await page.getByLabel(/headline/i).fill("Scarborough open home");
    await saveDraft(page);
    await waitForSavedStatus(page);

    await page.getByRole("button", { name: /ad 2/i }).click();
    await page.getByRole("button", { name: /ad 1/i }).click();
    await openPanel(page, "Copy");
    await expect(page.getByLabel(/headline/i)).toHaveValue("Scarborough open home");

    await page.goto(`/ad-studio?campaignId=${encodeURIComponent(campaignId)}&workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
    await openPanel(page, "Copy");
    await expect(page.getByLabel(/headline/i)).toHaveValue("Scarborough open home", { timeout: 30_000 });

    await openPanel(page, "Publish");
    await exportCreatives(page);
  });
});

test("Ad Studio real-loop E2E requires a preview URL, dedicated workspace, and auth fixture", async () => {
  test.skip(!previewUrl, "Set PLAYWRIGHT_BASE_URL to run the Ad Studio real-loop E2E against Vercel Preview.");
  test.skip(canRun, "Real-loop E2E preconditions are present.");
  expect(previewUrl, "PLAYWRIGHT_BASE_URL must point at a Vercel Preview URL").toBeTruthy();
  expect(workspaceId, "ADSTUDIO_E2E_WORKSPACE_ID must be a dedicated test workspace").toBeTruthy();
  expect(hasAuthState(storageStatePath), "ADSTUDIO_E2E_STORAGE_STATE must point at an authenticated storageState").toBe(true);
});

async function approveBrandKit(page: Page) {
  const scanUrl = process.env.ADSTUDIO_E2E_BRAND_URL ?? "https://example-real-estate.test";
  const urlInput = page.getByLabel(/website|url/i).first();
  await urlInput.fill(scanUrl);
  await page.getByRole("button", { name: /scan|extract/i }).click();
  await page.getByRole("button", { name: /approve/i }).click({ timeout: 60_000 });
}

async function openNewAd(page: Page) {
  const button = page.getByRole("button", { name: /create ad|new ad|add ad/i }).first();
  if (await button.isVisible().catch(() => false)) {
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    return;
  }

  const mobileDetails = page.locator(".studio-mobile-campaign-btn");
  if (await mobileDetails.isVisible().catch(() => false)) {
    await mobileDetails.click();
    const browse = page.getByRole("button", { name: /browse templates/i }).first();
    await expect(browse).toBeEnabled({ timeout: 30_000 });
    await browse.click();
    return;
  }

  const browse = page.getByRole("button", { name: /browse templates/i }).first();
  await expect(browse).toBeEnabled({ timeout: 30_000 });
  await browse.click();
}

async function chooseBlankTemplate(page: Page) {
  const blank = page.getByRole("button", { name: /start blank|blank|create your own|describe your ad/i }).first();
  if (await blank.isVisible().catch(() => false)) {
    await blank.click();
  }
}

async function uploadGeneratedListingImage(page: Page, path: string) {
  await writeTinyPng(path);
  await page.setInputFiles('.studio-newad input[type="file"]', path);
  await expect(page.getByRole("button", { name: /listing\.png[\s\S]*selected file/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /generate ad/i })).toBeEnabled({ timeout: 30_000 });
}

async function openPanel(page: Page, label: "Copy" | "Publish") {
  const button = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

async function saveDraft(page: Page) {
  const save = page.getByRole("button", { name: /^save$/i }).first();
  if (await save.isVisible().catch(() => false)) {
    await save.click();
    return;
  }

  await page.getByRole("button", { name: /more actions/i }).click();
  await page.getByRole("menuitem", { name: /save draft/i }).click();
}

async function exportCreatives(page: Page) {
  const exportResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.pathname.includes("/api/adstudio/export-packages/") &&
        url.pathname.endsWith("/download") &&
        response.request().method() === "POST";
    },
    { timeout: 120_000 },
  );
  const download = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);

  await page.getByRole("button", { name: /export/i }).click();

  const response = await exportResponse;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.headers()["content-type"] ?? "").toMatch(/zip|octet-stream/i);

  const zip = await download;
  if (zip) expect(zip.suggestedFilename()).toMatch(/creatives\.zip$/);
}

async function waitForSavedStatus(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.locator('.studio-statusbar [data-state="saved"]').isVisible().catch(() => false)) ||
        (await page.locator('.studio-mobile-status[data-state="saved"]').isVisible().catch(() => false)),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function writeTinyPng(path: string) {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  await import("node:fs/promises").then((fs) => fs.writeFile(path, Buffer.from(base64, "base64")));
}

function hasAuthState(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as { cookies?: unknown[]; origins?: unknown[] };
    return (Array.isArray(state.cookies) && state.cookies.length > 0) || (Array.isArray(state.origins) && state.origins.length > 0);
  } catch {
    return false;
  }
}
