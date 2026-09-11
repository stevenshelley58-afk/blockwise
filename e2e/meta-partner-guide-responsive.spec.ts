import { expect, test } from "@playwright/test";

/**
 * Responsive + accessibility coverage for the Meta sharing flow.
 *
 * Two surfaces, both against any authenticated customer session; when a
 * storage state is unavailable the suite is skipped (CI: provide
 * E2E_STORAGE_STATE / PLAYWRIGHT_BASE_URL).
 *
 * /connect-meta is the checklist: one primary action, gated by one
 * confirmation, no asset IDs to type.
 * /help carries the walkthrough, so its real Meta screenshots must stay
 * readable and openable at every width.
 *
 * Readability floors (acceptance):
 *  - connect screen: no horizontal overflow; every control >= 44px tall
 *  - confirmation gates the submit button
 *  - help walkthrough: portrait screenshot renders >= 260px wide, panoramic
 *    (cropped) screenshot >= 500px wide on desktop
 *  - the full-size viewer opens by keyboard and closes on Escape
 *  - mobile keeps the standard headline size
 */

type Viewport = { width: number; height: number; mobile: boolean };

// Testability seams: harness routes mirror the real pages without auth for
// local layout QA. They default to the real routes.
const GUIDE_PATH = process.env.E2E_GUIDE_PATH ?? "/connect-meta";
const HELP_PATH = process.env.E2E_HELP_PATH ?? "/help";

const VIEWPORTS: Viewport[] = [
  { width: 1366, height: 768, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 320, height: 568, mobile: true },
];

const CHECKLIST = [
  "Open Partners",
  "Give Blockwise access",
  "Paste the Blockwise Business ID",
  "Choose assets and permissions",
];

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
}

async function preAcceptConsent(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("bw-consent", "essential");
    } catch {}
  });
}

async function dismissConsent(page: import("@playwright/test").Page) {
  const consent = page.getByRole("button", {
    name: /Accept all|Essential only/i,
  });
  if (await consent.count()) await consent.first().click();
}

test.describe("connect-meta sharing checklist", () => {
  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.width}x${vp.height}: checklist and gate`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await preAcceptConsent(page);
      await page.goto(GUIDE_PATH);
      await dismissConsent(page);

      const heading = page.getByRole("heading", {
        name: /Share your Meta assets/i,
      });
      await expect(heading).toBeVisible();

      // The retired intro screen and the typed-ID step must not come back.
      await expect(
        page.getByRole("button", { name: /Show me what to do/i }),
      ).toHaveCount(0);
      await expect(page.locator("#meta-ad-account-id")).toHaveCount(0);

      if (vp.mobile) {
        const size = await heading.evaluate((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        );
        expect(size).toBeGreaterThanOrEqual(17);
      }

      for (const label of CHECKLIST) {
        await expect(page.getByText(label, { exact: false })).toBeVisible();
      }

      // Primary controls stay reachable at every width.
      for (const name of [
        /Open Meta Business Settings/i,
        /Confirm my sharing/i,
      ]) {
        const button = page.getByRole("button", { name }).first();
        await expect(button).toBeVisible();
        const height = await button.evaluate(
          (el) => el.getBoundingClientRect().height,
        );
        expect(height, `button ${name} height`).toBeGreaterThanOrEqual(43.5);
      }

      // The confirmation gates the submit.
      const submit = page.getByRole("button", { name: /Confirm my sharing/i });
      await expect(submit).toBeDisabled();
      await page
        .getByRole("checkbox", {
          name: /I have assigned my Page, ad account and permissions/i,
        })
        .click();
      await expect(submit).toBeEnabled();

      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});

test.describe("help carries the full Meta walkthrough", () => {
  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.width}x${vp.height}: screenshots and viewer`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await preAcceptConsent(page);
      await page.goto(HELP_PATH);
      await dismissConsent(page);

      await expect(page.getByRole("heading", { name: /^Help$/i })).toBeVisible();

      // The walkthrough topic is open by default; every step is listed.
      for (const label of CHECKLIST) {
        await expect(page.getByText(label, { exact: false })).toBeVisible();
      }
      await expect(page.getByText(/Blockwise Business ID/i).first()).toBeVisible();
      await expect(page.getByText(/Leave Full control off/i)).toBeVisible();

      const shots = page.locator('img[alt*="Meta"]');
      await expect(shots).toHaveCount(4);

      if (!vp.mobile) {
        for (let index = 0; index < 4; index++) {
          const shot = shots.nth(index);
          await shot.scrollIntoViewIfNeeded();
          const box = await shot.boundingBox();
          expect(box, `screenshot ${index + 1} must render`).not.toBeNull();
          // Step 2 is the panoramic crop, so it holds the wider floor.
          const min = index === 1 ? 500 : 260;
          expect(
            box!.width,
            `screenshot ${index + 1} width ${box!.width} < ${min}`,
          ).toBeGreaterThanOrEqual(min);
        }
      }

      // Full-size viewer: keyboard activation, then Escape closes it.
      const viewer = page.getByRole("button", { name: /View full size/i }).first();
      await viewer.scrollIntoViewIfNeeded();
      await viewer.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});
