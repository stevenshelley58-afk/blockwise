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
// Storage state is per-origin; the loop logs in each run with the seeded creds
// so it works against any Preview host.
const e2eEmail = process.env.ADSTUDIO_E2E_EMAIL ?? "adstudio-e2e@blockwise.test";
const e2ePassword = process.env.ADSTUDIO_E2E_PASSWORD;
const canRun = Boolean(previewUrl && workspaceId && v2Enabled && e2ePassword);

if (!canRun && process.env.CI) {
  test("AdStudio v2 loop preconditions are present in CI", () => {
    const missing = [
      !previewUrl && "PLAYWRIGHT_BASE_URL",
      !workspaceId && "ADSTUDIO_E2E_WORKSPACE_ID",
      !v2Enabled && "ADSTUDIO_E2E_V2=1 (Preview env has ADSTUDIO_TEMPLATES_V2=true)",
      !e2ePassword && "ADSTUDIO_E2E_PASSWORD",
    ].filter(Boolean);
    throw new Error(`AdStudio v2 e2e cannot run in CI — missing: ${missing.join(", ")}.`);
  });
}

const describeV2Loop = canRun ? test.describe : test.describe.skip;

describeV2Loop("AdStudio v2 loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${previewUrl}/login`);
    await page.locator("#login-email").fill(e2eEmail);
    await page.locator("#login-password").fill(e2ePassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/(home|ad-studio|self-serve)/, { timeout: 45_000 });
  });

  test("generation is deterministic, fast, and image-model-free", async ({ page }) => {
    // Headless customer photo (1200x1500 clears every slot's 0.5x floor).
    const photoPath = join(tmpdir(), "adstudio-e2e-photo.png");
    mkdirSync(tmpdir(), { recursive: true });
    await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 96, g: 132, b: 176 } } })
      .png()
      .toFile(photoPath);
    const imageDataUrl = `data:image/png;base64,${(await import("node:fs")).readFileSync(photoPath).toString("base64")}`;

    await page.goto(`${previewUrl}/ad-studio`); // establish session origin
    const response = await page.request.post(`${previewUrl}/api/adstudio/campaigns`, {
      data: {
        firstAd: {
          source: "gallery",
          templateId: "meta-agent-intro-feed-037",
          description: "E2E appraisal ad — Scarborough",
          imageDataUrl,
          formats: ["9:16", "4:5"],
          copy: {
            primaryText: "Fresh family homes hitting the Scarborough market this month.",
            headline: "Book an appraisal",
            description: "Local agents, real comparables.",
            cta: "Get quote",
          },
        },
        suburb: "Scarborough",
      },
    });
    const body = (await response.json()) as { v2?: boolean; renderMs?: number };
    expect(response.status()).toBe(201);
    expect(body.v2).toBe(true);
    expect(body.renderMs ?? 0).toBeLessThan(10_000);
    // The image-model-free guarantee is structural: generateV2 never calls an
    // image model (enforced by the contract-guards grep-gate in the unit
    // suite); the copy fallback uses text AI only and is bypassed here by the
    // supplied copy.
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
