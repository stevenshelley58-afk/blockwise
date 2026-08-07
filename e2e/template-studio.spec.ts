import { expect, test } from "@playwright/test";

// §14 Template Studio spec: operator opens a draft, picks a font, runs the
// fidelity check, sees residuals, and the approve gate stays human-only
// (disabled until the 100%-zoom confirmation checkbox).

const devPassword = process.env.BLOCKWISE_DEV_PASSWORD;
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;

test.beforeEach(async ({ page }) => {
  test.skip(!devPassword || !baseUrl, "Set BLOCKWISE_DEV_PASSWORD and PLAYWRIGHT_BASE_URL to run Studio e2e.");
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill("operator@blockwise.test");
  await page.getByLabel("Password").fill(devPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/operator$/);
});

test("queue lists v2 drafts with status and intent", async ({ page }) => {
  await page.goto(`${baseUrl}/operator/template-studio`);
  await expect(page.getByRole("heading", { name: "Template Studio" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^meta-/ }).first()).toBeVisible();
});

test("draft screen: font picker, run check, human-only approve", async ({ page }) => {
  await page.goto(`${baseUrl}/operator/template-studio`);
  await page.getByRole("link", { name: /^meta-/ }).first().click();

  // Studio surface: font picker + bake lever present.
  await expect(page.getByText("Font picker (Studio)")).toBeVisible();
  await expect(page.getByText("Bake / un-bake")).toBeVisible();

  // Run the fidelity check.
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText("Fidelity report (source values vs source ad)")).toBeVisible();

  // Approve is human-only: disabled until the confirmation checkbox.
  const approve = page.getByRole("button", { name: "Approve template" });
  await expect(approve).toBeDisabled();
  await page.getByText("Inspected at 100% zoom; a designer would ship this.").click();
  await expect(approve).toBeEnabled();
});
