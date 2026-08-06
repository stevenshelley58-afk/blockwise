import { expect, test } from "@playwright/test";

// §14 Meta frame visual snapshots: the dev harness renders every placement
// at a fixed DPR; snapshots are update-on-purpose (the chrome replicates
// Meta, so a deliberate Meta redesign is the only legitimate update). The
// harness is dev-only, so this suite runs against a local dev server.

const devUrl = process.env.ADSTUDIO_FRAMES_DEV_URL ?? "http://127.0.0.1:3310";
const run = process.env.ADSTUDIO_FRAMES_E2E === "1";
const describeFrames = run ? test.describe : test.describe.skip;

const PLACEMENTS = [
  "fb-feed-mobile",
  "fb-feed-desktop",
  "ig-feed",
  "ig-story",
  "fb-story",
  "ig-reels",
] as const;

describeFrames("Meta placement frames", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  for (const placement of PLACEMENTS) {
    test(`${placement} renders at fixed DPR`, async ({ page }) => {
      await page.goto(`${devUrl}/dev/meta-frames?placement=${placement}`);
      await expect(page.getByRole("heading", { name: new RegExp(placement) })).toBeVisible();
      await expect(page.locator("main")).toHaveScreenshot(`meta-frame-${placement}.png`, {
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
