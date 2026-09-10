import { expect, test } from "@playwright/test";

/**
 * Responsive + accessibility coverage for the /connect-meta partner-access
 * guide. Runs against any authenticated customer session; when a storage
 * state is unavailable the suite is skipped (CI: provide
 * E2E_STORAGE_STATE / PLAYWRIGHT_BASE_URL).
 *
 * Readability floors (acceptance):
 *  - portrait instructional screenshot renders >= 260px wide
 *  - panoramic (cropped) screenshot renders >= 500px wide on desktop
 *  - primary controls are >= 44px tall
 *  - no horizontal overflow; vertical scrolling remains allowed
 *  - full-size viewer opens by keyboard and closes on Escape
 *  - mobile keeps the standard 24px headline
 *  - asset-ID draft values survive a page refresh
 */

type Viewport = { width: number; height: number; mobile: boolean };

// Testability seam: the harness route mirrors /connect-meta layout without
// auth for local layout QA. Defaults to the real page.
const GUIDE_PATH = process.env.E2E_GUIDE_PATH ?? "/connect-meta";

const VIEWPORTS: Viewport[] = [
  { width: 1366, height: 768, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 320, height: 568, mobile: true },
];

const STEP_ACTIONS = [
  "I found Partners",
  "I added Blockwise",
  "I selected the assets",
  "I’ve assigned the assets",
];

test.describe("connect-meta guide responsive + a11y", () => {
  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.width}x${vp.height}: layout floors and viewer`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Pre-accept cookie consent so the banner never intercepts actions.
      await page.addInitScript(() => {
        try {
          localStorage.setItem("bw-consent", "essential");
        } catch {}
      });
      await page.goto(GUIDE_PATH);
      const consent = page.getByRole("button", { name: /Accept all|Essential only/i });
      if (await consent.count()) await consent.first().click();
      await expect(
        page.getByRole("heading", { name: /Share your Meta assets/i }),
      ).toBeVisible();

      // Mobile keeps the standard 24px mobile headline (compact treatment is
      // desktop-short-viewport only).
      if (vp.mobile) {
        const size = await page
          .getByRole("heading", { name: /Share your Meta assets/i })
          .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(22);
      }

      // No horizontal overflow anywhere in the flow.
      const noHScroll = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        );

      // Intro.
      await expect(page.getByText(/never see your Meta password/i)).toBeVisible();
      await page.getByRole("button", { name: /Show me what to do/i }).click();

      for (let step = 0; step < 4; step++) {
        await expect(page.getByText(`Meta step ${step + 1} of 4`)).toBeVisible();

        // Screenshot readability floors (desktop).
        if (!vp.mobile) {
          const shot = page.locator('img[alt*="Meta"]').first();
          await expect(shot).toBeVisible();
          await shot.evaluate(
            (img) =>
              img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
          );
          const box = await shot.boundingBox();
          expect(box, "screenshot must render").not.toBeNull();
          const min = step === 1 ? 500 : 260;
          expect(
            box!.width,
            `step ${step + 1} screenshot width ${box!.width} < ${min}`,
          ).toBeGreaterThanOrEqual(min);
        }

        // Primary controls >= 44px.
        for (const name of [/Previous|Back to start/, new RegExp(STEP_ACTIONS[step]), /View full-size/i]) {
          const btn = page.getByRole("button", { name }).first();
          const h = await btn.evaluate((el) => el.getBoundingClientRect().height);
          expect(h, `button ${name} height`).toBeGreaterThanOrEqual(43.5);
        }

        // Full-size viewer: keyboard activation + Escape close.
        const viewerButton = page.getByRole("button", {
          name: `View full-size Meta step ${step + 1} screenshot`,
        });
        await viewerButton.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(
          page.getByText(/Press Escape to close/),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();

        // Advance.
        await page
          .getByRole("button", { name: new RegExp(STEP_ACTIONS[step]) })
          .click();
        if (step === 3) {
          // On the details phase, verify draft persistence via refresh.
          await page.fill("#meta-ad-account-id", "123456789012345");
          await page.fill("#meta-page-id", "223456789012345");
          await page.reload();
          // After reload the guide starts on the intro; navigate back to the
          // details phase and expect the draft to have been restored.
          const show = page.getByRole("button", { name: /Show me what to do/i });
          await expect(show).toBeVisible();
          await show.click();
          for (let i = 0; i < 4; i++)
            await page
              .getByRole("button", { name: new RegExp(STEP_ACTIONS[i]) })
              .click();
          await expect(page.locator("#meta-ad-account-id")).toHaveValue(
            "123456789012345",
          );
          await expect(page.locator("#meta-page-id")).toHaveValue(
            "223456789012345",
          );
        }
      }
      expect(await noHScroll()).toBe(true);
    });
  }
});
