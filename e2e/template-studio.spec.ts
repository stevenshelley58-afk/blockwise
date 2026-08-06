import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// §14 Template Studio spec (operator): queue lists drafts, the [id] screen
// mounts the studio editor, and approve stays human-gated. Operator surface,
// so it uses operator auth state and a dev/preview base URL.

const storageStatePath = process.env.OPERATOR_E2E_STORAGE_STATE ?? "e2e/.auth/operator.storage-state.json";
const previewUrl = process.env.PLAYWRIGHT_BASE_URL;
const canRun = Boolean(previewUrl && existsSync(storageStatePath));

const describeStudio = canRun ? test.describe : test.describe.skip;

describeStudio("Template Studio", () => {
  test.use({ storageState: storageStatePath });

  test("queue lists v2 templates with status and residual summary", async ({ page }) => {
    await page.goto(`${previewUrl}/operator/template-studio`);
    await expect(page.getByRole("heading", { name: "Template Studio" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^meta-/ }).first()).toBeVisible();
  });

  test("draft screen mounts the studio editor and gates approve on the checkbox", async ({ page }) => {
    await page.goto(`${previewUrl}/operator/template-studio`);
    await page.getByRole("link", { name: /^meta-/ }).first().click();
    await expect(page.getByRole("button", { name: "Run check" })).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve template" });
    await expect(approve).toBeDisabled();
    await page.getByText("Inspected at 100% zoom; a designer would ship this.").click();
    await expect(approve).toBeEnabled();
  });
});
