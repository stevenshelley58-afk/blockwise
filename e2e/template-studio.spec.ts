import { expect, test } from "@playwright/test";

// §14 Template Studio spec: operator opens a draft, picks a font, runs the
// fidelity check, sees residuals, and the approve gate stays human-only
// (disabled until the 100%-zoom confirmation checkbox).

const devPassword = process.env.ADSTUDIO_E2E_OPERATOR_PASSWORD;
const devEmail = process.env.ADSTUDIO_E2E_OPERATOR_EMAIL ?? "adstudio-e2e-operator@blockwise.test";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL;

test.beforeEach(async ({ page }) => {
  test.skip(!devPassword || !baseUrl, "Set ADSTUDIO_E2E_OPERATOR_PASSWORD and PLAYWRIGHT_BASE_URL to run Studio e2e.");
  await page.goto(`${baseUrl}/login`);
  await page.locator("#login-email").fill(devEmail);
  await page.locator("#login-password").fill(devPassword!);
  // Cold dev server compiles the page on first visit; click once hydrated,
  // retry once if the handler wasn't attached yet.
  await page.locator("#login-password").press("Enter").catch(() => undefined);
  await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    await page.getByRole("button", { name: "Sign in" }).click({ force: true });
  }
  // Post-login landing is /home by design; the specs navigate explicitly.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
});

test("queue lists v2 drafts with status and intent", async ({ page }) => {
  await page.goto(`${baseUrl}/operator/template-studio`);
  await expect(page.getByRole("heading", { name: "Template Studio" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^meta-/ }).first()).toBeVisible();
});

test("draft screen: check/bake/restyle surface, human-only approve", async ({ page }) => {
  await page.goto(`${baseUrl}/operator/template-studio`);
  const firstHref = await page.getByRole("link", { name: /^meta-/ }).first().getAttribute("href");
  await page.goto(`${baseUrl}${firstHref}`);

  // Studio surface: bake lever is present on every template with text inputs;
  // the font picker only when the template still has editable text layers.
  await expect(page.getByText("Bake / un-bake")).toBeVisible({ timeout: 15000 });
  const fontPicker = page.getByText("Font picker (Studio)");
  if (await fontPicker.count()) await expect(fontPicker).toBeVisible();

  // Run the fidelity check. force: the Konva stage's ResizeObserver keeps the
  // header re-rendering, so the stability check never settles (operator tool).
  await page.getByRole("button", { name: "Run check" }).click({ force: true });
  // The check renders every layout + computes residuals on a (cold) serverless
  // function — give it a generous window.
  await expect(page.getByText("Fidelity report (source values vs source ad)")).toBeVisible({ timeout: 45000 });

  // Approve is human-only: disabled until the confirmation checkbox.
  const approve = page.getByRole("button", { name: "Approve template" });
  await expect(approve).toBeDisabled();
  await page.getByText("Inspected at 100% zoom; a designer would ship this.").click({ force: true });
  await expect(approve).toBeEnabled();
});
