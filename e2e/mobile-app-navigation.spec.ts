import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
const canRun = Boolean(baseUrl && storageState && existsSync(storageState));

test.use({
  storageState,
  serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});
test.skip(!canRun, "Set PLAYWRIGHT_BASE_URL and ADSTUDIO_E2E_STORAGE_STATE.");

async function consent(page: Page) {
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  const banner = page.getByRole("region", { name: "Cookie consent" });
  await expect(banner).toHaveCount(0);
}
async function blockWrites(page: Page) {
  await page.route("**/*", route => {
    const method = route.request().method();
    return ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? route.abort("blockedbyclient")
      : route.continue();
  });
}
async function expectNav(page: Page, active?: string) {
  const nav = page.getByRole("navigation", { name: "Primary mobile navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Ads", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Results", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Leads", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "More" })).toBeVisible();
  if (active) {
    await expect(nav.getByRole("link", { name: active, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
}
async function expectNoOverlap(page: Page) {
  const result = await page.evaluate(() => {
    const read = (element: Element | null) => { if (!element) return null; const rect=element.getBoundingClientRect(); return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height }; };
    return { nav: read(document.querySelector('[aria-label="Primary mobile navigation"]')), main: read(document.querySelector("main")), width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(result.nav).not.toBeNull();
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width + 1);
  expect(result.nav!.left).toBeGreaterThanOrEqual(0);
  expect(result.nav!.right).toBeLessThanOrEqual(result.width + 1);
  expect(result.nav!.height).toBeGreaterThanOrEqual(40);
  expect(result.nav!.bottom).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) + 1);
  const hitTargets = await page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("link").evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { label: element.textContent?.trim(), hit: Boolean(point && (point === element || element.contains(point))), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
  }));
  expect(hitTargets.every(target => target.hit), `every nav link must be hit-testable: ${JSON.stringify(hitTargets)}`).toBeTruthy();
}

test.describe("customer mobile navigation regression", () => {
  test("first-load consent does not cover the destination nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await blockWrites(page);
    await page.goto(`/self-serve`);
    const banner = page.getByRole("region", { name: "Cookie consent" }); await expect(banner).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Primary mobile navigation" }); await expect(nav).toBeVisible();
    const overlap = await banner.evaluate((element) => { const a=element.getBoundingClientRect(); const b=document.querySelector('[aria-label="Primary mobile navigation"]')!.getBoundingClientRect(); return a.bottom>b.top && a.top<b.bottom; });
    expect(overlap).toBeFalsy();
  });

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
    test(`keeps the destination bar usable and stable at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport); await consent(page); await blockWrites(page);
      await page.goto(`/self-serve`); await expectNav(page, "Home"); await expectNoOverlap(page); await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}-top.png`) });
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await expectNav(page, "Home"); await expectNoOverlap(page); await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}-scrolled.png`) });
      await page.goto(`/ad-studio`); await expectNav(page, "Ads"); await expectNoOverlap(page);
      await page.goto(`/results`); await expectNav(page, "Results");
      await page.goto(`/leads`); await expectNav(page, "Leads");
    });
  }

  test("keeps Studio navigation through the Ads subtree and template entry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await consent(page); await blockWrites(page);
    await page.goto(`/ad-studio`); await expectNav(page, "Ads");
    await page.getByRole("link", { name: /new ad/i }).first().click();
    await expect(page).toHaveURL(/\/ad-studio\/templates/); await expectNav(page);
    await expect(page.getByRole("heading", { name: "Choose a template" })).toBeVisible();
  });

  test("opens More as a focusable sheet and closes with Escape", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await consent(page); await blockWrites(page);
    await page.goto(`/self-serve`); const more = page.getByRole("button", { name: "More", includeHidden: true }); await more.click();
    const sheet = page.getByRole("dialog"); await expect(sheet).toBeVisible(); await expect(more).toHaveClass(/active/); await expect(page.getByRole("navigation", { name: "Primary mobile navigation", includeHidden: true }).locator('[aria-current="page"]')).toHaveCount(1); await expect(sheet.getByText("Settings", { exact: true })).toBeVisible();
    await expect(sheet).toContainText("Contact support"); await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden(); await expect(more).toBeFocused();
  });

  test("preserves unsaved account form data across the compact settings history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await consent(page); await blockWrites(page);
    await page.goto(`/settings`); await expectNav(page);
    const sections = page.locator('[aria-label="Settings sections"]');
    await sections.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page).toHaveURL(/#account$/);
    const preferredName = page.locator("#account-name"); await expect(preferredName).toBeVisible();
    const retainedName = "Mobile history check"; await preferredName.fill(retainedName);
    await page.getByRole("button", { name: "All settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack(); await expect(page).toHaveURL(/#account$/); await expect(preferredName).toHaveValue(retainedName);
    await page.goForward(); await expect(page).toHaveURL(/\/settings$/);
    const duplicateIds = await page.locator("[id]").evaluateAll(elements => { const ids = elements.map(el => el.id); return ids.filter((id, i) => ids.indexOf(id) !== i); });
    expect(duplicateIds).toEqual([]);
  });

  test("keeps editor tools and header within the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await consent(page); await blockWrites(page);
    await page.goto(`/ad-studio/ads/d6703a91-9fcf-4342-8d01-a4de1dc6d68a`);
    await expectNav(page); await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    const tools = page.getByRole("navigation", { name: "Editor tools" }).getByRole("button"); await expect(tools).toHaveCount(5);
    for (const label of ["Media", "Content", "Appearance", "Layers", "Preview"]) await expect(tools.filter({ hasText: label })).toHaveCount(1);
    await expectNoOverlap(page);
    const headerIntersections = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('[aria-label="Ad Studio editor"] header button, [aria-label="Ad Studio editor"] header input, [aria-label="Ad Studio editor"] header select')].filter((element) => { const style = getComputedStyle(element); return style.display !== "none" && style.visibility !== "hidden"; }).map(element => ({ label: element.getAttribute("aria-label") || element.textContent?.trim(), rect: element.getBoundingClientRect() }));
      return controls.flatMap((control, index) => controls.slice(index + 1).map(other => ({ labels: [control.label, other.label], overlap: Math.min(control.rect.right, other.rect.right) - Math.max(control.rect.left, other.rect.left) > 1 && Math.min(control.rect.bottom, other.rect.bottom) - Math.max(control.rect.top, other.rect.top) > 1 })));
    });
    expect(headerIntersections.filter(item => item.overlap), JSON.stringify(headerIntersections)).toEqual([]);
  });

  test("protects a dirty editor from an internal destination change", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await consent(page); await blockWrites(page);
    await page.goto(`/ad-studio/ads/d6703a91-9fcf-4342-8d01-a4de1dc6d68a`);
    await page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: "Content", exact: true }).click();
    const contentSheet = page.getByRole("dialog"); const textInput = contentSheet.locator('input[id^="creative-"]').first(); await expect(textInput).toBeVisible(); await textInput.fill("Unsaved mobile check");
    await page.keyboard.press("Escape"); await expect(contentSheet).toBeHidden();
    const original = page.url(); let asked = 0;
    page.once("dialog", async dialog => { asked += 1; await dialog.dismiss(); });
    await page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("link", { name: "Results", exact: true }).click();
    await expect(page).toHaveURL(original); expect(asked).toBe(1);
    page.once("dialog", async dialog => { asked += 1; await dialog.accept(); });
    await page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("link", { name: "Results", exact: true }).click();
    await expect(page).toHaveURL(/\/results/); expect(asked).toBe(2);
  });

  test("keeps the desktop shell available", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await consent(page); await blockWrites(page);
    await page.goto(`/ad-studio`); await expect(page.getByRole("heading", { name: "Ads", exact: true })).toBeVisible();
    await expect(page.getByLabel("Studio destinations").getByRole("link", { name: "Templates", exact: true })).toBeVisible();
  });
});
