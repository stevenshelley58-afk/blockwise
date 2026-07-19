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
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: storageStatePath });
  // Real AI generation + edit + export can take several minutes end to end.
  test.setTimeout(1_200_000);

  test("keeps the sample-first workspace usable at supported viewport sizes", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    const viewports = [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
      await expect(page.getByLabel("Ad Studio workspace")).toBeVisible({ timeout: 30_000 });
      await openNewAd(page);
      await expect(page.getByRole("heading", { name: /choose a template/i })).toBeVisible();
      await expect(page.getByText(/^\d+ templates$/)).toBeVisible();
      await page.getByRole("button", { name: /^close$/i }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        `workspace should not overflow horizontally at ${viewport.width}x${viewport.height}`,
      ).toBe(true);
    }
  });

  test("runs Fast and High quality through generation, edit, reload, and export", async ({ page }, testInfo) => {
    // The cookie banner renders late (post-hydration) and overlays the dialog
    // footer, intercepting the Generate Ad click — a click-if-visible dismissal
    // races it. Seeding the stored choice keeps it from ever rendering.
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);

    if (await page.getByRole("heading", { name: /approve your brand kit first/i }).isVisible().catch(() => false)) {
      await page.getByRole("link", { name: /open brand studio/i }).click();
      await approveBrandKit(page);
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
    }

    // The soft brand prompt ("Set your brand before launch?") is skippable and
    // otherwise intercepts every click on the workbench.
    const skipBrand = page.getByRole("button", { name: /skip for now/i });
    if (await skipBrand.isVisible().catch(() => false)) {
      await skipBrand.click();
    }

    for (const quality of ["fast", "high"] as const) {
      await exerciseGenerationMode(
        page,
        quality,
        testInfo.outputPath(`${quality}-listing.png`),
        testInfo.outputPath(`${quality}-logo.png`),
      );
    }
  });

  test("keeps pinned Model Control readable at desktop and mobile sizes", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/model-control");
      await expect(page.getByRole("heading", { name: "Model Control" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "AdStudio generation modes" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Fast", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "High quality", exact: true })).toBeVisible();
      await expect(page.getByText(/gemini-2\.5-flash-lite/i).first()).toBeVisible();
      await expect(page.getByText(/gpt-image-2/i).first()).toBeVisible();
      await expect(page.getByText(/live, billable generation request/i)).toBeVisible();
      await expect(page.getByText(/OpenRouter|Azure OpenAI/i)).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `Model Control should not overflow horizontally at ${viewport.width}x${viewport.height}`,
      ).toBe(true);
    }
  });
});

async function exerciseGenerationMode(
  page: Page,
  quality: "fast" | "high",
  listingPath: string,
  logoPath: string,
) {
  await openNewAd(page);
  await chooseCloneSample(page);
  await uploadRequiredSampleImages(page, listingPath, logoPath);
  await fillCustomerCopyFields(page);
  await page.locator(`input[name="generation-quality"][value="${quality}"]`).check();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /details|description/i })
    .first()
    .fill(`Open home this Saturday. ${quality} direct-provider verification.`);

  const generationResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/adstudio/campaigns" && response.request().method() === "POST";
    },
    { timeout: 280_000 },
  );
  void generationResponse.catch(() => {});
  const dialogBlocked = page
    .locator(".studio-newad-requirements, .studio-newad-error")
    .first()
    .waitFor({ state: "visible", timeout: 280_000 })
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
  const campaignId = generatedPayload.jobId
    ? await waitForGenerationJob(page, generatedPayload.jobId)
    : generatedPayload.campaignPack?.campaign?.campaignId;
  expect(campaignId).toBeTruthy();
  await assertCampaignModeAndFormats(page, campaignId ?? "", quality);

  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 90_000 });
  const editedImage = await editGeneratedClone(page);
  await waitForSavedStatus(page);

  await page.goto(`/ad-studio?campaignId=${encodeURIComponent(campaignId ?? "")}&workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
  await assertCampaignModeAndFormats(page, campaignId ?? "", quality);
  await openPanel(page, "Text");
  await expect(page.locator(".studio-inplace-frame img").filter({ visible: true }).first()).toHaveAttribute(
    "src",
    editedImage,
    { timeout: 30_000 },
  );
  await openPanel(page, "Publish");
  await exportCreatives(page);
}

async function assertCampaignModeAndFormats(page: Page, campaignId: string, quality: "fast" | "high") {
  const response = await page.request.get(`/api/adstudio/campaigns/${encodeURIComponent(campaignId)}`);
  expect(response.ok(), await response.text()).toBe(true);
  const payload = (await response.json()) as {
    campaign?: { generation_quality?: string };
    creatives?: Array<{ format?: string }>;
  };
  expect(payload.campaign?.generation_quality).toBe(quality);
  expect(new Set(payload.creatives?.map((creative) => creative.format))).toEqual(new Set(["4:5", "9:16"]));
}

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

// The real loop uses the approved sanitized sample and no alternate creation
// path. The private source ad is never exposed to the browser.
async function chooseCloneSample(page: Page) {
  const killTest = page.getByRole("button", { name: /use just listed sage panel .* template/i }).first();
  // The gallery renders after the dialog opens; an immediate isVisible() races
  // it and silently falls back to whatever template happens to sort first.
  // Wait for the kill-test template properly - its inputs match the uploaded
  // listing photo + logo and the KILL_TEST_COPY fields.
  if (await killTest.waitFor({ state: "visible", timeout: 30_000 }).then(() => true).catch(() => false)) {
    await killTest.click();
    return;
  }
  const sample = page.getByRole("button", { name: /use .* template/i }).first();
  await expect(sample).toBeVisible({ timeout: 30_000 });
  await sample.click();
}

// Customer-typed on-image fields (price, address, phone…) render on the ad
// verbatim; the vision QA then verifies these exact strings. Distinct values
// prove nothing was invented or paraphrased.
const KILL_TEST_COPY: Record<string, string> = {
  headline: "JUST LISTED",
  price: "$847,500",
  address: "12 MARINE PDE, SCARBOROUGH WA 6019",
  phone: "+61 411 222 333",
  "website handle": "@scarboroughhomes",
};

async function fillCustomerCopyFields(page: Page) {
  const fields = page.locator(".studio-newad-copyfields input");
  const count = await fields.count();
  for (let index = 0; index < count; index += 1) {
    const input = fields.nth(index);
    const label = ((await input.evaluate(
      (el) => el.closest("label")?.querySelector("span")?.textContent ?? "",
    )) as string).toLowerCase();
    const match = Object.entries(KILL_TEST_COPY).find(([key]) => label.includes(key));
    await input.fill(match?.[1] ?? "SAMPLE TEXT");
  }
}

// Samples expose one file input per declared image slot. An unfilled required
// slot blocks
// submit() with a footer alert, not a disabled button. Fill them all, waiting
// out each slot's upload round-trip before starting the next.
async function uploadRequiredSampleImages(page: Page, listingPath: string, logoPath: string) {
  await Promise.all([
    writeListingPng(page, listingPath),
    writeLogoPng(page, logoPath),
  ]);
  const inputs = page.locator('.studio-newad input[type="file"]');
  const count = await inputs.count();
  expect(count, "the brief step should expose at least one image slot").toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    await input.setInputFiles(index === 1 ? logoPath : listingPath);
    await expect(
      page.getByRole("button", { name: /uploading/i }),
      `image slot ${index + 1} of ${count} should finish uploading`,
    ).toBeHidden({ timeout: 60_000 });
  }
  await expect(page.getByRole("button", { name: /generate ad/i })).toBeEnabled({ timeout: 30_000 });
}

async function editGeneratedClone(page: Page): Promise<string> {
  const image = page.locator(".studio-inplace-frame img").filter({ visible: true }).first();
  await expect(image).toBeVisible({ timeout: 90_000 });
  const originalImage = await image.getAttribute("src");
  expect(originalImage).toBeTruthy();

  const textRegion = page.locator(".studio-inplace-region.text").filter({ visible: true }).first();
  await expect(textRegion).toBeVisible({ timeout: 90_000 });
  await textRegion.click();
  const editor = page.locator(".studio-inplace-editor textarea");
  await expect(editor).toBeVisible();
  await editor.fill("JUST LISTED TODAY");

  const editResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return /\/api\/adstudio\/creatives\/[^/]+\/edit$/u.test(url.pathname) && response.request().method() === "POST";
    },
    { timeout: 280_000 },
  );
  await page.getByRole("button", { name: /confirm edit/i }).click();
  const edited = await editResponse;
  expect(edited.ok(), await edited.text()).toBe(true);
  await expect(image).not.toHaveAttribute("src", originalImage ?? "", { timeout: 90_000 });
  const editedImage = await image.getAttribute("src");
  expect(editedImage).toBeTruthy();
  return editedImage ?? "";
}

async function openPanel(page: Page, label: "Text" | "Publish") {
  const button = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

async function exportCreatives(page: Page) {
  const exportResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.pathname.includes("/api/adstudio/export-packages/") &&
        url.pathname.endsWith("/download") &&
        response.request().method() === "POST";
    },
    // Browser-side rendering of all formats precedes the download request.
    { timeout: 150_000 },
  );
  void exportResponse.catch(() => {});
  const download = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);

  // The export flow refuses silently via a 2.4s toast (copy limits, render
  // failures, save errors) — race it so the app's own refusal message becomes
  // the test failure instead of a blind timeout. The filter keeps benign
  // toasts (e.g. the quality-upgrade "Sharpened your ad") from matching.
  const refusalToast = page
    .locator(".studio-toast", { hasText: /fix the ad copy|export failed|could not|failed|retry/i })
    .first()
    .waitFor({ state: "visible", timeout: 150_000 })
    .then(() => page.locator(".studio-toast").first().textContent())
    .then((text) => text?.trim() || "the export was refused without a message")
    .catch(() => null);

  await page.getByRole("button", { name: /export/i }).click();

  const refused = await Promise.race([
    exportResponse.then(() => null).catch(() => null),
    refusalToast,
  ]);
  if (refused) {
    throw new Error(`Export never sent the download request — the app says: ${refused}`);
  }
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

async function writeLogoPng(page: Page, path: string) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#102a43";
    ctx.beginPath();
    ctx.moveTo(70, 205);
    ctx.lineTo(170, 95);
    ctx.lineTo(270, 205);
    ctx.lineTo(235, 205);
    ctx.lineTo(170, 135);
    ctx.lineTo(105, 205);
    ctx.closePath();
    ctx.fill();
    ctx.font = "700 54px Arial";
    ctx.textBaseline = "middle";
    ctx.fillText("SCARBOROUGH HOMES", 305, 160);
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
