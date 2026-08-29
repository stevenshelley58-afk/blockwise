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
  await expect(page.getByText(/Preview only.*nothing will be created/i)).toBeVisible();

  const freezeAndCreate = page.getByRole("button", { name: "Freeze & Create PAUSED", exact: true });
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
    const publishResponse = page.waitForResponse(response => response.url().includes("/api/adstudio/ads/") && response.url().includes("/publish?") && response.request().method() === "POST");
    await freezeAndCreate.click();
    const response = await publishResponse;
    const body = await response.json() as { mode?: string; providerWritesEnabled?: boolean; error?: string };
    expect(response.ok(), JSON.stringify(body)).toBe(true);
    expect(body.mode, JSON.stringify(body)).toBe("dry_run");
    expect(body.providerWritesEnabled, JSON.stringify(body)).not.toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /Dry run/ })).toBeVisible();
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
