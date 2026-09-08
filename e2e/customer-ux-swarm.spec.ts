import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const state = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const canary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.use({
  storageState: state,
  serviceWorkers: "block",
  ignoreHTTPSErrors: canary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: canary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});

test.describe("simple customer app acceptance", () => {
  test.setTimeout(120_000);
  test.skip(!process.env.PLAYWRIGHT_BASE_URL || !state || !existsSync(state), "Requires controlled authenticated fixture");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
      ? route.continue()
      : route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Read-only acceptance"}' }));
  });

  for (const width of [320, 375, 390, 414, 768, 1440]) {
    test(`key app screens fit at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
      for (const route of ["/ad-studio", "/ad-studio/templates", "/ad-studio/library?view=assets", "/ad-studio/library?view=ads", "/ad-studio/brand", "/results", "/results?example=1", "/leads", "/settings", "/connect-meta"]) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.getByRole("main")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const fit = await page.evaluate(() => {
          const root = document.documentElement;
          const main = document.querySelector("main")!;
          const bounds = main.getBoundingClientRect();
          const overflow: string[] = [];
          for (const el of main.querySelectorAll("button,input,select,textarea,h1,h2")) {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
            let intentional = false;
            for (let parent = el.parentElement; parent && parent !== main; parent = parent.parentElement) {
              if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) intentional = true;
            }
            if (!intentional && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) overflow.push((el.textContent || el.tagName).trim().slice(0, 70));
          }
          return { rootOverflow: root.scrollWidth > root.clientWidth + 1, overflow };
        });
        expect(fit, route).toEqual({ rootOverflow: false, overflow: [] });
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: testInfo.outputPath(`${route.replace(/[^a-z0-9]/gi, "-")}-${width}.png`), fullPage: true });
        }
      }
    });
  }

  for (const width of [390, 1440]) {
    test(`settings reveal one category and preserve navigation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings");
      await expect(page.locator("[data-settings-section]:visible")).toHaveCount(0);
      await page.goto("/settings#notifications");
      await expect(page.locator('[data-settings-section="notifications"]')).toBeVisible();
      await expect(page.locator("[data-settings-section]:visible")).toHaveCount(1);
      await page.getByRole("button", { name: "All settings", exact: true }).filter({ visible: true }).click();
      await expect(page.locator("[data-settings-section]:visible")).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('[data-settings-section="notifications"]')).toBeVisible();
    });
  }
});
