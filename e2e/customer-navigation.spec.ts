import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const canRun = Boolean(baseUrl && workspaceId && storageState && existsSync(storageState));

test.describe("customer navigation canary", () => {
  test.skip(!canRun, "Set PLAYWRIGHT_BASE_URL and ADSTUDIO_E2E_WORKSPACE_ID; the controlled auth fixture must exist.");
  test.use({
    storageState,
    ignoreHTTPSErrors: controlledCanary,
    launchOptions: controlledCanary ? {
      executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
      args: ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"],
    } : undefined,
  });

  test("keeps one active destination, hides disabled tools, and supports the command shortcut", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("link", { name: "Ad Radar" })).toHaveCount(0);
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Go to");
    await page.goto(`/ad-studio/brand?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(1);
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("customer-desktop.png"), fullPage: true });
  });

  test("works at 320px without horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("customer-mobile-320-after.png"), fullPage: true });
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("works at 390px without horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/self-serve?workspaceId=${encodeURIComponent(workspaceId!)}`);
    await expect(page).not.toHaveURL(/\/login/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("customer-mobile-390-after.png"), fullPage: true });
    await page.goto(`/settings?workspaceId=${encodeURIComponent(workspaceId!)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

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
