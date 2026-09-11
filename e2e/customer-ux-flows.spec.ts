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

  test("results disconnected state offers an explicit example, switchable chart, and deliberate details", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/results");
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    await expect(page.getByText("Your reporting snapshot is being prepared.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(1);

    await page.goto("/results?example=1");
    await expect(page.locator("span").filter({ hasText: /^Example report$/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /date range/i })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Results chart" })).toBeVisible();
    const leads = page.getByRole("button", { name: "Leads", exact: true });
    await leads.click();
    await expect(leads).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("More reporting details", { exact: true })).toBeVisible();
    await expect(page.getByText("Open pacing and location details", { exact: true })).toBeVisible();
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

