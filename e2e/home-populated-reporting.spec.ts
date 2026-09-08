import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const controlled = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.skip(!process.env.PLAYWRIGHT_BASE_URL || !workspaceId || !existsSync(storageState), "Requires controlled fixture");
test.use({ storageState, serviceWorkers: "block", ignoreHTTPSErrors: controlled, launchOptions: {
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
  args: controlled ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
} });
test("populated Home retains full values and fits large metrics at 320px", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.route("**/*", async route => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
    return route.fulfill({ status: 409, body: "Read-only acceptance: mutation blocked" });
  });
  // Only this browser's read-model response is synthetic; no workspace data changes.
  await page.route("**/api/home-dashboard", async route => route.fulfill({ status: 200, json: {
    performance: { leads: 127, cpl: 1234.56, previousLeads: 100, previousCpl: 1000, daily: [], lastSyncedAt: "2026-09-08T00:00:00.000Z" },
    ads: { created: 123456, live: 98765, publishedThisWeek: 123 },
  } }));
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
  const metrics = page.locator('main p[title]');
  await expect(metrics).toHaveCount(3);
  await expect(page.locator('p[aria-label="Leads · 30 days: 127"]')).toHaveText("127");
  await expect(page.locator('p[aria-label="Cost per lead: $1234.56"]')).toHaveText("$1.2K");
  await expect(page.locator('p[aria-label="Ads live: 98765"]')).toHaveText("98.8K");
  await page.evaluate(() => document.fonts.ready);
  const boxes = await metrics.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { text: element.textContent, x: rect.x, y: rect.y, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  }));
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  }
  expect(Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y))).toBeLessThan(20);
  const styles = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const header = main.querySelector('header')!;
    const account = header.querySelector('[aria-label="Account"]')!;
    const cta = document.querySelector('[aria-labelledby="activation-heading"] a')!;
    return { background: getComputedStyle(main).backgroundColor, headerHeight: header.getBoundingClientRect().height, accountHeight: account.getBoundingClientRect().height, ctaHeight: cta.getBoundingClientRect().height, ctaRadius: getComputedStyle(cta).borderRadius, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(styles.background).toBe("rgb(255, 255, 255)");
  expect(styles.headerHeight).toBeGreaterThanOrEqual(56);
  expect(styles.accountHeight).toBeGreaterThanOrEqual(44);
  expect(styles.ctaHeight).toBeGreaterThanOrEqual(48);
  expect(styles.ctaRadius).toBe("10px");
  expect(styles.scrollWidth).toBeLessThanOrEqual(320);
  console.log("Home computed styles", JSON.stringify({ styles, boxes }));
  await page.screenshot({ path: testInfo.outputPath("home-populated-320.png"), fullPage: true });
});
