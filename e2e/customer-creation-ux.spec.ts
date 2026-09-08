import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const adId = process.env.ADSTUDIO_E2E_AD_ID ?? "d6703a91-9fcf-4348-8d01-a4de1dc6d68a";
const templateId = process.env.ADSTUDIO_E2E_TEMPLATE_ID;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const canRun = Boolean(baseUrl && existsSync(storageState));

test.use({
  storageState,
  serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});

test.describe.configure({ mode: "serial" });
test.describe("customer creation UX acceptance", () => {
  test.setTimeout(120_000);
  test.skip(!canRun, "Requires controlled canary URL and authenticated fixture");

  let mutations: string[] = [];
  test.beforeEach(async ({ page }) => {
    mutations = [];
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", async route => {
      const method = route.request().method();
      if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
      mutations.push(method + " " + route.request().url());
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Read-only creation UX acceptance: mutation blocked" }) });
    });
  });

  for (const width of [320, 390, 1440]) {
    test("Brand Pack leads with preview and keeps colour overlay in bounds at " + width + "px", async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.goto("/ad-studio/brand");
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole("main")).toBeVisible();

      const preview = page.getByRole("heading", { name: "Live creative preview", exact: true });
      const website = page.getByLabel("Your website address", { exact: true });
      await expect(preview).toBeVisible();
      await expect(website).toBeVisible();
      const hierarchy = await page.evaluate(() => {
        const preview = Array.from(document.querySelectorAll("h2")).find(node => node.textContent?.includes("Live creative preview"));
        const website = document.getElementById("brand-website");
        return {
          previewTop: preview?.getBoundingClientRect().top ?? Infinity,
          websiteTop: website?.getBoundingClientRect().top ?? -Infinity,
          rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      expect(hierarchy.previewTop, "preview should precede the source form").toBeLessThanOrEqual(hierarchy.websiteTop);
      expect(hierarchy.rootOverflow, "Brand Pack should not create horizontal page overflow").toBe(false);

      const swatch = page.getByRole("button", { name: "Edit Primary colour", exact: true });
      await swatch.click();
      const overlay = page.locator("[data-radix-popper-content-wrapper]:visible").last();
      await expect(overlay).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("brand-overlay-" + width + ".png"), fullPage: false });
      const bounds = await overlay.boundingBox();
      expect(bounds, "colour picker should have a measurable overlay").not.toBeNull();
      const viewport = page.viewportSize()!;
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.keyboard.press("Escape");
      await expect(overlay).toBeHidden();
      await expect(swatch).toBeFocused();
      expect(mutations).toEqual([]);
    });
  }

  test("editor exposes focused mobile controls and truthful readiness without saving", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ad-studio/ads/" + encodeURIComponent(adId));
    await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();
    for (const tab of ["Photos", "Content", "Style"]) {
      const control = page.getByRole("button", { name: tab, exact: true });
      await expect(control).toBeVisible();
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByRole("button", { name: "Review & publish", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Ready to review|required .* left/ }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("editor-controls.png"), fullPage: false });
    expect(mutations).toEqual([]);
  });

  test("publish stages forward and back without losing local values", async ({ page }, testInfo) => {
    test.skip(!templateId, "Requires ADSTUDIO_E2E_TEMPLATE_ID for publish acceptance");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ad-studio/templates/" + encodeURIComponent(templateId!) + "/publish?adId=" + encodeURIComponent(adId));
    await expect(page.getByRole("heading", { name: "1. Creative & copy", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download both formats", exact: true })).toBeVisible();
    await expect(page.locator("#publish-stage-2")).toBeHidden();

    await page.getByRole("button", { name: "2. Destination & form", exact: true }).click();
    await expect(page.getByRole("heading", { name: "2. Destination & form", exact: true })).toBeVisible();
    const destination = page.locator("#publish-destination-url");
    await expect(destination).toBeVisible();
    const marker = "https://example.test/creation-ux";
    await destination.fill(marker);

    await page.getByRole("button", { name: "3. Audience & spend", exact: true }).click();
    await expect(page.getByRole("heading", { name: "3. Audience, budget & schedule", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("publish-stage-3.png"), fullPage: false });
    await page.getByRole("button", { name: "2. Destination & form", exact: true }).click();
    await expect(destination).toHaveValue(marker);
    await page.getByRole("button", { name: "1. Creative & copy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "1. Creative & copy", exact: true })).toBeVisible();
    await expect(page.locator("#publish-stage-2")).toBeHidden();
    expect(mutations).toEqual([]);
  });
});

