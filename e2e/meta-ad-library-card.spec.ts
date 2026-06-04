import { expect, test } from "@playwright/test";

const devPassword = process.env.BLOCKWISE_DEV_PASSWORD;

test.describe("MetaAdLibraryCard customer contract", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!devPassword, "Set BLOCKWISE_DEV_PASSWORD and run `npm run seed:test-users` to run authenticated E2E tests.");

    await page.goto("/login");
    await page.getByLabel("Email").fill("operator@blockwise.test");
    await page.getByLabel("Password").fill(devPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/operator$/);
  });

  test("renders public research cards without internal provider fields", async ({ page }) => {
    await page.goto("/research?q=6008");

    await expect(page.getByRole("heading", { name: "Research" })).toBeVisible();
    const cards = page.locator(".meta-ad-card");
    test.skip((await cards.count()) === 0, "No seeded research ad cards are available for postcode 6008.");

    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
    const mediaOrFallback = firstCard.locator(".meta-ad-media-frame img, .meta-ad-media-frame video, .meta-ad-text-only");
    expect(await mediaOrFallback.count()).toBeGreaterThan(0);

    const pageText = await page.locator("body").innerText();
    expect(pageText).not.toMatch(
      /\b(?:observed_ad_id|external_ad_id|advertiser_page_id|ad_creative_id|source_provider|raw_payload|payload_hash|ad_snapshot_id|source_document_id)\b/i,
    );
    expect(pageText).not.toMatch(/\bAd\s+[a-z0-9_-]{8,}\b/i);
  });

  test("landing links are external-safe when present", async ({ page }) => {
    await page.goto("/research?q=6008");

    const landingLinks = page.locator(".meta-ad-destination-link");
    test.skip((await landingLinks.count()) === 0, "No seeded research destination links are available for postcode 6008.");

    const firstLink = landingLinks.first();
    await expect(firstLink).toBeVisible();
    await expect(firstLink).toHaveAttribute("target", "_blank");
    await expect(firstLink).toHaveAttribute("rel", /noreferrer/);
  });
});
