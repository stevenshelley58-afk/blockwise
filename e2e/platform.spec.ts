import { expect, test } from "@playwright/test";

const devPassword = process.env.BLOCKWISE_DEV_PASSWORD;

test.beforeEach(async ({ page }) => {
  test.skip(!devPassword, "Set BLOCKWISE_DEV_PASSWORD and run `npm run seed:test-users` to run authenticated E2E tests.");

  await page.goto("/login");
  await page.getByLabel("Email").fill("operator@blockwise.test");
  await page.getByLabel("Password").fill(devPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/operator$/);
  await expect(page.getByText("operator - operator@blockwise.test")).toBeVisible();
});

test("operator console exposes control-plane queues", async ({ page }) => {
  await page.goto("/operator");

  await expect(page.getByRole("heading", { name: "Operator Console" })).toBeVisible();
  await expect(page.getByText("AI spend")).toBeVisible();
  await expect(page.getByText("Approval Queue")).toBeVisible();
});

test("monitor shows zero-safe provider reporting", async ({ page }) => {
  await page.goto("/monitor");

  await expect(page.getByRole("heading", { name: "Monitor" })).toBeVisible();
  await expect(page.getByText("Meta")).toBeVisible();
  await expect(page.getByText("Google")).toBeVisible();
});

test("self-serve includes campaign drafting workflow", async ({ page }) => {
  await page.goto("/self-serve");

  await expect(page.getByRole("heading", { name: "Self-Serve" })).toBeVisible();
  await expect(page.getByText("Campaign Builder")).toBeVisible();
  await expect(page.getByText("Compliance Check")).toBeVisible();
});

test("ad studio exposes the full generation workflow", async ({ page }) => {
  await page.goto("/ad-studio");

  await expect(page.getByText("Ad Studio / Free Appraisal Campaign")).toBeVisible();
  await expect(page.getByRole("button", { name: "Campaign" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Angles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Variants" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Checklist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate variants" })).toBeVisible();
  await expect(page.getByText("Campaign readiness")).toBeVisible();
  await expect(page.getByText(/82%|Campaign readiness/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Story/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Feed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Square/ })).toBeVisible();
});

test("campaigns page shows publishing blockers", async ({ page }) => {
  await page.goto("/campaigns");

  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
  await expect(page.getByText("Human approval is required before publishing.")).toBeVisible();
});

test("leads page shows dedupe state", async ({ page }) => {
  await page.goto("/leads");

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByText("duplicate candidate")).toBeVisible();
});

test("model control exposes grouped OpenRouter dropdowns", async ({ page }) => {
  await page.goto("/model-control");

  await expect(page.getByRole("heading", { name: "Model Control" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research" })).toBeVisible();
  await expect(page.getByLabel("Primary model for Cheap draft text")).toBeVisible();
  await expect(page.getByText("Key missing").or(page.getByText("Ready"))).toBeVisible();
});
