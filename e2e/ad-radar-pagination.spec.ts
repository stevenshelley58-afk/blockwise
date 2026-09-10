import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const canRun = Boolean(baseUrl && workspaceId && storageState && existsSync(storageState));

test.skip(!canRun, "Requires the authenticated Ad Radar canary URL, workspace, and storage state.");
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.use({
  storageState, serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});
test.describe.configure({ mode: "serial" });

type Card = Record<string, unknown>;

function card(id: string, pageName: string): Card {
  return {
    id, libraryId: id, agentId: null, agentName: null, agencyId: null, agencyName: "Test Agency",
    attributionLinks: [], pageId: id, pageName, pageUrl: null, pageImageUrl: null,
    activeStatus: "active", startedAt: "2026-09-01T00:00:00Z", stoppedAt: null,
    lastSeenAt: "2026-09-08T00:00:00Z", platforms: [], postcode: "6000", suburb: "Perth",
    state: "WA", postcodes: ["6000"], areaMatchPostcode: "6000", areaMatchSuburb: "Perth",
    areaMatchState: "WA", areaMatchType: "office", areaMatchConfidence: 100,
    adAreaPostcodes: ["6000"], adAreaSuburbs: ["Perth"], serviceAreaPostcodes: [],
    serviceAreaSuburbs: [], adType: "listing", headline: pageName, body: "Test ad",
    description: null, cta: "Learn more", destinationUrl: null, media: [],
  };
}

test("Ad Radar pagination appends, deduplicates, resets, and preserves cards on append failure", async ({ page }) => {
  const calls: Array<{ q: string; cursor: string | null }> = [];
  let appendAttempt = 0;
  await page.route("**/api/research/ads/search**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get("q") ?? "";
    const cursor = requestUrl.searchParams.get("cursor");
    calls.push({ q, cursor });
    if (q === "homes" && !cursor) {
      await route.fulfill({ json: { cards: [card("a", "Page A"), card("b", "Page B")], page: { nextCursor: "cursor-1", limit: 50 } } });
      return;
    }
    if (q === "homes" && cursor === "cursor-1" && appendAttempt++ === 0) {
      await route.fulfill({ status: 502, json: { error: "unavailable" } });
      return;
    }
    if (q === "homes" && cursor === "cursor-1") {
      await route.fulfill({ json: { cards: [card("b", "Page B"), card("c", "Page C")], page: { nextCursor: null, limit: 50 } } });
      return;
    }
    await route.fulfill({ json: { cards: [card("d", "Page D")], page: { nextCursor: null, limit: 50 } } });
  });

  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.goto(`/ad-radar?workspaceId=${encodeURIComponent(workspaceId!)}`);
  await expect(page.getByLabel("Search Ad Radar", { exact: true })).toBeVisible();

  const input = page.getByLabel("Search Ad Radar", { exact: true });
  await input.fill("homes");
  await input.press("Enter");
  await expect(page.getByText("Page A", { exact: true })).toBeVisible();
  await expect(page.getByText("Page B", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByText("Page A", { exact: true })).toBeVisible();
  await expect(page.getByText("Page B", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Page C", { exact: true })).toBeVisible();
  await expect(page.getByText("Page B", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);

  await input.fill("apartments");
  await input.press("Enter");
  await expect(page.getByText("Page D", { exact: true })).toBeVisible();
  await expect(page.getByText("Page A", { exact: true })).toHaveCount(0);
  await expect.poll(() => calls).toContainEqual({ q: "apartments", cursor: null });
  expect(calls).toEqual([
    { q: "homes", cursor: null },
    { q: "homes", cursor: "cursor-1" },
    { q: "homes", cursor: "cursor-1" },
    { q: "apartments", cursor: null },
  ]);
});
