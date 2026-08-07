import { expect, test } from "@playwright/test";

// §14 visual snapshots of the Meta placement frames at a fixed DPR.
// Update-on-purpose policy: baselines only change when Meta's chrome changes
// or the frames are deliberately redesigned — run with --update-snapshots
// and review the diff like a design review, never casually.

const PLACEMENTS = ["fb-feed-mobile", "fb-feed-desktop", "ig-feed", "ig-story", "fb-story", "ig-reels"] as const;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

for (const placement of PLACEMENTS) {
  test(`frame ${placement} matches the design baseline`, async ({ page }) => {
    // Dev-only harness renders each frame with a neutral plate (no secrets).
    test.skip(!process.env.ADSTUDIO_FRAMES_DEV_URL, "Set ADSTUDIO_FRAMES_DEV_URL (local dev server) for frame snapshots.");
    await page.goto(`${process.env.ADSTUDIO_FRAMES_DEV_URL}/dev/meta-frames?placement=${placement}`);
    await expect(page.locator("main")).toHaveScreenshot(`meta-frame-${placement}.png`, {
      maxDiffPixelRatio: 0.01,
    });
  });
}
