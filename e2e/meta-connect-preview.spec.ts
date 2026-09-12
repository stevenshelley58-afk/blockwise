import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Public, isolated Meta connection concept preview.
 *
 * This suite deliberately uses an empty browser state and never visits the
 * real /connect-meta flow. It is safe to run against a task-owned preview URL
 * with PLAYWRIGHT_BASE_URL set. The demo mode is a local presentation seam,
 * not a provider connection.
 */

const PREVIEW_PATH = "/meta-connect-preview/concept/meta-connect";
const REVIEW_DIR = "/srv/blockwise/previews/meta-connect/review";
const VIEWPORTS = [
  { width: 1920, height: 1031, label: "user-desktop" },
  { width: 1440, height: 1000, label: "desktop" },
  { width: 390, height: 844, label: "mobile" },
  { width: 320, height: 740, label: "narrow" },
] as const;

const providerOrMutationUrl = (url: string) =>
  /(?:\/api\/|\/auth\/|oauth|facebook\.com|meta\.com|supabase)/i.test(url);

async function openPreview(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(PREVIEW_PATH, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "isolated preview must be reachable").toBe(200);
  await expect(
    page.getByRole("heading", { name: /Connect Facebook & Instagram/i }),
  ).toBeVisible();

  // A consent banner must never obscure the public concept, but tolerate the
  // shared shell if it is present in a preview build.
  const consent = page.getByRole("button", { name: /Accept all|Essential only/i });
  if (await consent.count()) await consent.first().click();
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
}

async function selectDemoMode(page: Page, label: string) {
  const select = page.getByRole("combobox", { name: /demo|preview|mode/i }).first();
  if (await select.count()) {
    await select.selectOption({ label });
    return;
  }

  // Keep the seam compatible with an accessible segmented control as well as
  // a native select. The UI should expose one of these, never a hidden hook.
  await page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).click();
}

function modeText(page: Page, pattern: RegExp) {
  return page.getByText(pattern).first();
}

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

test.describe("isolated Meta connection preview contract", () => {
  test("is public GET-only, protects API routes, and makes no provider calls", async ({
    page,
    request,
  }) => {
    const requests: string[] = [];
    page.on("request", (requestEvent) => requests.push(requestEvent.url()));

    await openPreview(page, 1440, 1000);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("combobox").first()).toBeVisible();

    // The preview is intentionally a read-only GET surface.
    const post = await request.post(PREVIEW_PATH);
    expect(post.status(), "preview POST must be rejected").toBe(405);

    const protectedRoute = await request.get("/api/protected");
    expect(
      [401, 403, 404],
      "protected API route must not be publicly readable",
    ).toContain(protectedRoute.status());

    // No authentication, API, Supabase, or Meta provider request may be
    // triggered by loading the concept preview.
    expect(requests.filter(providerOrMutationUrl)).toEqual([]);
  });

  test("copies the fictional Blockwise Business ID with an explicit permission grant", async ({
    page,
  }) => {
    await openPreview(page, 1440, 1000);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });

    const bodyText = await page.locator("body").innerText();
    const idMatch = bodyText.match(/\b\d{8,16}\b/);
    expect(idMatch, "preview should show a fictional numeric Business ID").not.toBeNull();

    const copy = page.getByRole("button", { name: /copy.*(?:business )?id/i }).first();
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(copy).toContainText(/copied/i);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(idMatch![0]);
  });

  test("simulates checking, reaches connected, and keeps Continue inside the preview", async ({
    page,
  }) => {
    await openPreview(page, 1440, 1000);

    await selectDemoMode(page, "Setup");
    await expect(page.getByRole("button", { name: /Check my sharing|I've added Blockwise/i })).toBeVisible();
    await page.getByRole("button", { name: /Check my sharing|I've added Blockwise/i }).click();
    await expect(modeText(page, /checking|verifying|looking for your access/i)).toBeVisible();

    // The selector is the only state seam. Selecting Connected is a fictional
    // example of a successful check and must render example assets, not IDs
    // from an account or a real provider response.
    await selectDemoMode(page, "Connected");
    await expect(modeText(page, /connected|access is ready|ready to go/i)).toBeVisible();
    await expect(page.getByText(/example|sample|fictional/i).first()).toBeVisible();

    const continueButton = page.getByRole("button", { name: /Continue/i }).first();
    await expect(continueButton).toBeVisible();
    await continueButton.click();
    await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH.replaceAll("/", "\\/")}(?:[?#].*)?$`));
    await expect(
      page.getByRole("heading", { name: /Connect Facebook & Instagram/i }),
    ).toBeVisible();
  });

  for (const state of ["Missing access", "Waiting for approval"] as const) {
    test(`renders the ${state.toLowerCase()} alternate state and a bounded retry`, async ({
      page,
    }) => {
      await openPreview(page, 1440, 1000);
      await selectDemoMode(page, state);

      await expect(modeText(page, new RegExp(state, "i"))).toBeVisible();
      const retry = page.getByRole("button", { name: /retry|try again|check again/i }).first();
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(page).toHaveURL(new RegExp(`${PREVIEW_PATH.replaceAll("/", "\\/")}(?:[?#].*)?$`));
      await expect(page.getByRole("heading", { name: /Connect Facebook & Instagram/i })).toBeVisible();
    });
  }

  test("has labelled controls and no unlabeled images or buttons", async ({ page }) => {
    await openPreview(page, 1440, 1000);

    await expect(page.getByRole("heading", { name: /Connect Facebook & Instagram/i })).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("combobox").first()).toHaveAccessibleName(/demo|preview|mode/i);

    const unlabeledButtons = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.filter((button) => {
        const name = button.getAttribute("aria-label") || button.textContent?.trim();
        return !name;
      }).length,
    );
    expect(unlabeledButtons, "visible buttons need an accessible name").toBe(0);

    const unlabeledImages = await page.locator("img:visible").evaluateAll((images) =>
      images.filter((image) => !image.getAttribute("alt")?.trim()).length,
    );
    expect(unlabeledImages, "visible images need alternative text").toBe(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`fits without horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await openPreview(page, viewport.width, viewport.height);
      expect(await noHorizontalScroll(page)).toBe(true);

      const primary = page.getByRole("button", { name: /Check my sharing|I've added Blockwise|Continue/i }).first();
      await expect(primary).toBeVisible();
      const height = await primary.evaluate((element) => element.getBoundingClientRect().height);
      expect(height, "primary action should remain touchable").toBeGreaterThanOrEqual(40);

      mkdirSync(REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: `${REVIEW_DIR}/meta-connect-preview-${viewport.label}-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
    });
  }
});

