import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const canRun = Boolean(process.env.PLAYWRIGHT_BASE_URL && storageState && existsSync(storageState));

test.use({
  storageState,
  serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});

test.describe("customer UX flows", () => {
  test.setTimeout(120_000);
  test.skip(!canRun, "Requires controlled authenticated fixture and PLAYWRIGHT_BASE_URL");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        return route.continue();
      }
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Read-only UX acceptance: mutation blocked" }),
      });
    });
  });

  test("settings shows the category index, then one focused group with return focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(0);

    await page.getByRole("link", { name: "Notifications", exact: true }).click();
    await expect(page.locator('[data-settings-section="notifications"]:visible')).toBeVisible();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(1);
    await expect.poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-settings-section")),
    ).toBe("notifications");

    await page.locator('button:visible', { hasText: "All settings" }).click();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(0);
    await expect(page.locator('a[href="#notifications"]:visible')).toBeFocused();
    await page.goBack();
    await expect(page.locator('[data-settings-section="notifications"]:visible')).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-settings-section")),
    ).toBe("notifications");
  });

  test("settings query deep link remains focused and category navigation works on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings?section=billing");
    await expect(page.locator('[data-settings-section="billing"]:visible')).toBeVisible();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(1);
    await expect.poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-settings-section")),
    ).toBe("billing");

    await page.locator('button:visible', { hasText: "All settings" }).click();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Billing & plan", exact: true })).toBeVisible();
  });

  test("results opens the example report when nothing is connected, and its controls drive the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // No Meta connection: Performance goes straight to the labelled example
    // report, keeping Connect Meta in reach instead of a connect interstitial.
    await page.goto("/results");
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    await expect(page.getByText("Example report", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect Meta", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Setup guide", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);
    // The page leads with the figures, not with a per-listing summary.
    await expect(page.getByText("Lead results", { exact: true })).toHaveCount(0);

    // The chart metric is a menu, and the range beside it replaces the old
    // metric chips: both drive the same example payload.
    const metric = page.getByLabel("Chart metric");
    const range = page.getByLabel("Date range");
    await expect(metric).toHaveText(/Enquiries over time/);
    await expect(range).toHaveText(/30 days/);
    await metric.click();
    // Every metric with a daily series is offered, most important first.
    await expect(page.getByRole("option")).toHaveText([
      "Enquiries over time",
      "Valid leads over time",
      "Cost per lead over time",
      "Spend over time",
      "Reach over time",
      "Impressions over time",
      "Link clicks over time",
      "Cost per link click over time",
      "Click-through rate over time",
      "Valid lead rate over time",
    ]);
    await page.getByRole("option", { name: "Click-through rate over time" }).click();
    await expect(metric).toHaveText(/Click-through rate over time/);
    await expect(page.getByText("Days with no impressions show no click-through rate.")).toBeVisible();
    await range.click();
    await page.getByRole("option", { name: "7 days" }).click();
    await expect(range).toHaveText(/7 days/);
    // The comparison names the new period (the card keeps that phrase off the
    // phone layout, so its presence is what is asserted) and the figures follow.
    await expect(page.getByText(/vs previous 7 days/).first()).toBeAttached();
    await expect(page.getByText("$5,940", { exact: true })).toHaveCount(0);

    // Pacing and location moved inside the details card, which stays shut until
    // asked for; the campaign table and the ad cards open with the page.
    await expect(page.getByText("Open pacing and location details", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Valid leads by suburb", { exact: true })).toBeHidden();
    await page.getByText("More reporting details", { exact: true }).click();
    await expect(page.getByText("Valid leads by suburb", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lover (Image)", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Carlingford lead source", exact: true }).first(),
    ).toBeVisible();
  });

  test("Meta sharing stays a short checklist on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/connect-meta");
    // Either the checklist or, for a workspace that already confirmed, the
    // status card. No intro screen and no asset IDs on either.
    const confirm = page.getByRole("button", { name: "Confirm my sharing", exact: true });
    if (await confirm.isVisible().catch(() => false)) {
      await expect(page.getByRole("heading", { name: "Share your Meta assets", exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await expect(page.getByRole("checkbox", { name: /I have assigned my Page, ad account and permissions/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /Open the full walkthrough/i })).toHaveAttribute("href", "/help");
      await expect(page.locator("#meta-ad-account-id")).toHaveCount(0);
      return;
    }
    await expect(page.getByRole("heading", { name: /checking your Meta sharing|Meta access is ready|change is needed in Meta/i })).toBeVisible();
  });
});

