import { existsSync, mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

// Real screenshots of the lead work application against a running build.
// Every request is read-only: the route guard below refuses any non-GET
// request so this review can never move a stage, complete a task or record an
// outcome in a workspace that holds live enquiries.
const runDir = process.env.LEADS_E2E_RUN_DIR ?? "/srv/blockwise/e2e-runs/leads-workspace-20260908";
const storageState =
  process.env.ADSTUDIO_E2E_STORAGE_STATE?.trim() || `${runDir}/browser-state.json`;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;

test.use({
  storageState,
  ignoreHTTPSErrors: true,
  launchOptions: { executablePath: process.env.ADSTUDIO_E2E_CHROMIUM || undefined },
});

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const enquiryRows = (page: Page) => page.getByRole("button", { name: /^Open / });
const detailPanel = (page: Page) => page.getByRole("region", { name: "Enquiry detail" });

async function gotoLeads(page: Page) {
  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("tablist")).toBeVisible();
}

async function settled(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function noHorizontalOverflow(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `no horizontal clipping at ${width}px`).toBeLessThanOrEqual(width + 1);
}

test.describe("Lead workspace review", () => {
  test.skip(
    !baseUrl || !existsSync(storageState),
    "Requires PLAYWRIGHT_BASE_URL and the stored login state from e2e/leads-workspace-login.mjs",
  );

  test.beforeAll(() => {
    mkdirSync(runDir, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
    await page.route("**/*", async (route) => {
      if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
      return route.fulfill({ status: 409, body: "Read-only acceptance: mutation blocked" });
    });
  });

  test("desktop needs action", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoLeads(page);
    await expect(page.getByRole("tab", { name: "Needs action" })).toBeVisible();
    for (const view of ["All leads", "Pipeline", "Tasks"]) {
      await expect(page.getByRole("tab", { name: view })).toBeVisible();
    }
    // The lead workspace never offers a customer Inbox or Email flows surface.
    await expect(page.getByRole("link", { name: /Inbox|Email flows/i })).toHaveCount(0);
    await settled(page);
    const rows = await enquiryRows(page).count();
    if (rows > 0) {
      const box = await enquiryRows(page).first().boundingBox();
      expect(box!.height, "rows are reachable pointer targets").toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${runDir}/leads-desktop-needs-action.png`, fullPage: true });
  });

  test("desktop detail panel keeps the list and a shareable URL", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoLeads(page);
    await settled(page);
    test.skip((await enquiryRows(page).count()) === 0, "No enquiries in this workspace to open");
    await enquiryRows(page).first().click();
    await expect(detailPanel(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]lead=/);
    // The work list stays available beside the panel at desktop width.
    await expect(page.getByRole("tablist")).toBeVisible();
    for (const action of ["Email lead", "Log contact", "Log reply", "Add task", "Record outcome"]) {
      await expect(detailPanel(page).getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    await settled(page);
    await page.screenshot({ path: `${runDir}/leads-desktop-detail.png` });
  });

  test("desktop email draft opens the agent's own mail app and claims nothing", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoLeads(page);
    await settled(page);
    test.skip((await enquiryRows(page).count()) === 0, "No enquiries in this workspace to open");
    await enquiryRows(page).first().click();
    await expect(detailPanel(page)).toBeVisible();
    await detailPanel(page).getByRole("button", { name: "Email lead", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Email from your own mail app");
    await expect(dialog).toContainText("Blockwise does not send, track or log this email.");
    await expect(dialog).toContainText("does not mark the enquiry contacted");
    await expect(dialog.getByRole("button", { name: "Copy email address", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Copy message", exact: true })).toBeVisible();
    await page.screenshot({ path: `${runDir}/leads-desktop-email-draft.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("desktop pipeline offers a non-drag stage control", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoLeads(page);
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await settled(page);
    const moveControls = page.getByRole("button", { name: /Move to/ });
    if ((await moveControls.count()) > 0) {
      await expect(moveControls.first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Show as list" })).toBeVisible();
    await page.screenshot({ path: `${runDir}/leads-desktop-pipeline.png`, fullPage: true });
  });

  test("desktop tasks view", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoLeads(page);
    await page.getByRole("tab", { name: "Tasks" }).click();
    await settled(page);
    await page.screenshot({ path: `${runDir}/leads-desktop-tasks.png`, fullPage: true });
  });

  test("mobile list at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoLeads(page);
    await settled(page);
    await noHorizontalOverflow(page, MOBILE.width);
    await page.screenshot({ path: `${runDir}/leads-mobile-list.png`, fullPage: true });
  });

  test("mobile detail at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoLeads(page);
    await settled(page);
    test.skip((await enquiryRows(page).count()) === 0, "No enquiries in this workspace to open");
    await enquiryRows(page).first().click();
    await expect(detailPanel(page)).toBeVisible();
    await settled(page);
    await noHorizontalOverflow(page, MOBILE.width);
    for (const action of ["Email lead", "Log contact", "Log reply"]) {
      const control = detailPanel(page).getByRole("button", { name: action, exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.height, `${action} stays reachable on a phone`).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${runDir}/leads-mobile-detail.png`, fullPage: true });
  });
});
