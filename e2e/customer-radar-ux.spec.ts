import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Read-only customer acceptance for the Ad Radar lane.
 *
 * The suite intentionally does not enable Ad Radar. If the candidate keeps the
 * product feature gate off, the suite skips with an explicit reason rather
 * than changing configuration or treating an unavailable screen as a pass.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const storageState =
  process.env.ADSTUDIO_E2E_STORAGE_STATE ??
  "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const canRun = Boolean(baseUrl && existsSync(storageState));

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1000'%3E%3Crect width='100%25' height='100%25' fill='%23dfe8e2'/%3E%3C/svg%3E";

const card = {
  id: CARD_ID,
  libraryId: "123456789",
  agentId: null,
  agentName: "Jamie Agent",
  agencyId: "agency-1",
  agencyName: "Example Agency",
  attributionLinks: [],
  pageId: "page-1",
  pageName: "Example Realty",
  pageUrl: null,
  pageImageUrl: null,
  activeStatus: "active",
  startedAt: "2026-09-01T00:00:00Z",
  stoppedAt: null,
  lastSeenAt: "2026-09-08T00:00:00Z",
  platforms: ["Facebook"],
  postcode: "6000",
  suburb: "Perth",
  state: "WA",
  postcodes: ["6000"],
  areaMatchPostcode: "6000",
  areaMatchSuburb: "Perth",
  areaMatchState: "WA",
  areaMatchType: "office",
  areaMatchConfidence: 100,
  adAreaPostcodes: ["6000"],
  adAreaSuburbs: ["Perth"],
  serviceAreaPostcodes: [],
  serviceAreaSuburbs: [],
  adType: "listing",
  headline: "Saturday open home",
  body: "A clear, factual property ad for acceptance testing.",
  description: "Book an inspection.",
  cta: "Learn more",
  destinationUrl: null,
  media: [{ id: "media-1", kind: "image", url: IMAGE_URL, posterUrl: null }],
};

test.use({
  storageState,
  serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary
      ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"]
      : undefined,
  },
});

test.describe.configure({ mode: "parallel" });
test.describe("customer Ad Radar UX acceptance", () => {
  test.setTimeout(120_000);

  test.skip(
    !canRun,
    "Requires PLAYWRIGHT_BASE_URL and the controlled authenticated browser fixture.",
  );

  test.beforeEach(async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));

    // All mutations are blocked by default. Individual tests add their own
    // mocked POST response when they need to exercise an error surface.
    await page.route("**/*", async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        return route.continue();
      }
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Read-only Ad Radar acceptance" }),
      });
    });
    await page.route("**/api/research/ads/search**", async (route) => {
      await route.fulfill({
        json: { cards: [card], page: { nextCursor: null, limit: 48 } },
      });
    });

    const response = await page.goto("/ad-radar?q=homes");
    const gated = response?.status() === 404 || (await page.getByRole("heading", { name: "Page not found" }).count()) > 0;
    testInfo.skip(
      gated,
      "Ad Radar feature gate is disabled in this candidate; acceptance is intentionally unavailable and does not activate the feature.",
    );
  });

  test("search, filter, and browser Back restore the URL/search state", async ({ page }) => {
    await page.goto("/ad-radar?seed=1");
    await page.reload();
    const input = page.getByLabel("Search Ad Radar", { exact: true });
    await input.fill("homes");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/ad-radar\?seed=1&q=homes/);
    await expect(page.getByRole("button", { name: "Open Example Realty ad", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const agency = page.locator("select").first();
    await expect(agency).toBeVisible();
    await agency.selectOption({ label: "Example Agency" });
    await expect(page).toHaveURL(/\/ad-radar\?seed=1&q=homes&agency=Example\+Agency/);

    await page.goBack();
    await expect(page).toHaveURL(/\/ad-radar\?seed=1$/);
    await expect(input).toHaveValue("");
    await expect(page.locator("select").first()).toHaveValue("");
    await expect(page.getByRole("button", { name: "Open Example Realty ad", exact: true })).toHaveCount(0);
  });

  test("lightbox keeps internal details same-tab and exposes mocked Save failure inside", async ({ page }) => {
    await page.route("**/api/research/swipe-file", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
    });
    await expect(page.getByRole("button", { name: "Open Example Realty ad", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Example Realty ad", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const details = dialog.getByRole("link", { name: "View details", exact: true });
    expect(await details.getAttribute("target")).toBeNull();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Could not save this ad");
    await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();

    await details.click();
    await expect(page).toHaveURL(new RegExp(`/ad-radar/ads/${CARD_ID}$`));
  });

  test("saved inspiration never shows an empty collection beside a load error", async ({ page }) => {
    await page.goto("/ad-radar/swipe-file");
    const unavailable = page.getByRole("heading", { name: "Saved inspiration unavailable", exact: true });
    const empty = page.getByRole("heading", { name: "No saved ads yet", exact: true });
    if (await unavailable.isVisible().catch(() => false)) {
      await expect(empty).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Retry", exact: true })).toHaveAttribute("href", "/ad-radar/swipe-file");
    } else if (await empty.count()) {
      await expect(unavailable).toHaveCount(0);
    }
  });

  test("mobile result cards lead with the image preview", async ({ page }, testInfo) => {
    const tile = page.getByRole("button", { name: "Open Example Realty ad", exact: true });
    await expect(tile).toBeVisible();
    const image = tile.locator("img").first();
    const pageName = tile.getByText("Example Realty", { exact: true });
    await expect(image).toBeVisible();
    await expect(pageName).toBeVisible();
    const imageBox = await image.boundingBox();
    const nameBox = await pageName.boundingBox();
    expect(imageBox).not.toBeNull();
    expect(nameBox).not.toBeNull();
    expect(imageBox!.y).toBeLessThanOrEqual(nameBox!.y);
    await page.screenshot({ path: testInfo.outputPath("radar-mobile.png"), fullPage: true });
  });

  test("desktop Radar view is captured for review", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ad-radar?q=homes");
    await expect(page.getByText("Example Realty", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("radar-desktop.png"), fullPage: true });
  });
});

// Keep this helper typed for future canary diagnostics without coupling tests
// to an app-side feature flag or changing the browser state.
export async function radarDocumentStatus(page: Page): Promise<number | null> {
  const response = await page.request.get("/ad-radar");
  return response.status();
}
