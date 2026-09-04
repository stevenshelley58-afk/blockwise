import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const templateId = process.env.ADSTUDIO_E2E_TEMPLATE_ID;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const loginBaseUrl = process.env.ADSTUDIO_E2E_LOGIN_URL || baseUrl;
const email = process.env.ADSTUDIO_E2E_EMAIL;
const password = process.env.ADSTUDIO_E2E_PASSWORD;
// This is deliberately opt-in. Even when a reviewer wants to exercise the
// final publish POST, it must be a provider-write-disabled dry run.
const allowDryRunPublish = process.env.ADSTUDIO_E2E_PUBLISH_TEST_MODE === "dry-run";
const initialImagePath = "public/ads/ad-coastline.jpg";
const replacementImagePath = "public/ads/ad-hillview.jpg";

// This file creates and updates customer data. Override Playwright's global
// fullyParallel setting so login/create/save cannot race another test using
// the same seeded workspace and pack.
test.describe.configure({ mode: "serial" });

const baseUrlIsAllowed = (() => {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && (url.hostname === "blockwise.sale" || isOwnedVercelHost(url.hostname));
  } catch { return false; }
})();
const loginBaseUrlIsAllowed = (() => {
  if (!loginBaseUrl) return false;
  try {
    const url = new URL(loginBaseUrl);
    return url.protocol === "https:" && (url.hostname === "blockwise.sale" || isOwnedVercelHost(url.hostname));
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
const hasTemplate = Boolean(templateId?.trim());
const canRun = Boolean(baseUrlIsAllowed && hasWorkspace && hasTemplate && hasAuthState);
const canLogin = Boolean(baseUrlIsAllowed && loginBaseUrlIsAllowed && email?.trim() && password);
const canLoginAndCreate = Boolean(canLogin && hasWorkspace && hasTemplate);
const missingPreconditions = [
  !baseUrl && "PLAYWRIGHT_BASE_URL",
  baseUrl && !baseUrlIsAllowed && "PLAYWRIGHT_BASE_URL (must be https://blockwise.sale or this project's Vercel deployment)",
  loginBaseUrl && !loginBaseUrlIsAllowed && "ADSTUDIO_E2E_LOGIN_URL (must be https://blockwise.sale or this project's Vercel deployment)",
  !hasWorkspace && "ADSTUDIO_E2E_WORKSPACE_ID",
  !hasTemplate && "ADSTUDIO_E2E_TEMPLATE_ID (must identify an available template)",
  !hasAuthState && `authenticated storage state at ${storageStatePath}`,
].filter(Boolean);
if ((!canRun || !canLogin) && process.env.CI) {
  test("Ad Studio real-loop preconditions are present in CI", () => {
    throw new Error(`Ad Studio E2E preconditions missing or invalid: ${[...missingPreconditions, !email && "ADSTUDIO_E2E_EMAIL", !password && "ADSTUDIO_E2E_PASSWORD"].filter(Boolean).join(", ")}.`);
  });
}

test.describe("Ad Studio login", () => {
  test.skip(!canLoginAndCreate, "Set PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_EMAIL, ADSTUDIO_E2E_PASSWORD, ADSTUDIO_E2E_WORKSPACE_ID and ADSTUDIO_E2E_TEMPLATE_ID.");
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
  test.skip(!canRun, "Set PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_WORKSPACE_ID, ADSTUDIO_E2E_TEMPLATE_ID and authenticated storage state.");
  test.use({ storageState: storageStatePath });
  test.setTimeout(180_000);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    test(`opens the gallery without overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
      await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
      await expect(page.getByRole("heading", { name: "Ad Studio" })).toBeVisible();
      const templateHref = `/ad-studio/templates/${encodeURIComponent(templateId!)}`;
      const templateCard = page.locator(`a[href="${templateHref}"]`);
      await expect(templateCard, `ADSTUDIO_E2E_TEMPLATE_ID=${templateId} is not visible in the gallery at ${viewport.width}x${viewport.height}`).toBeVisible();
      await expect(templateCard).toHaveAttribute("href", templateHref);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  test("completes login-to-review customer flow with Feed and Story persistence", async ({ page }) => {
    await runEditorFlow(page);
  });
});

async function runEditorFlow(page: Page) {
  const runtime = installRuntimeGuards(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
  const template = page.locator(`a[href="/ad-studio/templates/${encodeURIComponent(templateId!)}"]`);
  await expect(template, `ADSTUDIO_E2E_TEMPLATE_ID=${templateId} is not present in the template gallery`).toHaveCount(1);
  await expect(template).toBeVisible();
  await template.click();
  const editor = page.getByRole("region", { name: "Ad Studio editor" });
  await expect(editor).toBeVisible();

  // The seeded workspace has a reviewed Brand Pack. Toggle the appearance
  // mode before saving so the durable revision covers more than copy/media.
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const appearancePanel = page.getByRole("complementary", { name: "Appearance" });
  const workspaceColours = appearancePanel.getByLabel("Use workspace colours", { exact: true });
  await expect(workspaceColours).toBeVisible();
  await expect(workspaceColours).toBeEnabled();
  await workspaceColours.check();
  await expect(workspaceColours).toBeChecked();
  await page.getByRole("tab", { name: "Content", exact: true }).click();

  // Only property/media slots are required. Optional logo and portrait slots
  // deliberately stay neutral so the test cannot turn a property photo into a
  // fake brand mark or agent identity.
  const imageInputs = page.locator('input[type="file"][required]');
  const imageCount = await imageInputs.count();
  expect(imageCount, "the selected pack should expose at least one required property image input").toBeGreaterThan(0);
  for (let i = 0; i < imageCount; i += 1) {
    await imageInputs.nth(i).setInputFiles(initialImagePath);
    await waitForImageUploads(page);
  }
  await expect(page.locator('img[alt$="preview"]')).toHaveCount(imageCount);
  // Exercise the visible replacement control, not only the underlying hidden
  // input. The second fixture also proves the preview changes after replace.
  const firstPreview = page.locator('img[alt$="preview"]').first();
  const beforeReplacement = await firstPreview.getAttribute("src");
  await page.getByRole("button", { name: "Replace", exact: true }).first().click();
  await imageInputs.first().setInputFiles(replacementImagePath);
  await waitForImageUploads(page);
  await expect(firstPreview).toBeVisible();
  expect(await firstPreview.getAttribute("src")).not.toBe(beforeReplacement);
  await expect(editor.locator('[role="alert"]')).toHaveCount(0);
  const overlayInputs = page.locator('section[aria-label="Text"] input[type="text"]');
  const overlayCount = await overlayInputs.count();
  const overlayValue = "E2E open home this Saturday";
  for (let i = 0; i < overlayCount; i += 1) await overlayInputs.nth(i).fill(i === 0 ? overlayValue : `E2E overlay ${i + 1}`);

  // Both placements must remain authorized and usable before Save. The actual
  // persisted Feed/Story PNGs are checked again on the Review & publish page.
  await assertEditorPlacement(page, "feed");
  await assertEditorPlacement(page, "story");
  await assertEditorPlacement(page, "feed");

  await page.getByRole("tab", { name: "Copy", exact: true }).click();
  const metaCopy = page.getByRole("complementary", { name: "Meta copy" });
  await expect(metaCopy).toBeVisible();
  await expect(metaCopy.getByLabel("Primary text", { exact: true })).toBeVisible();
  await metaCopy.getByLabel("Primary text", { exact: true }).fill("A clear test listing for a real estate campaign.");
  await metaCopy.getByLabel("Headline", { exact: true }).fill("Open home this Saturday");
  await metaCopy.getByLabel("Description", { exact: true }).fill("Book your inspection today");

  const firstSaveResult = await saveEditor(page);
  const firstDocument = (firstSaveResult.request.postDataJSON() as { document?: { sharedImageValues?: Record<string, string>; colourMode?: string } }).document;
  expect(Object.keys(firstDocument?.sharedImageValues ?? {})).toHaveLength(imageCount);
  expect(firstDocument?.colourMode).toBe("brand_pack");
  for (const ref of Object.values(firstDocument?.sharedImageValues ?? {})) {
    expect(ref).toContain("/api/adstudio/customer-media?");
    expect(ref).not.toMatch(/^data:image\//i);
  }
  expect(firstSaveResult.response.ok(), JSON.stringify(firstSaveResult.body)).toBe(true);
  expect(firstSaveResult.body.ad?.feedPngHash).toBeTruthy();
  expect(firstSaveResult.body.ad?.storyPngHash).toBeTruthy();
  const firstRevisionNumber = firstSaveResult.body.ad?.revisionNumber;
  expect(firstRevisionNumber).toBeGreaterThan(0);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await metaCopy.getByLabel("Headline", { exact: true }).fill("JUST LISTED TODAY");
  const secondSaveResult = await saveEditor(page);
  expect(secondSaveResult.response.ok(), JSON.stringify(secondSaveResult.body)).toBe(true);
  expect(secondSaveResult.body.ad?.revisionNumber).toBeGreaterThan(firstRevisionNumber!);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('section[aria-label="Text"] input[type="text"]').first()).toHaveValue(overlayValue);
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Appearance" }).getByLabel("Use workspace colours", { exact: true })).toBeChecked();
  await page.getByRole("tab", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Meta copy" }).getByLabel("Headline", { exact: true })).toHaveValue("JUST LISTED TODAY");

  // Review freezes the last saved revision and must render both authenticated
  // media responses. It is safe to inspect this page without publishing.
  await page.getByRole("button", { name: "Review & publish", exact: true }).click();
  await expect(page).toHaveURL(/\/ad-studio\/templates\/[^/]+\/publish(?:\?|$)/);
  for (const heading of [
    "1. Creative & copy",
    "2. Destination & form",
    "3. Audience, budget & schedule",
    "4. Review & create paused",
  ]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/Step\s+2\s+of\s+4/i)).toBeVisible();
  const frozenFeed = page.getByRole("img", { name: "Saved Feed ad" });
  const frozenStory = page.getByRole("img", { name: "Saved Story ad" });
  await expect(frozenFeed).toBeVisible();
  await expect(frozenStory).toBeVisible();
  await expect.poll(() => frozenFeed.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => frozenStory.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  for (const frozenImage of [frozenFeed, frozenStory]) {
    const src = await frozenImage.getAttribute("src");
    expect(src, "frozen creative should expose a same-origin media export").toMatch(/^\/api\/adstudio\/media\?path=/);
    const exported = await page.evaluate(async (imageSrc) => {
      const response = await fetch(imageSrc);
      const bytes = await response.arrayBuffer();
      return { status: response.status, contentType: response.headers.get("content-type"), byteLength: bytes.byteLength };
    }, src!);
    expect(exported.status).toBe(200);
    expect(exported.contentType).toMatch(/^image\/png(?:;|$)/i);
    expect(exported.byteLength).toBeGreaterThan(100);
  }
  await configurePublishPlanner(page);
  await expect(page.getByText(/Preview only.*nothing will be created/i)).toBeVisible();

  const freezeAndCreate = page.getByRole("button", { name: "Preview paused plan", exact: true });
  await expect(freezeAndCreate).toBeVisible();
  if (allowDryRunPublish) {
    // The explicit test-mode flag is not enough by itself: the deployment
    // must also advertise the dry-run badge, and the response must confirm
    // providerWritesEnabled=false. This prevents an accidental Meta write if
    // someone points the test at a wrongly configured deployment.
    // Never let the opt-in flag turn a writes-enabled deployment into a Meta
    // mutation. The server-rendered dry-run notice is the preflight guard;
    // the response assertion below is a second defense after the request.
    await page.getByText("What happens next", { exact: true }).click();
    await expect(page.getByText(/Preview only is on.*nothing will be created/i)).toBeVisible();
    await expect(freezeAndCreate).toBeEnabled();
    const publishRequest = page.waitForRequest(request => request.url().includes("/api/adstudio/ads/") && request.url().includes("/publish?") && request.method() === "POST");
    const publishResponse = page.waitForResponse(response => response.url().includes("/api/adstudio/ads/") && response.url().includes("/publish?") && response.request().method() === "POST");
    await freezeAndCreate.click();
    const [request, response] = await Promise.all([publishRequest, publishResponse]);
    const requestBody = request.postDataJSON() as {
      controls?: {
        target?: { mode?: string };
        destinationUrl?: string;
        variantIds?: string[];
        dailyBudgetMinorUnits?: number;
        newCampaign?: { budgetMode?: string; specialAdCategoryCountries?: string[] };
        geo?: { type?: string; latitude?: number; longitude?: number; radiusKm?: number };
        placements?: { publisherPlatforms?: string[]; facebookPositions?: string[]; instagramPositions?: string[] };
        schedule?: { startTime?: string | null; endTime?: string | null };
        fulfilment?: { exactOffer?: string; fulfilmentAsset?: string; fulfilmentUrl?: string };
      };
    };
    expect(requestBody.controls).toMatchObject({
      target: { mode: "new_campaign_new_adset" },
      destinationUrl: "https://example.com/e2e-listing",
      variantIds: ["feed", "story"],
      dailyBudgetMinorUnits: 2_500,
      newCampaign: { budgetMode: "adset", specialAdCategoryCountries: ["AU"] },
      geo: { type: "custom_radius", latitude: -31.9523, longitude: 115.8613, radiusKm: 25 },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: ["feed", "story"],
        instagramPositions: ["stream", "story"],
      },
      fulfilment: {
        exactOffer: "E2E property guide",
        fulfilmentAsset: "",
        fulfilmentUrl: "https://example.com/e2e-guide",
      },
    });
    expect(Date.parse(requestBody.controls?.schedule?.startTime ?? "")).toBeLessThan(
      Date.parse(requestBody.controls?.schedule?.endTime ?? ""),
    );
    const body = await response.json() as {
      mode?: string;
      status?: string;
      providerWritesEnabled?: boolean;
      snapshotId?: string;
      planId?: string;
      source?: { creativeRevision?: number; formRevision?: number };
      plannedObjects?: { campaigns?: number; adSets?: number; creatives?: number; ads?: number };
      reconciledObjects?: Record<string, string>;
      message?: string;
      error?: string;
    };
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    expect(body.mode, JSON.stringify(body)).toBe("dry_run");
    expect(body.status, JSON.stringify(body)).toBe("paused_disabled");
    expect(body.providerWritesEnabled, JSON.stringify(body)).toBe(false);
    expect(body.plannedObjects, JSON.stringify(body)).toMatchObject({ campaigns: 1, adSets: 1, creatives: 2, ads: 2 });
    expect(body.reconciledObjects ?? {}, "dry run must not report any provider object IDs").toEqual({});
    expect(body.message, JSON.stringify(body)).toMatch(/NO Meta objects were created/i);
    expect(body.snapshotId, JSON.stringify(body)).toBeTruthy();
    expect(body.planId, JSON.stringify(body)).toBeTruthy();
    expect(body.source, JSON.stringify(body)).toMatchObject({ creativeRevision: secondSaveResult.body.ad?.revisionNumber });
    await expect(page.getByRole("status").filter({ hasText: /Preview complete/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Activate/i })).toHaveCount(0);
  }

  await page.goto(`/ad-studio/templates/${encodeURIComponent(templateId!)}`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review & publish", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      `editor should not create horizontal document overflow at ${viewport.width}px`,
    ).toBe(true);

    await assertEditorPlacement(page, "feed");
    await assertEditorPlacement(page, "story");
    await assertEditorPlacement(page, "feed");

    const contentControl = viewport.width < 1280
      ? page.getByRole("button", { name: "Content", exact: true })
      : page.getByRole("tab", { name: "Content", exact: true });
    await contentControl.click();
    await expect(page.getByRole("complementary", { name: "Content" })).toBeVisible();
    const contentPanel = page.getByRole("complementary", { name: "Content" });
    await expect(contentPanel.getByLabel(/Choose image for|Replace/).first()).toBeAttached();
    if (viewport.width < 1280) await page.getByRole("button", { name: "Close", exact: true }).click();

    const copyControl = viewport.width < 1280
      ? page.getByRole("button", { name: "Copy", exact: true })
      : page.getByRole("tab", { name: "Copy", exact: true });
    await copyControl.click();
    await expect(page.getByRole("complementary", { name: "Meta copy" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Meta copy" }).getByLabel("Headline", { exact: true })).toHaveValue("JUST LISTED TODAY");
    if (viewport.width < 1280) await page.getByRole("button", { name: "Close", exact: true }).click();

    const appearanceControl = viewport.width < 1280
      ? page.getByRole("button", { name: "Appearance", exact: true })
      : page.getByRole("tab", { name: "Appearance", exact: true });
    await appearanceControl.click();
    const appearancePanel = page.getByRole("complementary", { name: "Appearance" });
    await expect(appearancePanel).toBeVisible();
    await expect(appearancePanel.getByLabel("Use workspace colours", { exact: true })).toBeChecked();
    if (viewport.width < 1280) await page.getByRole("button", { name: "Close", exact: true }).click();
  }

  await runtime.assertHealthy("editor and Review & publish flow");
}

function isOwnedVercelHost(hostname: string): boolean {
  return /^blockwise(?:-[a-z0-9-]+)?-steven-shelleys-projects\.vercel\.app$/i.test(hostname);
}

type SaveResult = {
  request: import("@playwright/test").Request;
  response: import("@playwright/test").Response;
  body: { ad?: { feedPngHash?: string; storyPngHash?: string; revisionNumber?: number }; error?: string };
};

async function saveEditor(page: Page): Promise<SaveResult> {
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/adstudio/ads/") && response.url().includes("/save?") && response.request().method() === "POST");
  const requestPromise = page.waitForRequest(request => request.url().includes("/api/adstudio/ads/") && request.url().includes("/save?") && request.method() === "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  const body = await response.json() as SaveResult["body"];
  return { request, response, body };
}

async function waitForImageUploads(page: Page) {
  // The preview appears before the direct storage upload finishes. Saving is
  // only valid after every prepare/upload/finalize sequence has completed.
  await expect(page.getByText(/Uploading/)).toHaveCount(0, { timeout: 60_000 });
}

async function configurePublishPlanner(page: Page) {
  const feedVariant = page.getByLabel("Feed (4:5)", { exact: true });
  const storyVariant = page.getByLabel("Story (9:16)", { exact: true });
  await expect(feedVariant).toBeChecked();
  await expect(storyVariant).toBeChecked();
  await storyVariant.uncheck();
  await expect(page.getByRole("status").filter({ hasText: /1 selected variant.*1 ad set.*1 paused ad/ })).toBeVisible();
  await storyVariant.check();
  await expect(page.getByRole("status").filter({ hasText: /2 selected variants.*1 ad set.*2 paused ads/ })).toBeVisible();

  // Exercise every supported target shape before completing the sole
  // direct-template E2E path with a new campaign and new ad set.
  const target = page.getByLabel("Campaign and ad set", { exact: true });
  expect(await target.locator("option").allTextContents()).toEqual([
    "New campaign and new ad set",
    "Existing campaign and new ad set",
    "Existing campaign and one or more existing ad sets",
  ]);
  await target.selectOption("existing_adset");
  const existingCampaign = page.getByLabel("Existing campaign ID", { exact: true });
  const existingAdSets = page.getByLabel("Existing ad set IDs", { exact: true });
  await existingCampaign.fill("e2e-existing-campaign");
  await existingAdSets.fill("e2e-existing-adset-1, e2e-existing-adset-2");
  await expect(existingCampaign).toHaveValue("e2e-existing-campaign");
  await expect(existingAdSets).toHaveValue("e2e-existing-adset-1, e2e-existing-adset-2");
  await expect(page.getByRole("heading", { name: "Existing ad set settings", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /2 selected variants.*2 ad sets.*4 paused ads/ })).toBeVisible();

  await target.selectOption("existing_campaign_new_adset");
  await page.getByLabel("Existing campaign ID", { exact: true }).fill("e2e-existing-campaign");
  await expect(page.getByLabel("Existing ad set IDs", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "New ad set setup", exact: true })).toBeVisible();

  await target.selectOption("new_campaign_new_adset");
  await expect(page.getByLabel("Existing campaign ID", { exact: true })).toHaveCount(0);
  await page.getByLabel("Special ad category country", { exact: true }).fill("AU");

  const campaignBudget = page.getByLabel(/^Campaign budget \(CBO\)/);
  const adSetBudget = page.getByLabel(/^Ad set budget \(ABO\)/);
  await campaignBudget.check();
  await expect(campaignBudget).toBeChecked();
  await adSetBudget.check();
  await expect(adSetBudget).toBeChecked();
  await expect(campaignBudget).not.toBeChecked();
  await page.getByLabel("Ad set daily budget (AUD)", { exact: true }).fill("25.00");

  await page.getByLabel("Audience location", { exact: true }).selectOption("custom_radius");
  await page.getByLabel("Latitude", { exact: true }).fill("-31.9523");
  await page.getByLabel("Longitude", { exact: true }).fill("115.8613");
  await page.getByLabel("Radius (km)", { exact: true }).fill("25");

  for (const placement of ["Facebook Feed", "Facebook Stories", "Instagram Feed", "Instagram Stories"]) {
    const choice = page.getByLabel(placement, { exact: true });
    await choice.check();
    await expect(choice).toBeChecked();
  }

  await page.getByLabel("Starts", { exact: true }).selectOption("scheduled");
  await page.getByLabel("Scheduled start date and time", { exact: true }).fill("2030-01-15T09:30");
  await page.getByLabel("Ends", { exact: true }).selectOption("scheduled");
  await page.getByLabel("Scheduled end date and time", { exact: true }).fill("2030-01-22T09:30");
  await page.getByLabel(/^(Ad destination|Article or website destination)$/).fill("https://example.com/e2e-listing");

  const offer = page.getByLabel("This ad includes an offer, guide or result promise", { exact: true });
  if (!(await offer.isChecked())) {
    await expect(offer).toBeEnabled();
    await offer.check();
  }
  await expect(offer).toBeChecked();
  const fulfilmentFields: Array<[string, string]> = [
    ["Exact offer", "E2E property guide"],
    ["Eligibility", "All E2E enquiries"],
    ["Conditions", "Dry-run fixture only"],
    ["Timeframe", "Immediately after submission"],
    ["Evidence", "E2E evidence record"],
    ["Evidence approval", "Approved for dry-run verification"],
    ["Disclaimer", "Test fixture; no real offer."],
    ["Privacy URL", "https://example.com/privacy"],
    ["Fulfilment delivery URL", "https://example.com/e2e-guide"],
    ["Consent wording", "I agree to receive the test guide."],
    ["Fulfilment owner", "E2E test team"],
    ["Expiry", "2030-12-31"],
    ["Tracking", "E2E dry-run receipt"],
  ];
  for (const [label, value] of fulfilmentFields) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }

  const summary = page.getByText("Review the exact setup", { exact: true }).locator("..");
  await expect(summary).toContainText(/New campaign.*new ad set/);
  await expect(summary).toContainText("Ad set budget (ABO)");
  await expect(summary).toContainText("A$25.00 per day for the new ad set");
  await expect(summary).toContainText("25 km around -31.9523, 115.8613");
  for (const placement of ["Facebook Feed", "Facebook Stories", "Instagram Feed", "Instagram Stories"]) {
    await expect(summary).toContainText(placement);
  }
  await expect(summary).toContainText("Feed + Story");
  await expect(summary).toContainText("E2E property guide");

  const confirmation = page.getByLabel(/^I confirm this budget mode, spend, audience, placement, schedule, creative matrix and fulfilment setup is correct/);
  await expect(confirmation).toBeEnabled();
  await confirmation.check();
  await expect(confirmation).toBeChecked();
}

async function assertEditorPlacement(page: Page, placement: "feed" | "story") {
  const label = placement === "feed" ? /Feed/ : /Story/;
  await page.getByRole("tab", { name: label }).click();
  await expect(page.getByRole("img", { name: new RegExp(`${placement} layered ad preview`, "i") })).toBeVisible();
}

function installRuntimeGuards(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedImages: string[] = [];
  const providerRequests: string[] = [];

  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => {
    if (request.resourceType() === "image") failedImages.push(`${request.url()} — ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("request", request => {
    if (/graph\.facebook\.com|graph\.instagram\.com/i.test(request.url())) providerRequests.push(request.url());
  });

  return {
    async assertHealthy(label: string) {
      const brokenImages = await page.locator("img").evaluateAll(images => images
        .filter(image => !image.complete || image.naturalWidth === 0)
        .map(image => `${image.getAttribute("alt") ?? "image"}: ${image.getAttribute("src") ?? "(missing src)"}`));
      expect(brokenImages, `${label} has broken images`).toEqual([]);
      expect(failedImages, `${label} had failed image requests`).toEqual([]);
      expect(consoleErrors, `${label} emitted console.error`).toEqual([]);
      expect(pageErrors, `${label} emitted pageerror`).toEqual([]);
      expect(providerRequests, `${label} attempted a browser-side provider request`).toEqual([]);
    },
  };
}
