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
    await page.getByRole("button", { name: /generate ad/i }).click();

    await expect(page.getByText(/generated story, feed, and square/i)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /copy/i }).click();
    await page.getByLabel(/headline/i).fill("Scarborough open home");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^saved$/i).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /ad 2/i }).click();
    await page.getByRole("button", { name: /ad 1/i }).click();
    await expect(page.getByDisplayValue("Scarborough open home")).toBeVisible();

    const campaignId = campaignIdFromUrl(page) ?? await selectedCampaignId(page);
    expect(campaignId).toBeTruthy();
    await page.goto(`/ad-studio?campaignId=${encodeURIComponent(campaignId)}&workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
    await expect(page.getByDisplayValue("Scarborough open home")).toBeVisible({ timeout: 30_000 });

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /export/i }).click();
    const zip = await download;
    expect(zip.suggestedFilename()).toMatch(/creatives\.zip$/);
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
  const button = page.getByRole("button", { name: /create ad|new ad/i }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
}

async function chooseBlankTemplate(page: Page) {
  const blank = page.getByRole("button", { name: /blank|create your own|describe your ad/i }).first();
  if (await blank.isVisible().catch(() => false)) {
    await blank.click();
  }
}

async function uploadGeneratedListingImage(page: Page, path: string) {
  await writeTinyPng(path);
  await page.setInputFiles('input[type="file"]', path);
}

async function selectedCampaignId(page: Page): Promise<string> {
  const value = await page.getByLabel(/switch campaign/i).inputValue().catch(() => "");
  return value;
}

function campaignIdFromUrl(page: Page): string | null {
  return new URL(page.url()).searchParams.get("campaignId");
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
