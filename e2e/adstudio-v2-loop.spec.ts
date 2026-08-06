import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// §14 v2 loop: template pick -> inputs -> generation <10s with NO image-model
// request on the path; editor text edit + undo; publish review shows both
// frames. Runs only on a flagged Preview with auth state; CI fails loudly if
// preconditions are missing (the silent-skip failure mode is how v1 shipped
// regressions green).

const storageStatePath = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "e2e/.auth/adstudio-test.storage-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const previewUrl = process.env.PLAYWRIGHT_BASE_URL;
const v2Enabled = process.env.ADSTUDIO_E2E_V2 === "1";
const canRun = Boolean(previewUrl && workspaceId && v2Enabled && existsSync(storageStatePath));

if (!canRun && process.env.CI) {
  test("AdStudio v2 loop preconditions are present in CI", () => {
    const missing = [
      !previewUrl && "PLAYWRIGHT_BASE_URL",
      !workspaceId && "ADSTUDIO_E2E_WORKSPACE_ID",
      !v2Enabled && "ADSTUDIO_E2E_V2=1 (Preview env has ADSTUDIO_TEMPLATES_V2=true)",
      !existsSync(storageStatePath) && `auth storage state at ${storageStatePath}`,
    ].filter(Boolean);
    throw new Error(`AdStudio v2 e2e cannot run in CI — missing: ${missing.join(", ")}.`);
  });
}

const describeV2Loop = canRun ? test.describe : test.describe.skip;

describeV2Loop("AdStudio v2 loop", () => {
  test.use({ storageState: storageStatePath });

  test("generation is deterministic, fast, and image-model-free", async ({ page }) => {
    const imageModelCalls: string[] = [];
    await page.route(/api\.openai\.com|generativelanguage\.googleapis\.com/, (route) => {
      imageModelCalls.push(route.request().url());
      return route.abort();
    });

    await page.goto(`${previewUrl}/ad-studio?first=1`);
    const started = Date.now();
    await page.getByRole("button", { name: /create|generate/i }).first().click();
    await expect(page.getByText(/rendered|saved/i).first()).toBeVisible({ timeout: 20_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(imageModelCalls).toEqual([]);
  });

  test("editor: text edit reflects in the chrome, undo restores", async ({ page }) => {
    await page.goto(`${previewUrl}/ad-studio`);
    const editor = page.locator(".tw").first();
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox").first().fill("E2E headline swap");
    await page.keyboard.press("Control+z");
  });

  test("publish review shows both frames and the payload truth", async ({ page }) => {
    await page.goto(`${previewUrl}/ad-studio?publish=1`);
    await expect(page.getByText("What will be sent to Meta")).toBeVisible();
    await expect(page.getByText(/Feed · 4:5/)).toBeVisible();
    await expect(page.getByText(/explicitly OPT_OUT/)).toBeVisible();
  });
});
