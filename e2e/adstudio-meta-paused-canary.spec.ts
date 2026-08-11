import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-meta-canary.storage-state.json";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const workspaceId = process.env.ADSTUDIO_META_CANARY_WORKSPACE_ID;
const templateName = process.env.ADSTUDIO_META_CANARY_TEMPLATE_NAME;
const targetLocation = process.env.ADSTUDIO_META_CANARY_LOCATION;
const imageBase64 = process.env.ADSTUDIO_META_CANARY_IMAGE_BASE64;
const canRun = Boolean(
  baseUrl && workspaceId && templateName && targetLocation && imageBase64 &&
  process.env.ADSTUDIO_META_CANARY_CONFIRM === "PAUSED_META_CANARY" && hasAuthState(storageStatePath),
);
const describeCanary = canRun ? test.describe : test.describe.skip;

if (!canRun && process.env.CI) {
  test("hosted Meta PAUSED canary preconditions are present in CI", () => {
    throw new Error(`Hosted Meta PAUSED canary cannot run in CI — missing: ${missingPreconditions().join(", ")}.`);
  });
}

describeCanary("hosted Meta PAUSED canary", () => {
  test.use({ storageState: storageStatePath });
  test.describe.configure({ mode: "serial" });
  test.setTimeout(15 * 60_000);

  test("creates, revisions, publishes, and reads back only paused Feed, Story, and Instant Form objects", async ({ page }) => {
    // This guard makes any accidental activation call a test failure. The test
    // never supplies confirmSpend or a plan token and does not mock Meta.
    await page.route("**/api/integrations/meta/publish-plans/*/mutations", async (route) => {
      throw new Error(`The PAUSED canary must never request activation: ${route.request().url()}`);
    });

    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.getByLabel("Ad Studio")).toBeVisible({ timeout: 30_000 });
    await assertPublishPrerequisites(page);
    if (await page.getByText("Brand needs review").isVisible().catch(() => false)) {
      throw new Error("The dedicated canary workspace Brand Pack is not approved; refusing to spend a generation credit.");
    }
    await expect(page.getByRole("button", { name: "Create ad" })).toBeVisible();

    await page.getByRole("button", { name: "Create ad" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Choose a design" })).toBeVisible();
    await dialog.getByRole("button", { name: new RegExp(escapeRegExp(templateName!), "i") }).click();
    await expect(dialog.getByRole("heading", { name: "Make this design yours" })).toBeVisible();

    const image = Buffer.from(imageBase64!, "base64");
    const imageInputs = dialog.locator('input[type="file"]');
    expect(await imageInputs.count(), "The selected canary template needs at least one customer image input.").toBeGreaterThan(0);
    for (let index = 0; index < await imageInputs.count(); index += 1) {
      await imageInputs.nth(index).setInputFiles({
        name: `hosted-meta-canary-${index + 1}.png`,
        mimeType: "image/png",
        buffer: image,
      });
    }

    // The template's visible customer-copy fields are deliberately changed so
    // the generated finished clone is not merely the public gallery sample.
    const copyInputs = dialog.locator('input[type="text"]');
    for (let index = 0; index < await copyInputs.count(); index += 1) {
      const input = copyInputs.nth(index);
      const maximum = Number(await input.getAttribute("maxlength")) || 80;
      await input.fill(`Canary ${index + 1}`.slice(0, maximum));
    }

    const generation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/adstudio/campaigns" && response.request().method() === "POST",
    { timeout: 60_000 });
    await dialog.getByRole("button", { name: "Generate finished ad" }).click();
    const generationResponse = await generation;
    expect(generationResponse.ok(), await generationResponse.text()).toBe(true);
    const generationPayload = await generationResponse.json() as { jobId?: string; campaignPack?: { campaign?: { campaignId?: string } } };
    const campaignId = generationPayload.jobId
      ? await waitForGenerationJob(page, generationPayload.jobId)
      : generationPayload.campaignPack?.campaign?.campaignId;
    expect(campaignId, "Generation must produce a persisted campaign.").toBeTruthy();

    await expect(page.getByRole("heading", { name: "Edit finished ad" })).toBeVisible({ timeout: 10 * 60_000 });
    await editAndSaveOneTextRegion(page);

    const expectedPack = await loadCampaignPack(page, campaignId!);
    const expectedBindings = expectedPack.creatives
      .filter((creative) => creative.format === "4:5" || creative.format === "9:16")
      .map((creative) => ({ format: creative.format, creativeId: creative.creativeId, revisionId: creative.activeRevisionId }));
    expect(expectedBindings.filter((binding) => binding.format === "4:5" && binding.revisionId)).toHaveLength(1);
    expect(expectedBindings.filter((binding) => binding.format === "9:16" && binding.revisionId)).toHaveLength(1);

    await page.getByRole("button", { name: "Review & publish" }).click();
    await expect(page.getByRole("heading", { name: "Publish to Meta" })).toBeVisible();
    await selectTargetLocation(page, targetLocation!);
    await expect(page.getByRole("button", { name: "Create paused Meta campaign" })).toBeEnabled({ timeout: 30_000 });

    const publish = page.waitForResponse((response) =>
      /\/api\/adstudio\/export-packages\/[^/]+\/publish$/u.test(new URL(response.url()).pathname) && response.request().method() === "POST",
    { timeout: 60_000 });
    await page.getByRole("button", { name: "Create paused Meta campaign" }).click();
    const publishResponse = await publish;
    expect(publishResponse.ok(), await publishResponse.text()).toBe(true);
    const publishPayload = await publishResponse.json() as { providerWritesEnabled?: boolean; metaPublishPlan?: { id?: string; status?: string }; blockers?: string[] };
    expect(publishPayload.providerWritesEnabled, "The deployed canary workspace must have provider writes enabled.").toBe(true);
    const planId = publishPayload.metaPublishPlan?.id;
    expect(planId, `Publish did not create a Meta plan: ${(publishPayload.blockers ?? []).join(" ")}`).toBeTruthy();

    const plan = await waitForPausedPlan(page, planId!);
    expect(plan.status).toBe("paused_ready");
    expect(plan.readback?.campaign?.plannedStatus).toBe("PAUSED");
    expect(plan.readback?.campaign?.effectiveStatus).toBe("PAUSED");
    expect(plan.readback?.leadForms).toHaveLength(1);
    expect(plan.readback?.leadForms?.[0]?.providerId, "Meta must return the generated Instant Form ID.").toBeTruthy();
    expect(plan.readback?.leadForms?.[0]?.readBack).toBe(true);
    expect(plan.readback?.adSets?.every((adSet) => adSet.plannedStatus === "PAUSED" && adSet.effectiveStatus === "PAUSED")).toBe(true);
    expect(plan.readback?.ads?.every((ad) => ad.plannedStatus === "PAUSED" && ad.effectiveStatus === "PAUSED")).toBe(true);

    const actualBindings = plan.readback?.creatives.flatMap((creative) => creative.revisionBindings) ?? [];
    expect(actualBindings).toHaveLength(2);
    for (const expected of expectedBindings) {
      const placement = expected.format === "4:5" ? "feed" : "story";
      expect(actualBindings).toContainEqual(expect.objectContaining({
        placement,
        creativeId: expected.creativeId,
        revisionId: expected.revisionId,
      }));
    }
    expect(plan.readback?.creatives.every((creative) => Boolean(creative.providerId) && Boolean(creative.leadFormProviderId))).toBe(true);
  });
});

async function editAndSaveOneTextRegion(page: Page) {
  const edit = page.getByLabel("Replacement text");
  const regions = page.getByRole("button", { name: /^Edit .+/ });
  await expect(regions.first()).toBeVisible({ timeout: 60_000 });
  let selectedText = false;
  for (let index = 0; index < await regions.count(); index += 1) {
    await regions.nth(index).click();
    if (await edit.isVisible().catch(() => false)) {
      selectedText = true;
      break;
    }
  }
  if (!selectedText) throw new Error("The generated Feed clone exposes no editable text region.");
  await edit.fill("Canary saved revision");
  const response = page.waitForResponse((candidate) =>
    /\/api\/adstudio\/creatives\/[^/]+\/edit$/u.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST",
  { timeout: 5 * 60_000 });
  await page.getByRole("button", { name: "Save text change" }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByText("New version saved")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Current version saved")).toBeVisible();
}

async function selectTargetLocation(page: Page, location: string) {
  const input = page.getByLabel("Target suburb");
  await input.fill(location);
  const suggestion = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(location)}(?:,|$)`, "i") });
  await expect(suggestion).toBeVisible({ timeout: 30_000 });
  await suggestion.click();
}

async function assertPublishPrerequisites(page: Page) {
  const response = await page.request.get("/api/adstudio/publish-readiness");
  expect(response.ok(), await response.text()).toBe(true);
  const readiness = await response.json() as { ready?: boolean; blockers?: string[]; providerWritesEnabled?: boolean; providers?: { meta?: { connected?: boolean } } };
  if (readiness.ready !== true || readiness.providerWritesEnabled !== true || readiness.providers?.meta?.connected !== true) {
    throw new Error(
      `Dedicated canary workspace is not ready for a real PAUSED Meta publish: ${(readiness.blockers ?? ["Meta connection or provider writes are missing."]).join(" ")}`,
    );
  }
}

async function waitForGenerationJob(page: Page, jobId: string): Promise<string> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const response = await page.request.get(`/api/adstudio/jobs/${encodeURIComponent(jobId)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as { status?: string; campaign_id?: string; error?: string };
    if (body.status === "done" && body.campaign_id) return body.campaign_id;
    if (body.status === "failed") throw new Error(`Ad generation failed: ${body.error ?? "unknown error"}`);
    await page.waitForTimeout(2_500);
  }
  throw new Error("Ad generation did not complete within 10 minutes.");
}

async function loadCampaignPack(page: Page, campaignId: string): Promise<{ creatives: Array<{ format: string; creativeId: string; activeRevisionId?: string | null }> }> {
  const response = await page.request.get(`/api/adstudio/campaigns/${encodeURIComponent(campaignId)}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json() as { campaignPack: { creatives: Array<{ format: string; creativeId: string; activeRevisionId?: string | null }> } }).campaignPack;
}

type PlanReadback = {
  status?: string;
  lastError?: string | null;
  readback?: {
    campaign?: { plannedStatus?: string; effectiveStatus?: string | null };
    leadForms?: Array<{ providerId?: string; readBack?: boolean }>;
    adSets?: Array<{ plannedStatus?: string; effectiveStatus?: string | null }>;
    creatives: Array<{ providerId?: string; leadFormProviderId?: string; revisionBindings: Array<{ placement: string; creativeId: string; revisionId: string | null }> }>;
    ads?: Array<{ plannedStatus?: string; effectiveStatus?: string | null }>;
  };
};

async function waitForPausedPlan(page: Page, planId: string): Promise<PlanReadback> {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const response = await page.request.get(`/api/integrations/meta/publish-plans/${encodeURIComponent(planId)}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json() as PlanReadback;
    if (body.status === "paused_ready") return body;
    if (body.status === "failed" || body.status === "reconciliation_required") {
      throw new Error(`Meta PAUSED canary stopped at ${body.status}: ${body.lastError ?? "unknown error"}`);
    }
    await page.waitForTimeout(2_500);
  }
  throw new Error("Meta did not reach paused_ready within 3 minutes.");
}

function hasAuthState(path: string) {
  if (!existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    return (state.cookies?.length ?? 0) > 0 || (state.origins?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function missingPreconditions() {
  return [
    !baseUrl && "PLAYWRIGHT_BASE_URL",
    !workspaceId && "ADSTUDIO_META_CANARY_WORKSPACE_ID",
    !templateName && "ADSTUDIO_META_CANARY_TEMPLATE_NAME",
    !targetLocation && "ADSTUDIO_META_CANARY_LOCATION",
    !imageBase64 && "ADSTUDIO_META_CANARY_IMAGE_BASE64",
    process.env.ADSTUDIO_META_CANARY_CONFIRM !== "PAUSED_META_CANARY" && "ADSTUDIO_META_CANARY_CONFIRM=PAUSED_META_CANARY",
    !hasAuthState(storageStatePath) && `fresh authenticated storage state at ${storageStatePath}`,
  ].filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
