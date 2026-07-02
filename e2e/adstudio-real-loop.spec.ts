import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const storageStatePath =
  process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const previewUrl = process.env.PLAYWRIGHT_BASE_URL;
const canRun = Boolean(previewUrl && workspaceId && hasAuthState(storageStatePath));
const describeAdStudioRealLoop = canRun ? test.describe : test.describe.skip;

// In CI a missing precondition is a FAILURE, not a skip — the silent skip is
// how runtime regressions shipped green. Locally it still skips quietly.
if (!canRun && process.env.CI) {
  test("Ad Studio real-loop preconditions are present in CI", () => {
    const missing = [
      !previewUrl && "PLAYWRIGHT_BASE_URL",
      !workspaceId && "ADSTUDIO_E2E_WORKSPACE_ID",
      !hasAuthState(storageStatePath) && `auth storage state at ${storageStatePath}`,
    ].filter(Boolean);
    throw new Error(`Ad Studio real-loop e2e cannot run in CI — missing: ${missing.join(", ")}.`);
  });
}

describeAdStudioRealLoop("Ad Studio real loop", () => {
  test.use({ storageState: storageStatePath });
  // Real AI generation + edit + export can take several minutes end to end.
  test.setTimeout(420_000);

  test("gates first-run, creates a real ad, persists edits, reloads, and exports selected variant", async ({ page }, testInfo) => {
    await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);

    if (await page.getByRole("heading", { name: /approve your brand kit first/i }).isVisible().catch(() => false)) {
      await page.getByRole("link", { name: /open brand studio/i }).click();
      await approveBrandKit(page);
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
    }

    // The cookie consent banner overlays the workbench footer and intercepts
    // clicks on anything underneath it (including Generate Ad).
    const consent = page.getByRole("button", { name: /essential only/i });
    if (await consent.isVisible().catch(() => false)) {
      await consent.click();
    }

    // The soft brand prompt ("Set your brand before launch?") is skippable and
    // otherwise intercepts every click on the workbench.
    const skipBrand = page.getByRole("button", { name: /skip for now/i });
    if (await skipBrand.isVisible().catch(() => false)) {
      await skipBrand.click();
    }

    await openNewAd(page);
    await chooseFirstTemplate(page);
    await uploadRequiredTemplateImages(page, testInfo.outputPath("listing.png"));
    // The brief label is template-specific (e.g. "Listing details") and the
    // dialog title can match the same words — target the textbox role so the
    // locator can never resolve to the dialog container.
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: /details|description/i })
      .first()
      .fill("Open home this Saturday, renovated family home in Scarborough.");
    const generationResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/adstudio/campaigns" && response.request().method() === "POST";
      },
      // The synchronous degraded-mode pipeline (copy + clone + vision QA in
      // one request) can legitimately take ~2 minutes.
      { timeout: 150_000 },
    );
    // submit() bails out with a footer alert (requirement blockers) or an
    // inline error instead of a disabled button, so a blocked submit produces
    // NO network request at all. Racing the alert against the response turns
    // that silent timeout into the dialog's own message.
    const dialogBlocked = page
      .locator(".studio-newad-requirements, .studio-newad-error")
      .first()
      .waitFor({ state: "visible", timeout: 150_000 })
      .then(() => page.locator(".studio-newad-requirements, .studio-newad-error").first().textContent())
      .then((text) => text?.trim() || "the dialog blocked the submit without a message")
      .catch(() => null);
    await page.getByRole("button", { name: /generate ad/i }).click();
    const blockedMessage = await Promise.race([
      generationResponse.then(() => null).catch(() => null),
      dialogBlocked,
    ]);
    if (blockedMessage) {
      throw new Error(`Generate ad never sent POST /api/adstudio/campaigns — dialog says: ${blockedMessage}`);
    }
    const generated = await generationResponse;
    expect(generated.ok(), await generated.text()).toBe(true);
    const generatedPayload = (await generated.json()) as {
      campaignPack?: { campaign?: { campaignId?: string } };
      jobId?: string;
    };
    // Async path (202 + job polling) or sync fallback (201 + pack) — both valid.
    const campaignId = generatedPayload.jobId
      ? await waitForGenerationJob(page, generatedPayload.jobId)
      : generatedPayload.campaignPack?.campaign?.campaignId;
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
    const browse = page.getByRole("button", { name: /browse|create new/i }).first();
    await expect(browse).toBeEnabled({ timeout: 30_000 });
    await browse.click();
    return;
  }

  const browse = page.getByRole("button", { name: /browse|create new/i }).first();
  await expect(browse).toBeEnabled({ timeout: 30_000 });
  await browse.click();
}

// Async generation: poll the jobs endpoint with the page's session until the
// trigger.dev job completes, mirroring what the dialog does.
async function waitForGenerationJob(page: Page, jobId: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const response = await page.request.get(`/api/adstudio/jobs/${encodeURIComponent(jobId)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const job = (await response.json()) as { status?: string; error?: string | null; campaign_id?: string | null };
    if (job.status === "done" && job.campaign_id) return job.campaign_id;
    if (job.status === "failed") throw new Error(`Generation job failed: ${job.error ?? "unknown error"}`);
    if (Date.now() > deadline) throw new Error("Generation job did not finish within 10 minutes.");
    await page.waitForTimeout(2_500);
  }
}

// Blank mode was cut (P2.3): every new ad starts from a template, so the loop
// picks the first template card when the dialog opens on the source step.
async function chooseFirstTemplate(page: Page) {
  const template = page.getByRole("button", { name: /use .* template/i }).first();
  if (await template.isVisible().catch(() => false)) {
    await template.click();
  }
}

// Templates expose one file input per image slot, and EVERY non-headshot slot
// is required (see imageRequirementsForTemplate) — an unfilled slot blocks
// submit() with a footer alert, not a disabled button. Fill them all, waiting
// out each slot's upload round-trip before starting the next.
async function uploadRequiredTemplateImages(page: Page, path: string) {
  await writeListingPng(page, path);
  const inputs = page.locator('.studio-newad input[type="file"]');
  const count = await inputs.count();
  expect(count, "the brief step should expose at least one image slot").toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await inputs.nth(index).setInputFiles(path);
    await expect(
      page.locator('.studio-newad .asset-upload-zone[data-has-file="true"]'),
      `image slot ${index + 1} of ${count} should finish uploading`,
    ).toHaveCount(index + 1, { timeout: 30_000 });
  }
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

// A 1x1 stub PNG travels the whole pipeline only to be rejected by the image
// provider ("You uploaded an unsupported image"), so draw a plausible
// 1080x1350 listing photo on a canvas instead — real dimensions, real content.
async function writeListingPng(page: Page, path: string) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    const sky = ctx.createLinearGradient(0, 0, 0, 700);
    sky.addColorStop(0, "#87b7e0");
    sky.addColorStop(1, "#dbe9f4");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1080, 700);
    ctx.fillStyle = "#6f9e5f";
    ctx.fillRect(0, 700, 1080, 650);
    ctx.fillStyle = "#7a5844";
    ctx.beginPath();
    ctx.moveTo(160, 430);
    ctx.lineTo(540, 240);
    ctx.lineTo(920, 430);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e8e0d2";
    ctx.fillRect(200, 430, 680, 370);
    ctx.fillStyle = "#4a3b2f";
    ctx.fillRect(500, 620, 90, 180);
    ctx.fillStyle = "#9ec7e8";
    ctx.fillRect(280, 500, 120, 100);
    ctx.fillRect(680, 500, 120, 100);
    return canvas.toDataURL("image/png");
  });
  const base64 = dataUrl.split(",")[1] ?? "";
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
