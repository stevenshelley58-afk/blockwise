import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PREVIEW_PATH = process.env.HOMEPAGE_PREVIEW_PATH ?? "/homepage-preview/concept";
const QA_DIR = process.env.HOMEPAGE_QA_DIR ?? "/srv/blockwise/e2e-runs/homepage-rework-20260908/canary-qa";
const SIGNUP_URL = "https://blockwise.sale/signup?offer=self-serve";
const forbiddenRequests: string[] = [];
const browserErrors: string[] = [];

test.describe.configure({ mode: "serial" });
test.use({ serviceWorkers: "block", ignoreHTTPSErrors: process.env.BLOCKWISE_CONTROLLED_CANARY === "1" });

function screenshotPath(name: string) {
  mkdirSync(QA_DIR, { recursive: true });
  return QA_DIR + "/" + name;
}

async function openPreview(page: Page) {
  forbiddenRequests.length = 0;
  browserErrors.length = 0;
  page.on("pageerror", (error) => browserErrors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push("console: " + message.text());
  });
  page.on("request", (request) => {
    const type = request.resourceType();
    const method = request.method();
    const url = request.url();
    if (
      ["fetch", "xhr", "websocket", "eventsource"].includes(type) ||
      !["GET", "HEAD", "OPTIONS"].includes(method) ||
      /(?:analytics|segment|mixpanel|amplitude|google-analytics|googletagmanager|facebook\.com\/tr|\/api\/)/i.test(url)
    ) forbiddenRequests.push(method + " " + type + " " + url);
  });
  await page.goto(PREVIEW_PATH, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "More leads. Less ad management." })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function assertNoWritesOrTracking() {
  expect(forbiddenRequests, "preview must not fetch APIs, emit analytics, or make writes").toEqual([]);
  expect(browserErrors, "preview must not cause browser or console errors").toEqual([]);
}

async function assertAllImagesLoaded(page: Page) {
  const images = await page.locator("img").evaluateAll((elements) => elements.map((image) => ({
    src: image.currentSrc || image.getAttribute("src"),
    complete: image.complete,
    width: image.naturalWidth,
  })));
  expect(images.length, "preview should contain its branded and example imagery").toBeGreaterThan(0);
  expect(images.filter((image) => !image.complete || image.width === 0), "all preview images must load successfully").toEqual([]);
}

async function assertVisibleElementsFit(page: Page) {
  const result = await page.evaluate(() => {
    const root = document.querySelector(".hc-root") ?? document.body;
    const rootRect = root.getBoundingClientRect();
    const offenders: string[] = [];
    const hasIntentionalHorizontalScroll = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    for (const element of root.querySelectorAll<HTMLElement>("a, button, input, textarea, select, summary, h1, h2, h3, p, img, svg, article")) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 1 || rect.height < 1 || style.display === "none" || style.visibility === "hidden") continue;
      if (!hasIntentionalHorizontalScroll(element) && (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1)) {
        offenders.push(element.tagName.toLowerCase() + "." + String(element.className).slice(0, 80));
      }
    }
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      rootScrollWidth: (root as HTMLElement).scrollWidth,
      rootClientWidth: (root as HTMLElement).clientWidth,
      offenders: offenders.slice(0, 12),
    };
  });
  expect(result.documentWidth, "document must not have horizontal overflow").toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.rootScrollWidth, "preview root must not hide horizontal clipping").toBeLessThanOrEqual(result.rootClientWidth + 1);
  expect(result.offenders, "visible element rectangles must stay within the preview root").toEqual([]);
}

async function assertLegible(page: Page) {
  const bad = await page.evaluate(() => {
    const issues: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("h1, h2, h3, a, button, input, textarea, select, summary")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || style.display === "none" || style.visibility === "hidden") continue;
      if (Number.parseFloat(style.fontSize) < 12) issues.push(element.tagName + ":" + style.fontSize);
      if (["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY"].includes(element.tagName) && rect.height < 30) {
        issues.push(element.tagName + ":height-" + rect.height.toFixed(1));
      }
    }
    return issues.slice(0, 12);
  });
  expect(bad, "visible headings and controls must remain legible/tappable").toEqual([]);
}

async function assertLayoutAt(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1, name: "More leads. Less ad management." })).toBeVisible();
  await assertVisibleElementsFit(page);
  await assertLegible(page);
}

async function takeSectionScreenshots(page: Page, prefix: string) {
  const sections: Array<[string, string]> = [
    ["hero", ".hc-hero"], ["workflow", "#how-it-works"], ["reporting", "#results"],
    ["pricing", "#pricing"], ["faq", "#faq"],
  ];
  for (const [name, selector] of sections) {
    await expect(page.locator(selector)).toBeVisible();
    await page.locator(selector).screenshot({ path: screenshotPath(prefix + "-" + name + ".png") });
  }
}

test("homepage concept preview is contained, interactive, static, and explicitly non-indexable", async ({ page }) => {
  await openPreview(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
  await expect(page.locator('meta[name="blockwise-preview-revision"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/actualproof/i);

  const trialLinks = page.locator('a[href="' + SIGNUP_URL + '"]');
  expect(await trialLinks.count(), "every trial CTA must use the approved signup URL").toBeGreaterThanOrEqual(5);
  await expect(page.locator("a").filter({ hasText: /trial|start free/i })).toHaveCount(await trialLinks.count());

  const pricingDetails = page.locator(".hp-plan-details");
  expect(await pricingDetails.count(), "each priced offer should expose additional plan details").toBeGreaterThan(0);
  const firstPricingDetails = pricingDetails.first();
  await firstPricingDetails.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(firstPricingDetails).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(firstPricingDetails).not.toHaveAttribute("open", "");

  await assertLayoutAt(page, 1440, 1000);
  await takeSectionScreenshots(page, "desktop-1440");
  await assertAllImagesLoaded(page);
  await page.locator(".hc-hero").screenshot({ path: screenshotPath("desktop-1440-hero-readable.png") });

  const steps = page.getByRole("group", { name: "Example campaign steps" });
  await steps.getByRole("button", { name: "Choose" }).click();
  const templates = page.getByRole("group", { name: "Example ad templates" });
  await expect(templates.getByRole("button", { name: /Classic/ })).toHaveAttribute("aria-pressed", "true");
  const editorial = templates.getByRole("button", { name: /Editorial/ });
  await editorial.click();
  await expect(editorial).toHaveAttribute("aria-pressed", "true");
  // The example changes only on deliberate input: it must not rotate templates itself.
  await page.waitForTimeout(800);
  await expect(editorial).toHaveAttribute("aria-pressed", "true");

  await steps.getByRole("button", { name: "Customise" }).click();
  const postCopy = page.getByLabel("Post copy");
  await postCopy.fill("A manual preview change stays on this page.");
  await expect(postCopy).toHaveValue("A manual preview change stays on this page.");

  await steps.getByRole("button", { name: "Budget & review" }).click();
  const budget = page.getByLabel("Daily Meta ad budget");
  await budget.fill("35");
  await expect(page.locator(".wf-budget-value output")).toHaveText("$35");
  await page.getByLabel("Duration").selectOption("7");
  await expect(page.getByText("Planned Meta ad spend").locator("..")).toContainText("$245 AUD");
  const approval = page.locator(".wf-approve");
  await expect(approval).toHaveAccessibleName("Approve this example");
  await approval.click();
  await expect(approval).toHaveAttribute("aria-pressed", "true");
  await expect(approval).toHaveAccessibleName("Approved in this example");
  await approval.click();
  await expect(approval).toHaveAttribute("aria-pressed", "false");

  const views = page.getByRole("group", { name: "Example report view" });
  await expect(views.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await views.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText("Last 30 days. Example leads by day.")).toBeVisible();
  await page.getByLabel("Email updates").selectOption("monthly");
  await expect(page.getByLabel("Email updates")).toHaveValue("monthly");
  await views.getByRole("button", { name: "Email" }).click();
  await expect(page.getByRole("heading", { name: "Example: your ad report" })).toBeVisible();
  await expect(page.getByText("Illustrative email preview")).toBeVisible();
  await page.getByRole("button", { name: "View example report" }).click();
  await expect(views.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Jordan Whitfield")).toBeVisible();
  await expect(page.getByText(/Blockwise does not contact the lead for you/)).toBeVisible();

  const faqGroups = page.locator(".hc-faq-group");
  await expect(faqGroups).toHaveCount(6);
  const firstGroup = faqGroups.first();
  await firstGroup.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(firstGroup).toHaveAttribute("open", "");
  const firstQuestion = firstGroup.locator(".hc-faq-list details").first();
  await firstQuestion.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(firstQuestion).toHaveAttribute("open", "");
  await expect(firstQuestion.locator(".hc-faq-answer")).toBeVisible();

  await assertLayoutAt(page, 390);
  const menu = page.locator(".hc-mobile-menu");
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await menu.locator("summary").click();
  await menu.getByRole("link", { name: "How it works" }).click();
  await expect(menu).not.toHaveAttribute("open", "");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("group", { name: "Example campaign steps" }).getByRole("button", { name: "Customise" }).click();
  await expect(page.getByLabel("Ad headline")).toBeEditable();

  await takeSectionScreenshots(page, "mobile-390");
  await page.screenshot({ path: screenshotPath("mobile-390-readable.png"), fullPage: true });

  for (const width of [320, 375, 390, 414, 768]) await assertLayoutAt(page, width);

  // Exercise controls after narrow and tablet layouts, not just their initial state.
  await assertLayoutAt(page, 320);
  await page.getByRole("group", { name: "Example report view" }).getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText("Last 30 days. Example leads by day.")).toBeVisible();
  await assertVisibleElementsFit(page);
  await page.screenshot({ path: screenshotPath("mobile-320-whole-page.png"), fullPage: true });

  await assertLayoutAt(page, 768);
  await page.getByRole("group", { name: "Example campaign steps" }).getByRole("button", { name: "Choose" }).click();
  await page.getByRole("group", { name: "Example ad templates" }).getByRole("button", { name: /Minimal/ }).click();
  await expect(page.getByRole("group", { name: "Example ad templates" }).getByRole("button", { name: /Minimal/ })).toHaveAttribute("aria-pressed", "true");
  await assertVisibleElementsFit(page);
  await page.screenshot({ path: screenshotPath("mobile-768-whole-page.png"), fullPage: true });
  await assertNoWritesOrTracking();
});
