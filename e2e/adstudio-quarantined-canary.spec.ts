import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const templateId = process.env.ADSTUDIO_E2E_TEMPLATE_ID;
const adId = process.env.ADSTUDIO_E2E_AD_ID;
const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const dryRunEnabled = process.env.ADSTUDIO_E2E_PUBLISH_TEST_MODE === "dry-run";

const allowedBaseUrl = (() => {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && (url.hostname === "blockwise.sale" || /^blockwise(?:-[a-z0-9-]+)?-steven-shelleys-projects\.vercel\.app$/i.test(url.hostname));
  } catch { return false; }
})();

const canRun = Boolean(
  allowedBaseUrl
  && workspaceId?.trim()
  && templateId?.trim()
  && adId?.trim()
  && existsSync(storageStatePath)
  && dryRunEnabled,
);

test.describe.configure({ mode: "serial" });
test.describe("quarantined 006 production editor canary", () => {
  test.skip(!canRun, "Requires the dedicated storage state, workspace, quarantined template/ad IDs, and ADSTUDIO_E2E_PUBLISH_TEST_MODE=dry-run.");
  test.use({ storageState: storageStatePath });
  test.setTimeout(240_000);

  test("is hidden from discovery but opens through its owned test-ad route", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.locator(`a[href="/ad-studio/templates/${encodeURIComponent(templateId!)}"]`)).toHaveCount(0);

    const hiddenDetail = await page.goto(`/ad-studio/templates/${encodeURIComponent(templateId!)}`);
    expect(hiddenDetail?.status(), "a quarantined template must not have a customer detail route").toBe(404);

    await page.goto(editorUrl());
    await expect(page).toHaveURL(new RegExp(`/ad-studio/ads/${adId}$`));
    await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();
  });

  test("edits, reviews, persists, and drafts a provider-write-disabled PAUSED plan", async ({ page }) => {
    const runtime = installRuntimeGuards(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.goto(editorUrl());
    const editor = page.getByRole("region", { name: "Ad Studio editor" });
    await expect(editor).toBeVisible();

    await exerciseCanvasClickToEdit(page);

    await page.getByRole("button", { name: "Media", exact: true }).click();
    const creative = page.getByRole("complementary", { name: "Creative" });
    await expect(creative).toBeVisible();
    const templateCopy = creative.getByRole("checkbox", { name: "Use template copy", exact: true });
    await expect(templateCopy, "006 must expose editable template copy").toBeVisible();
    if (!(await templateCopy.isChecked())) await templateCopy.check();
    await expect(templateCopy).toBeChecked();
    const creativeTextInputs = creative.locator('section[aria-label="Text"] input[type="text"]');
    expect(await creativeTextInputs.count(), "006 must expose at least one editable text field").toBeGreaterThan(0);
    expect((await creativeTextInputs.allInputValues()).some(value => value.trim().length > 0), "template copy should populate an editable field").toBe(true);

    await page.getByRole("button", { name: "Copy", exact: true }).click();
    const copyPanel = page.getByRole("complementary", { name: "Meta copy" });
    await expect(copyPanel).toBeVisible();
    const baselinePrimary = "E2E selective baseline primary text.";
    const baselineHeadline = "E2E BASELINE HEADLINE";
    await copyPanel.getByLabel("Primary text", { exact: true }).fill(baselinePrimary);
    await copyPanel.getByLabel("Headline", { exact: true }).fill(baselineHeadline);
    const brief = "Promote the 006 property as a Saturday open home in Cottesloe. Keep every claim factual and invite buyers to book an inspection.";
    await page.getByLabel("What should the ad say?", { exact: true }).fill(brief);
    const proposalResponse = page.waitForResponse(response => response.url().includes(`/api/adstudio/ads/${adId}/copy-proposal?`) && response.request().method() === "POST");
    const proposalRequest = page.waitForRequest(request => request.url().includes(`/api/adstudio/ads/${adId}/copy-proposal?`) && request.method() === "POST");
    await page.getByRole("button", { name: "Generate copy", exact: true }).click();
    const [proposalReq, proposalRes] = await Promise.all([proposalRequest, proposalResponse]);
    expect((proposalReq.postDataJSON() as { brief?: string }).brief).toBe(brief);
    const proposal = await proposalRes.json() as { onImage?: Record<string, string>; copy?: { primaryText: string; headline: string; description: string; cta: string }; source?: string; error?: string };
    expect(proposalRes.ok(), JSON.stringify(proposal)).toBe(true);
    expect(proposal.copy?.headline).toBeTruthy();
    await expect(page.getByLabel("Generated copy proposal")).toBeVisible();

    await page.getByRole("button", { name: "Use Headline", exact: true }).click();
    await expect(copyPanel.getByLabel("Headline", { exact: true })).toHaveValue(proposal.copy!.headline);
    await expect(copyPanel.getByLabel("Primary text", { exact: true })).toHaveValue(baselinePrimary);
    await page.getByRole("button", { name: "Use all", exact: true }).click();
    await expect(page.getByLabel("Generated copy proposal")).toHaveCount(0);
    await expect(copyPanel.getByLabel("Primary text", { exact: true })).toHaveValue(proposal.copy!.primaryText);
    await expect(copyPanel.getByLabel("Headline", { exact: true })).toHaveValue(proposal.copy!.headline);
    await expect(copyPanel.getByLabel("Description", { exact: true })).toHaveValue(proposal.copy!.description);
    await expect(copyPanel.getByLabel("Call to action", { exact: true })).toHaveValue(proposal.copy!.cta);
    for (const [key, value] of Object.entries(proposal.onImage ?? {})) {
      await expect(page.locator(`[id="creative-${key}"]`)).toHaveValue(value);
    }

    await page.getByRole("button", { name: "Colours", exact: true }).click();
    const colourMode = page.getByRole("radiogroup", { name: "Colour mode" });
    await colourMode.getByRole("radio", { name: "Template", exact: true }).click();
    await expect(colourMode.getByRole("radio", { name: "Template", exact: true })).toBeChecked();
    await colourMode.getByRole("radio", { name: "Brand Pack", exact: true }).click();
    await expect(colourMode.getByRole("radio", { name: "Brand Pack", exact: true })).toBeChecked();
    await colourMode.getByRole("radio", { name: "Custom colours", exact: true }).click();
    await expect(colourMode.getByRole("radio", { name: "Custom colours", exact: true })).toBeChecked();
    const manualPrimary = "#0B3D91";
    const primaryHex = page.locator('[data-role="primary"] input[type="text"]');
    await primaryHex.fill(manualPrimary);
    await primaryHex.blur();
    await expect(primaryHex).toHaveValue(manualPrimary);

    await page.getByRole("radio", { name: "Meta preview", exact: true }).click();
    await page.getByRole("tab", { name: "Feed", exact: true }).click();
    await expect(page.getByTestId("meta-feed-preview")).toBeVisible();
    await page.getByRole("tab", { name: "Story", exact: true }).click();
    await expect(page.getByTestId("meta-story-preview")).toBeVisible();
    await page.getByRole("tab", { name: "Both", exact: true }).click();
    await expect(page.getByTestId("meta-feed-preview")).toBeVisible();
    await expect(page.getByTestId("meta-story-preview")).toBeVisible();
    await expect(page.getByText("Sponsored", { exact: true }).first()).toBeVisible();

    const saveResponse = page.waitForResponse(response => response.url().includes(`/api/adstudio/ads/${adId}/save?`) && response.request().method() === "POST");
    const saveRequest = page.waitForRequest(request => request.url().includes(`/api/adstudio/ads/${adId}/save?`) && request.method() === "POST");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const [saveReq, saveRes] = await Promise.all([saveRequest, saveResponse]);
    const savedRequest = saveReq.postDataJSON() as { document?: { templateId?: string; colourMode?: string; resolvedColourMap?: Record<string, string> } };
    const savedResponse = await saveRes.json() as { ad?: { feedPngHash?: string; storyPngHash?: string; revisionNumber?: number }; error?: string };
    expect(saveRes.ok(), JSON.stringify(savedResponse)).toBe(true);
    expect(savedRequest.document).toMatchObject({ templateId, colourMode: "custom", resolvedColourMap: { primary: manualPrimary } });
    expect(savedResponse.ad?.feedPngHash).toBeTruthy();
    expect(savedResponse.ad?.storyPngHash).toBeTruthy();
    expect(savedResponse.ad?.revisionNumber).toBeGreaterThan(0);
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/ad-studio/ads/${adId}$`));
    await expect(editor).toBeVisible();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Meta copy" }).getByLabel("Headline", { exact: true })).toHaveValue(proposal.copy!.headline);
    await page.getByRole("button", { name: "Colours", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Custom colours", exact: true })).toBeChecked();
    await expect(page.locator('[data-role="primary"] input[type="text"]')).toHaveValue(manualPrimary);

    await page.getByRole("button", { name: "Review & publish", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/ad-studio/templates/${templateId}/publish\\?adId=${adId}$`));
    await expect(page.getByRole("img", { name: "Saved Feed ad" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Saved Story ad" })).toBeVisible();
    await expect(page.getByText("Preview only · nothing will be created", { exact: true })).toBeVisible();
    await configurePausedPlan(page);

    const freeze = page.getByRole("button", { name: "Preview paused plan", exact: true });
    await expect(freeze).toBeEnabled();
    await page.getByText("What happens next", { exact: true }).click();
    await expect(page.getByText(/Preview only is on.*nothing will be created/i)).toBeVisible();
    const publishResponse = page.waitForResponse(response => response.url().includes(`/api/adstudio/ads/${adId}/publish?`) && response.request().method() === "POST");
    await freeze.click();
    const publishRes = await publishResponse;
    const receipt = await publishRes.json() as { mode?: string; providerWritesEnabled?: boolean; status?: string; plannedObjects?: { campaigns?: number; adSets?: number; creatives?: number; ads?: number }; reconciledObjects?: Record<string, string>; message?: string; error?: string };
    expect(publishRes.ok(), JSON.stringify(receipt)).toBe(true);
    expect(receipt).toMatchObject({ mode: "dry_run", providerWritesEnabled: false, status: "paused_disabled" });
    expect(receipt.plannedObjects).toMatchObject({ campaigns: 1, adSets: 1, creatives: 2, ads: 2 });
    expect(receipt.reconciledObjects ?? {}).toEqual({});
    expect(receipt.message).toMatch(/NO Meta objects were created/i);
    await expect(page.getByRole("button", { name: /Activate/i })).toHaveCount(0);
    await runtime.assertHealthy("quarantined editor and dry-run publish");
  });
});

function editorUrl() {
  return `/ad-studio/ads/${encodeURIComponent(adId!)}`;
}

async function exerciseCanvasClickToEdit(page: Page) {
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const clickSurface = page.locator("canvas.upper-canvas").first();
  await expect(clickSurface).toBeVisible();
  const selection = page.locator('.sr-only[aria-live="polite"]').filter({ hasText: /^Selected layer:/ });
  const box = await clickSurface.boundingBox();
  expect(box).not.toBeNull();
  const points = [[0.5, 0.18], [0.5, 0.35], [0.25, 0.25], [0.75, 0.25], [0.5, 0.65], [0.25, 0.75], [0.75, 0.75]];
  for (const [x, y] of points) {
    await clickSurface.click({ position: { x: Math.max(2, box!.width * x), y: Math.max(2, box!.height * y) } });
    if (await selection.count()) break;
  }
  await expect(selection, "clicking a visible creative layer should select it").toHaveCount(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Editor inspector" })).toBeVisible();
}

async function configurePausedPlan(page: Page) {
  await expect(page.getByLabel("Feed (4:5)", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Story (9:16)", { exact: true })).toBeChecked();
  await page.getByLabel("Campaign and ad set", { exact: true }).selectOption("new_campaign_new_adset");
  await page.getByLabel("Special ad category country", { exact: true }).fill("AU");
  await page.getByLabel(/^Ad set budget \(ABO\)/).check();
  await page.getByLabel("Ad set daily budget (AUD)", { exact: true }).fill("25.00");
  await page.getByLabel("Audience location", { exact: true }).selectOption("custom_radius");
  await page.getByLabel("Latitude", { exact: true }).fill("-31.9523");
  await page.getByLabel("Longitude", { exact: true }).fill("115.8613");
  await page.getByLabel("Radius (km)", { exact: true }).fill("25");
  for (const placement of ["Facebook Feed", "Facebook Stories", "Instagram Feed", "Instagram Stories"]) {
    await page.getByLabel(placement, { exact: true }).check();
  }
  await page.getByLabel("Starts", { exact: true }).selectOption("scheduled");
  await page.getByLabel("Scheduled start date and time", { exact: true }).fill("2030-01-15T09:30");
  await page.getByLabel("Ends", { exact: true }).selectOption("scheduled");
  await page.getByLabel("Scheduled end date and time", { exact: true }).fill("2030-01-22T09:30");
  await page.getByLabel(/^(Ad destination|Article or website destination)$/).fill("https://example.com/e2e-listing");

  const offer = page.getByLabel("This ad includes an offer, guide or result promise", { exact: true });
  if (!(await offer.isChecked())) await offer.check();
  const fulfilmentFields: Array<[string, string]> = [
    ["Exact offer", "E2E property guide"], ["Eligibility", "All E2E enquiries"], ["Conditions", "Dry-run fixture only"],
    ["Timeframe", "Immediately after submission"], ["Evidence", "E2E evidence record"], ["Evidence approval", "Approved for dry-run verification"],
    ["Disclaimer", "Test fixture; no real offer."], ["Privacy URL", "https://example.com/privacy"], ["Fulfilment delivery URL", "https://example.com/e2e-guide"],
    ["Consent wording", "I agree to receive the test guide."], ["Fulfilment owner", "E2E test team"], ["Expiry", "2030-12-31"], ["Tracking", "E2E dry-run receipt"],
  ];
  for (const [label, value] of fulfilmentFields) await page.getByLabel(label, { exact: true }).fill(value);
  const confirmation = page.getByLabel(/^I confirm this budget mode, spend, audience, placement, schedule, creative matrix and fulfilment setup is correct/);
  await expect(confirmation).toBeEnabled();
  await confirmation.check();
}

function installRuntimeGuards(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const providerRequests: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (/graph\.facebook\.com|graph\.instagram\.com/i.test(request.url())) providerRequests.push(request.url()); });
  return {
    async assertHealthy(label: string) {
      expect(consoleErrors, `${label} emitted console.error`).toEqual([]);
      expect(pageErrors, `${label} emitted pageerror`).toEqual([]);
      expect(providerRequests, `${label} attempted a browser-side provider request`).toEqual([]);
    },
  };
}
