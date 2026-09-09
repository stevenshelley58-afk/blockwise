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

function cardLocator(page: import("@playwright/test").Page, pageName: string) {
  return page.getByRole("heading", { name: pageName, exact: true })
    .or(page.getByRole("button", { name: `Open ${pageName} ad`, exact: true }))
    .first();
}

async function cardCount(page: import("@playwright/test").Page, pageName: string) {
  return (await page.getByRole("heading", { name: pageName, exact: true }).count())
    + (await page.getByRole("button", { name: `Open ${pageName} ad`, exact: true }).count());
}

test("Ad Radar pagination appends, deduplicates, resets, and preserves cards on append failure", async ({ page }) => {
  const calls: Array<{ q: string; cursor: string | null }> = [];
  let appendAttempt = 0;
  let initialSettled = false;
  let initialSettleResolve: (() => void) | undefined;
  const initialSettle = new Promise<void>((resolve) => { initialSettleResolve = resolve; });
  let delayedPerthStartedResolve: (() => void) | undefined;
  const delayedPerthStarted = new Promise<void>((resolve) => { delayedPerthStartedResolve = resolve; });
  await page.route("**/api/research/ads/search**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const q = requestUrl.searchParams.get("q") ?? "";
    const cursor = requestUrl.searchParams.get("cursor");
    // The panel performs an initial location query before the user search. Keep
    // that response deterministic; a stale response must not overwrite newer
    // search results.
    if (q === "Perth, WA" && !initialSettled) {
      await route.fulfill({ json: { cards: [], page: { nextCursor: null, limit: 50 } } });
      initialSettled = true;
      initialSettleResolve?.();
      return;
    }
    if (q === "Perth") {
      calls.push({ q, cursor });
      delayedPerthStartedResolve?.();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({ json: { cards: [], page: { nextCursor: null, limit: 50 } } });
      return;
    }
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
    if (q === "apartments" && !cursor) {
      await route.fulfill({ json: { cards: [card("d", "Page D")], page: { nextCursor: null, limit: 50 } } });
      return;
    }
    await route.fulfill({ json: { cards: [], page: { nextCursor: null, limit: 50 } } });
  });

  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.goto(`/ad-radar?workspaceId=${encodeURIComponent(workspaceId!)}`);
  await expect(page.getByLabel("Search Ad Radar", { exact: true })).toBeVisible();
  await initialSettle;

  const input = page.getByLabel("Search Ad Radar", { exact: true });
  // Start a deliberately slow prior search, then supersede it. This proves
  // the panel abort/identity guard rather than hiding a stale-response race.
  await input.fill("Perth");
  await input.press("Enter");
  await delayedPerthStarted;
  await input.fill("homes");
  // The Search button is disabled while the prior request is in flight; submit
  // the real form to model the user superseding it without bypassing React.
  await page.locator("form").evaluate((form) => form.requestSubmit());
  await expect(cardLocator(page, "Page A")).toBeVisible();
  await expect(cardLocator(page, "Page B")).toBeVisible();
  // The delayed prior Perth response completes after homes. The newer search
  // remains authoritative and its cards must stay visible.
  await page.waitForTimeout(1_200);
  await expect(cardLocator(page, "Page A")).toBeVisible();
  await expect(cardLocator(page, "Page B")).toBeVisible();

  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ad Radar couldn\'t load these" })).toContainText("temporarily unavailable");
  await expect(cardLocator(page, "Page A")).toBeVisible();
  await expect(cardLocator(page, "Page B")).toBeVisible();

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(cardLocator(page, "Page C")).toBeVisible();
  expect(await cardCount(page, "Page B")).toBe(1);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);

  await input.fill("apartments");
  await input.press("Enter");
  await expect(cardLocator(page, "Page D")).toBeVisible();
  expect(await cardCount(page, "Page A")).toBe(0);
  await expect.poll(() => calls).toContainEqual({ q: "apartments", cursor: null });
  expect(calls).toEqual([
    { q: "Perth", cursor: null },
    { q: "homes", cursor: null },
    { q: "homes", cursor: "cursor-1" },
    { q: "homes", cursor: "cursor-1" },
    { q: "apartments", cursor: null },
  ]);
});
