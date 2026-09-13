import { expect, test } from "@playwright/test";

const controlledCanary = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.use({
  storageState: process.env.ADSTUDIO_E2E_STORAGE_STATE,
  serviceWorkers: "block",
  ignoreHTTPSErrors: controlledCanary,
  launchOptions: {
    executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
    args: controlledCanary ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
  },
});

// Real authenticated route and server guards, with only the manual request
// response stubbed for deterministic UI states. No customer/provider mutations.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.route("**/*", route =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
      ? route.continue()
      : route.fulfill({ status: 409, json: { error: "QA blocks live mutations." } }),
  );
  await page.route("**/api/integrations/meta/partner-access-request**", route =>
    route.fulfill({ json: { request: null } }),
  );
});

for (const width of [1440, 390, 320]) {
  test(`four independent help sections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/connect-meta");
    await expect(page.getByRole("heading", { name: "Connect Facebook & Instagram" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Meta settings", exact: true })).toHaveAttribute("href", "https://business.facebook.com/settings/partners");
    const copy = page.getByRole("button", { name: "Copy Business Portfolio ID" });
    await expect(copy).toBeEnabled();
    await expect(page.locator("input")).toHaveCount(0);
    for (let n = 1; n <= 4; n++) {
      const panel = page.getByTestId(`meta-step-${n}`);
      const help = panel.getByTestId(`step-help-${n}`);
      const summary = help.locator("summary");
      await expect(help).not.toHaveAttribute("open");
      expect(await summary.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await summary.focus();
      await summary.press("Enter");
      await expect(help).toHaveAttribute("open", "");
      for (const img of await help.locator("img").all()) {
        await expect(img).toBeVisible();
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
        const viewer = img.locator("..");
        await viewer.focus();
        await viewer.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      }
      await summary.press("Enter");
      await expect(help).not.toHaveAttribute("open");
    }
    const geometry = await page.locator("main").evaluate(el => ({
      fits: el.scrollWidth <= el.clientWidth + 1,
      viewport: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    expect(geometry).toEqual({ fits: true, viewport: true });
  });
}

test("confirmation records a request without claiming Meta is connected", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/integrations/meta/partner-access-request**", async route => {
    if (route.request().method() === "POST") {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { request: {
        requestId: "33333333-3333-4333-8333-333333333333", status: "requested",
        adAccountId: "", pageId: "", instagramAccountId: null,
        statusReason: null, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z",
      } } });
    }
    return route.fulfill({ json: { request: null } });
  });
  await page.goto("/connect-meta");
  await page.getByRole("button", { name: "I've added Blockwise", exact: true }).click();
  await expect(page.getByRole("heading", { name: /checking your.*sharing/i })).toBeVisible();
  expect(sent).toMatchObject({ requestType: "confirmation" });
  expect(sent).not.toHaveProperty("adAccountId");
  await expect(page.getByText(/^Connected$|All set!|Meta is connected/i)).toHaveCount(0);
});

test("request-load failures are visible and retryable", async ({ page }) => {
  await page.route("**/api/integrations/meta/partner-access-request**", route =>
    route.fulfill({ status: 503, json: { error: "Unable to load sharing. Try again." } }),
  );
  await page.goto("/connect-meta");
  await expect(page.getByRole("alert")).toContainText("Unable to load sharing");
  await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
});


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
