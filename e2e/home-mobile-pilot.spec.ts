import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const controlled = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.use({ storageState, serviceWorkers: "block", ignoreHTTPSErrors: controlled, launchOptions: {
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
  args: controlled ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
} });
test.describe("Creative Home", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL || !workspaceId || !existsSync(storageState), "Requires controlled workspace fixture");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", async route => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
      return route.fulfill({ status: 409, body: "Read-only acceptance: mutation blocked" });
    });
  });
  async function open(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toHaveCount(1);
    await expect(page.locator('[data-home-creative]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }
  async function bounds(page: Page) {
    const measurements = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return { width: innerWidth, document: document.documentElement.scrollWidth, main: main.scrollWidth, client: main.clientWidth };
    });
    expect(measurements.document).toBeLessThanOrEqual(measurements.width + 1);
    expect(measurements.main).toBeLessThanOrEqual(measurements.client + 1);
    const cta = page.locator('[data-home-primary]').first();
    await expect(cta).toBeVisible();
    const rect = await cta.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(rect!.width, "Home never uses a screen-wide action").toBeLessThan(measurements.client * .75);
  }
  for (const width of [320, 375, 390, 414, 768, 1440]) {
    test(`real creative preview and compact controls at ${width}px`, async ({ page }, info) => {
      await open(page, width, width === 320 ? 667 : width < 768 ? 844 : 900);
      const preview = page.locator('img[data-template-preview]');
      const safe = await page.evaluate(async () => (await fetch('/api/home-dashboard')).json());
      if (safe.creativeSuggestions?.status === 'ready') {
        await expect(preview).toBeVisible();
        await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      } else {
        await expect(preview).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Browse templates', exact: true }).first()).toBeVisible();
      }
      await expect(page.locator('[data-home-creative]')).not.toContainText(/AdStudio E2E Realty|Completed milestones|Workspace details|Next step|setup steps|Results|Tools/);
      await bounds(page);
      const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
      if (width < 768) {
        await expect(nav).toBeVisible();
        for (const control of await nav.locator('a, button').all()) {
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
        await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Switch to .* sidebar/ })).toHaveCount(0);
      }
      await page.screenshot({ path: info.outputPath(`home-creative-${width}.png`), fullPage: true });
    });
  }
  test('account details stay in the menu and 200 percent zoom does not clip', async ({ page }) => {
    await open(page, 390, 844);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  });
});
