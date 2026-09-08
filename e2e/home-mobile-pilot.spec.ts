import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE ??
  "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const canRun = Boolean(baseUrl && workspaceId && existsSync(storageState));

test.use({ storageState, serviceWorkers: "block", ignoreHTTPSErrors: controlledCanary, launchOptions: {
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
  args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
} });

test.describe("Home mobile pilot", () => {
  test.skip(!canRun, "Requires PLAYWRIGHT_BASE_URL, ADSTUDIO_E2E_WORKSPACE_ID, and the controlled fixture.");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", async (route) => {
      const method = route.request().method();
      if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Read-only UX acceptance: mutation blocked" }) });
    });
  });
  async function openHome(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toHaveCount(1);
    if (width < 768) await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
  }
  async function assertNoHorizontalOverflow(page: Page) {
    const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, main: document.querySelector("main")?.getBoundingClientRect() }));
    expect(result.scrollWidth, "Home must not overflow horizontally").toBeLessThanOrEqual(result.width + 1);
    expect(result.main).toBeTruthy();
  }
  async function assertFiveTabTargets(page: Page) {
    const nav = page.getByRole("navigation", { name: "Primary mobile navigation" });
    for (const label of ["Home", "Ads", "Results", "Leads", "More"]) {
      const target = label === "More" ? nav.getByRole("button", { name: label }) : nav.getByRole("link", { name: label, exact: true });
      await expect(target).toBeVisible();
    }
    const boxes = await nav.locator("a,button").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { height: r.height, left: r.left, right: r.right }; }));
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    for (const box of boxes) {
      expect(box.height, "mobile tab must be at least 44px tall").toBeGreaterThanOrEqual(44);
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
    }
  }
  async function assertAt200PercentZoom(page: Page) {
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  }
  test("keeps task-first Home, honest reporting, and the exact activation destination", async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openHome(page, 390, 844);
    const main = page.getByRole("main");
    const activation = main.locator('[aria-labelledby="activation-heading"]');
    await expect(activation).toBeVisible();
    const action = activation.getByRole("link").first();
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", /^(\/signup|\/onboarding|\/ad-studio(?:\/brand)?|\/settings#(?:connections|billing)|\/self-serve)$/);
    await expect(action).toHaveText(/Verify your email|Confirm your country|Add your business website|Review your Brand Pack|Choose an ad template|Create your first ad|Choose how to run your ad|Connect Meta|Finish setting up Meta|Add a payment method|Run your first ad|Confirming your subscription|Create an ad/);
    await expect(main.getByText(/Unavailable|Not issued|Reporting unavailable|Leads captured|Leads · 30 days/i).first()).toBeVisible();
    await assertFiveTabTargets(page);
    await assertNoHorizontalOverflow(page);
    await assertAt200PercentZoom(page);
    await page.screenshot({ path: testInfo.outputPath("home-mobile-390-dark.png"), fullPage: false });
    await page.screenshot({ path: testInfo.outputPath("home-mobile-390-dark-full.png"), fullPage: true });
  });
  for (const width of [320, 375, 390, 414, 768]) {
    test(`fits the flat Home layout at ${width}px`, async ({ page }, testInfo) => {
      await openHome(page, width, width <= 390 ? (width === 320 ? 667 : 844) : 900);
      await assertNoHorizontalOverflow(page);
      if (width < 768) await assertFiveTabTargets(page);
      await page.screenshot({ path: testInfo.outputPath(`home-mobile-${width}.png`), fullPage: true });
    });
  }
  test("keeps desktop compact and makes collapsed details keyboard accessible", async ({ page }, testInfo) => {
    await openHome(page, 1440, 900);
    await assertNoHorizontalOverflow(page);
    const details = page.locator("main details");
    await expect(details.first()).toBeVisible();
    const summary = details.first().locator("summary");
    await expect(summary).toBeVisible();
    await expect(details.first()).not.toHaveAttribute("open", "");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details.first()).toHaveAttribute("open", "");
    await page.screenshot({ path: testInfo.outputPath("home-desktop-expanded.png"), fullPage: true });
  });
});
