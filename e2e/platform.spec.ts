import { expect, test } from "@playwright/test";

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
