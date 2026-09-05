import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const canRun = Boolean(baseUrl && workspaceId && storageState && existsSync(storageState));

test.use({
  storageState,
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: controlledCanary ? {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"],
  } : undefined,
});

/** Wait for fonts, hydration, entrance and count-up animations to settle. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // KPI count-up runs 0.9s; entrance springs finish inside that window.
  await page.waitForTimeout(1200);
}

/** Dismiss the cookie banner so screenshots and hit-testing are unobstructed. */
async function dismissCookieConsent(page: Page) {
  const banner = page.getByRole("region", { name: "Cookie consent" });
  if (await banner.isVisible().catch(() => false)) {
    await banner.getByRole("button", { name: "Essential only" }).click();
  }
  await expect(banner).toHaveCount(0);
}

/**
 * Real clipping check: <main> has `overflow-x: clip`, so
 * documentElement.scrollWidth stays correct while content is visibly
 * cropped. Assert main's own scroll box AND every visible card/control
 * rectangle stay inside main's box.
 */
async function assertNothingClipped(page: Page) {
  const result = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const mainRect = main.getBoundingClientRect();
    const offenders: string[] = [];
    for (const el of main.querySelectorAll("a, button, input, select, section, h1, h2, table, svg[role], p, span")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (rect.right > mainRect.right + 0.5 || rect.left < mainRect.left - 0.5) {
        offenders.push(`${el.tagName.toLowerCase()}:${String(el.className).slice(0, 60)}`);
      }
    }
    return {
      mainScrollWidth: main.scrollWidth,
      mainClientWidth: main.clientWidth,
      offenders: offenders.slice(0, 8),
    };
  });
  expect(result, "main element must exist").not.toBeNull();
  expect(
    result!.mainScrollWidth,
    "main.scrollWidth must not exceed main.clientWidth (clipped overflow)",
  ).toBeLessThanOrEqual(result!.mainClientWidth);
  expect(result!.offenders, "visible content must fit without clipping").toEqual([]);
}

/** The fixed bottom tab bar must be visible, inside the viewport, and tappable. */
async function assertMobileNavUsable(page: Page) {
  const nav = page.getByRole("navigation", { name: "Primary mobile navigation" });
  await expect(nav).toBeVisible();
  const items = nav.getByRole("link");
  expect(await items.count()).toBeGreaterThanOrEqual(4);
  const boxes = await items.evaluateAll((elements) =>
    elements.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        height: rect.height,
        viewportWidth: window.innerWidth,
      };
    }),
  );
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(-0.5);
    expect(box.right).toBeLessThanOrEqual(box.viewportWidth + 0.5);
    expect(box.height, "nav item must keep a usable tap height").toBeGreaterThanOrEqual(40);
  }
  await expect(nav.getByRole("button", { name: "More" })).toBeVisible();
}

test.describe("customer navigation canary", () => {
  test.skip(!canRun, "Set PLAYWRIGHT_BASE_URL and ADSTUDIO_E2E_WORKSPACE_ID; the controlled auth fixture must exist.");

  test("keeps one active destination, hides disabled tools, and supports the command shortcut", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    await dismissCookieConsent(page);
    await expect(page.getByRole("link", { name: "Ad Radar" })).toHaveCount(0);
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Go to");
    await page.keyboard.press("Escape");
    await settle(page);
    await assertNothingClipped(page);
    await page.screenshot({ path: testInfo.outputPath("customer-home-desktop.png"), fullPage: true });
    await page.goto(`/ad-studio/brand?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(1);
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(1);
    await dismissCookieConsent(page);
    await settle(page);
    await assertNothingClipped(page);
    await page.screenshot({ path: testInfo.outputPath("customer-settings-desktop.png"), fullPage: true });
  });

  for (const width of [320, 390]) {
    test(`fits Home and Settings without clipping at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
      await expect(page).not.toHaveURL(/\/login/);
      await dismissCookieConsent(page);
      await settle(page);
      await assertNothingClipped(page);
      await assertMobileNavUsable(page);
      await page.screenshot({ path: testInfo.outputPath(`customer-home-${width}.png`), fullPage: true });
      await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
      await dismissCookieConsent(page);
      await settle(page);
      await assertNothingClipped(page);
      await page.screenshot({ path: testInfo.outputPath(`customer-settings-${width}.png`), fullPage: true });
    });
  }

  test("keeps workspace name saves recoverable", async ({ page }) => {
    await page.route("**/rest/v1/workspaces**", async (route) => {
      if (route.request().method() === "PATCH") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "offline" }) });
      return route.continue();
    });
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    const workspaceSection = page.locator("#workspace");
    const name = workspaceSection.getByLabel("Workspace name");
    await name.fill("Canary workspace");
    await workspaceSection.getByRole("button", { name: "Save workspace" }).click();
    await expect(workspaceSection.getByText(/Couldn't save workspace settings.|try again/i)).toBeVisible();
    await expect(workspaceSection.getByRole("button", { name: "Save workspace" })).toBeEnabled();
    await expect(name).toHaveValue("Canary workspace");

    await page.unroute("**/rest/v1/workspaces**");
    await page.route("**/rest/v1/workspaces**", async (route) => {
      if (route.request().method() === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: workspaceId }]) });
      return route.continue();
    });
    await workspaceSection.getByRole("button", { name: "Save workspace" }).click();
    await expect(workspaceSection.getByText("Workspace settings saved.")).toBeVisible();
    await expect(workspaceSection.getByRole("button", { name: "Save workspace" })).toBeEnabled();
  });

  test("reports a country partial-save failure honestly", async ({ page }) => {
    await page.route("**/rest/v1/workspaces**", async (route) => {
      if (route.request().method() === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: workspaceId }]) });
      return route.continue();
    });
    await page.route("**/api/workspace/onboarding-market", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Country service unavailable" }) }));
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    const workspaceSection = page.locator("#workspace");
    const country = workspaceSection.getByLabel("Country");
    test.skip(await country.isDisabled(), "The controlled fixture has a market-bound country; use the isolated non-market-bound fixture for this case.");
    const currentCountry = await country.inputValue();
    await country.selectOption(currentCountry === "AU" ? "US" : "AU");
    await workspaceSection.getByRole("button", { name: "Save workspace" }).click();
    await expect(workspaceSection.getByText(/Workspace name saved, but country was not changed|Country service unavailable/)).toBeVisible();
    await expect(workspaceSection.getByRole("button", { name: "Save workspace" })).toBeEnabled();
  });
});
