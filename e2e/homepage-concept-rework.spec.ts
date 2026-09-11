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

async function assertHeroTreatment(page: Page) {
  const hero = page.locator(".hc-hero-copy");
  await expect(hero).toContainText("No card required.");
  await expect(hero).not.toContainText("Meta ad spend is separate");
  const exampleLabel = page.getByText("Example ads", { exact: true });
  await expect(exampleLabel).toBeVisible();
  const [labelRect, frontAdRect] = await Promise.all([
    exampleLabel.boundingBox(),
    page.locator(".hc-meta-card.is-front article").boundingBox(),
  ]);
  expect(labelRect, "the example label must have a rendered rectangle").not.toBeNull();
  expect(frontAdRect, "the front example ad must have a rendered rectangle").not.toBeNull();
  expect(labelRect!.y + labelRect!.height, "the example label must not cover the ad header").toBeLessThanOrEqual(frontAdRect!.y + 1);

  const lines = page.locator(".hc-hero-copy h1 > span");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText("More leads.");
  await expect(lines.nth(1)).toHaveText("Less ad management.");
  const geometry = await lines.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      top: rect.top,
      height: rect.height,
      lineHeight: Number.parseFloat(style.lineHeight),
      color: style.color,
    };
  }));
  expect(Math.abs(geometry[0].left - geometry[1].left), "headline lines must share a left edge").toBeLessThanOrEqual(1);
  expect(geometry[1].top, "the second headline phrase must render on its own line").toBeGreaterThan(geometry[0].top + 1);
  for (const line of geometry) {
    expect(line.height, "each requested headline phrase must remain a single line").toBeLessThanOrEqual(line.lineHeight * 1.25);
  }
  expect(geometry[1].color, "the second headline line must use the restored light blue").toBe("rgb(78, 156, 245)");
}

async function assertAnimatedHeroAdvances(page: Page) {
  const frontAd = page.locator(".hc-meta-card.is-front article");
  await expect(frontAd).toBeVisible();
  const initialLabel = await frontAd.getAttribute("aria-label");
  await page.waitForTimeout(2200);
  await expect(frontAd).not.toHaveAttribute("aria-label", initialLabel!);
}

async function assertReducedMotionHeroFreezes(page: Page) {
  const showcase = page.locator(".hc-meta-showcase");
  await showcase.scrollIntoViewIfNeeded();
  const frontAd = page.locator(".hc-meta-card.is-front article");
  await expect(frontAd).toBeVisible();
  const initialLabel = await frontAd.getAttribute("aria-label");
  await page.waitForTimeout(2200);
  await expect(frontAd).toHaveAttribute("aria-label", initialLabel!);
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
    const isRendered = (element: HTMLElement) => {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (parent.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open) {
          const summary = parent.querySelector(":scope > summary");
          if (!summary || (element !== summary && !summary.contains(element))) return false;
        }
      }
      return true;
    };
    const hasIntentionalHorizontalScroll = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    for (const element of root.querySelectorAll<HTMLElement>("a, button, input, textarea, select, summary, h1, h2, h3, p, img, svg, article")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || !isRendered(element)) continue;
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
    const isRendered = (element: HTMLElement) => {
      for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (parent.tagName === "DETAILS" && !(parent as HTMLDetailsElement).open) {
          const summary = parent.querySelector(":scope > summary");
          if (!summary || (element !== summary && !summary.contains(element))) return false;
        }
      }
      return true;
    };
    for (const element of document.querySelectorAll<HTMLElement>("h1, h2, h3, a, button, input, textarea, select, summary")) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || !isRendered(element)) continue;
      if (Number.parseFloat(style.fontSize) < 12) issues.push(element.tagName + ":" + style.fontSize);
      const needsTouchHeight = element.matches(
        "button, input, textarea, select, summary, .hc-header a, .hc-footer nav a, .hc-mobile-menu a, .hc-button, .hp-plan-cta, .hp-plan-details-link",
      ) && !element.closest(".hc-faq-answer");
      if (needsTouchHeight && rect.height < 30) issues.push(element.tagName + ":" + String(element.className) + ":height-" + rect.height.toFixed(1));
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
  await assertHeroTreatment(page);
  await assertVisibleElementsFit(page);
  await assertLegible(page);
}

async function assertRestoredSectionSpacing(page: Page) {
  const expectedMargins: Array<[string, string]> = [
    [".hp-plan-price", "20px"],
    [".hp-plan-billing", "7px"],
    [".hp-plan-outcome", "15px"],
    [".hp-plan-included", "18px"],
    [".hp-plan-terms", "18px"],
    [".rr-chart", "16px"],
  ];
  for (const [selector, marginTop] of expectedMargins) {
    await expect(page.locator(selector).first(), selector + " must retain its intended top spacing").toHaveCSS("margin-top", marginTop);
  }
}

async function assertExpandedFaqsFit(page: Page) {
  const groups = page.locator(".hc-faq-group");
  await expect(groups).toHaveCount(6);
  for (let groupIndex = 0; groupIndex < await groups.count(); groupIndex += 1) {
    const group = groups.nth(groupIndex);
    if (!(await group.getAttribute("open"))) await group.locator(":scope > summary").click();
    await expect(group).toHaveAttribute("open", "");
    const questions = group.locator(".hc-faq-list details");
    expect(await questions.count(), "each FAQ group must retain its nested questions").toBeGreaterThan(0);
    for (let questionIndex = 0; questionIndex < await questions.count(); questionIndex += 1) {
      const question = questions.nth(questionIndex);
      if (!(await question.getAttribute("open"))) await question.locator("summary").click();
      await expect(question).toHaveAttribute("open", "");
      const questionText = question.locator("summary > span");
      await expect(questionText).toHaveCSS("transform", "none");
      const questionRect = await questionText.boundingBox();
      expect(questionRect, "opened FAQ question text must have a rendered rectangle").not.toBeNull();
      expect(questionRect!.x, "opened FAQ question text must not begin off-page").toBeGreaterThanOrEqual(-1);
      expect(questionRect!.x + questionRect!.width, "opened FAQ question text must not exceed the viewport").toBeLessThanOrEqual((await page.viewportSize())!.width + 1);
      await assertVisibleElementsFit(page);
    }
  }
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
  // The workflow studio is a timed loop, so parts of this spec wait on real
  // animation phases rather than on immediate state. Mobile emulation runs the
  // same walkthrough more slowly, so the default 30s budget is not enough.
  test.setTimeout(120_000);
  await openPreview(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
  await expect(page.locator('meta[name="blockwise-preview-revision"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/actualproof/i);
  await assertHeroTreatment(page);
  await assertAnimatedHeroAdvances(page);

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
  await assertRestoredSectionSpacing(page);
  await takeSectionScreenshots(page, "desktop-1440");
  await assertAllImagesLoaded(page);
  await page.locator(".hc-hero").screenshot({ path: screenshotPath("desktop-1440-hero-readable.png") });
  // The workflow demo is an auto-playing showcase. A visitor can jump between
  // steps, but the creative itself is decorative and carries no controls.
  const steps = page.locator(".hc-process-steps");
  const demo = page.locator(".hc-process-demo");
  await expect(steps.getByRole("button")).toHaveCount(3);
  // The step control belongs to the card header, not to the copy column.
  await expect(page.locator(".hc-process-demo-topbar .hc-process-steps")).toHaveCount(1);
  await expect(page.locator(".hc-process-copy .hc-process-steps")).toHaveCount(0);

  // One frame size for the whole story: it must not resize between steps.
  const frameAt = async () => {
    const box = await demo.boundingBox();
    return Math.round(box!.height);
  };
  const frameAtChoose = await frameAt();

  await steps.getByRole("button", { name: "Review" }).click();
  await expect(steps.getByRole("button", { name: "Review" })).toHaveAttribute("aria-pressed", "true");
  await expect(demo).toHaveAttribute("data-step", "2");

  // From the review step the loop advances to the approved state with no input.
  await expect(page.locator(".hc-story-approve.is-approved")).toHaveCount(1, { timeout: 8000 });
  expect(await frameAt(), "the demo frame must keep one height on the review step").toBe(frameAtChoose);

  // The copy is written a character at a time, and the ad is written with it.
  await steps.getByRole("button", { name: "Customise" }).click();
  await expect(demo).toHaveAttribute("data-step", "1");
  await expect(demo).toHaveAttribute("data-typing", "true", { timeout: 3000 });
  const sampled = await page.evaluate(() => {
    const field = document.querySelector(".hc-field > strong")?.textContent ?? "";
    const ad = document.querySelector(".hc-meta-feed-copy")?.textContent ?? "";
    return { field, ad };
  });
  const normalise = (value: string) => value.replace(/[^a-z0-9 ]/gi, "").trim();
  expect(normalise(sampled.field).length, "the field must be visibly mid-write").toBeGreaterThan(0);
  expect(normalise(sampled.ad), "the ad must show the same text as the field").toBe(normalise(sampled.field));
  await expect(demo).not.toHaveAttribute("data-typing", "true", { timeout: 8000 });
  expect(await frameAt(), "the demo frame must keep one height while text is written").toBe(frameAtChoose);

  await steps.getByRole("button", { name: "Choose" }).click();
  await expect(steps.getByRole("button", { name: "Choose" })).toHaveAttribute("aria-pressed", "true");
  await expect(demo).toHaveAttribute("data-step", "0");

  // The workspace is decorative: hidden from assistive tech and free of controls,
  // so the example cannot be mistaken for a live campaign editor.
  const workspace = page.locator(".hc-story-viewport");
  await expect(workspace).toHaveAttribute("aria-hidden", "true");
  await expect(workspace.locator("input, textarea, select, button")).toHaveCount(0);

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
  await assertExpandedFaqsFit(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  await assertReducedMotionHeroFreezes(page);
  // Under reduced motion the demo settles on the completed state and stays
  // there, while manual step selection still works. The frame height is fixed,
  // so this is also where the settled size is checked.
  const reducedDemo = page.locator(".hc-process-demo");
  await expect(reducedDemo).toHaveAttribute("data-step", "2");
  await expect(page.locator(".hc-story-approve.is-approved")).toHaveCount(1);
  await expect(page.locator(".hc-story-ad").first()).toContainText("Thinking of selling?");
  const reducedHeight = Math.round((await reducedDemo.boundingBox())!.height);
  await page.waitForTimeout(600);
  await expect(page.locator(".hc-story-approve.is-approved")).toHaveCount(1);
  await page.locator(".hc-process-steps").getByRole("button", { name: "Customise" }).click();
  await expect(reducedDemo).toHaveAttribute("data-step", "1");
  expect(Math.round((await reducedDemo.boundingBox())!.height), "the settled frame keeps one height").toBe(reducedHeight);
  await page.locator(".hc-process-steps").getByRole("button", { name: "Review" }).click();
  await expect(reducedDemo).toHaveAttribute("data-step", "2");

  await takeSectionScreenshots(page, "mobile-390");
  await page.screenshot({ path: screenshotPath("mobile-390-readable.png"), fullPage: true });

  for (const width of [320, 375, 390, 414, 768]) await assertLayoutAt(page, width);

  // Exercise controls after narrow and tablet layouts, not just their initial state.
  await assertLayoutAt(page, 320);
  await page.getByRole("group", { name: "Example report view" }).getByRole("button", { name: "30 days" }).click();
  await expect(page.getByText("Last 30 days. Example leads by day.")).toBeVisible();
  await assertVisibleElementsFit(page);
  await assertExpandedFaqsFit(page);
  await page.screenshot({ path: screenshotPath("mobile-320-whole-page.png"), fullPage: true });

  await assertLayoutAt(page, 768);
  await page.locator(".hc-process-steps").getByRole("button", { name: "Choose" }).click();
  await expect(page.locator(".hc-process-demo")).toHaveAttribute("data-step", "0");
  // The ready-made library stays a single row of real ads at tablet width, with
  // exactly one of them marked as chosen.
  await expect(page.locator(".hc-library-card").first()).toBeVisible();
  await expect(page.locator(".hc-library-selector")).toHaveCount(1);
  await assertVisibleElementsFit(page);
  await page.screenshot({ path: screenshotPath("mobile-768-whole-page.png"), fullPage: true });
  await assertNoWritesOrTracking();
});
