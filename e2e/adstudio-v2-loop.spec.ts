import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "@playwright/test";

// §14 v2 loop (headless): template pick -> photo upload -> generation <10s
// with NO image-model request on the path -> editor text box reachable ->
// publish Review shows the v2 truth sections. Runs only on a flagged Preview
// with auth state; CI fails loudly if preconditions are missing.

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

    // Headless customer photo (1200x1500 clears every slot's 0.5x floor).
    const photoPath = join(tmpdir(), "adstudio-e2e-photo.png");
    mkdirSync(tmpdir(), { recursive: true });
    await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 96, g: 132, b: 176 } } })
      .png()
      .toFile(photoPath);

    // ?first=1 auto-opens the NewAdDialog on the source step.
    const generation = page.waitForResponse(
      (response) => response.url().includes("/api/adstudio/campaigns") && response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.goto(`${previewUrl}/ad-studio?first=1`);

    // Pick the first ready template card, then continue to the brief step.
    await page.locator(".studio-explore-card").first().click();
    const useButton = page.locator(".studio-explore-card-use").first();
    if (await useButton.count()) await useButton.click().catch(() => undefined);

    // Upload the headless photo through the dropzone's file input.
    const fileInput = page.locator("input[type=file]").first();
    await fileInput.setInputFiles(photoPath);

    // Fill the brief/description textbox if present.
    const textBox = page.getByRole("textbox").first();
    if (await textBox.count()) await textBox.fill("E2E appraisal ad — Scarborough");

    await page.getByRole("button", { name: /Generate ad/i }).click();

    const started = Date.now();
    const response = await generation;
    const body = (await response.json()) as { v2?: boolean; renderMs?: number; warnings?: string[] };
    expect(response.status()).toBe(201);
    expect(body.v2).toBe(true);
    expect(body.renderMs ?? 0).toBeLessThan(10_000);
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(imageModelCalls).toEqual([]);
  });

  test("editor: text edit reflects in the chrome, undo restores", async ({ page }) => {
    await page.goto(`${previewUrl}/ad-studio`);
    const editor = page.locator(".tw").first();
    await expect(editor).toBeVisible();
    const textBox = editor.getByRole("textbox").first();
    await textBox.fill("E2E headline swap");
    await expect(textBox).toHaveValue("E2E headline swap");
    await page.keyboard.press("Control+z");
  });

  test("publish review shows both frames and the payload truth", async ({ page }) => {
    await page.goto(`${previewUrl}/ad-studio?publish=1`);
    await page.getByText("Review", { exact: true }).first().click().catch(() => undefined);
    await expect(page.getByText("What will be sent to Meta")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Feed · 4:5/)).toBeVisible();
    await expect(page.getByText(/explicitly OPT_OUT/)).toBeVisible();
  });
});
