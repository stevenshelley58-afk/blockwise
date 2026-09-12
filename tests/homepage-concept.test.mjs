import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FAQ_GROUPS } from "../src/lib/homepage-concept/content.ts";
import { requestMockTrial, validateTrialEmail } from "../src/lib/homepage-concept/mock-trial.ts";

test("the retained mock adapter stays local and validates input", async () => {
  assert.equal(validateTrialEmail(""), "Enter your work email.");
  assert.equal(validateTrialEmail("agent"), "Enter a valid email address.");
  assert.equal(validateTrialEmail("agent@example.com"), null);
  assert.deepEqual(await requestMockTrial(" Agent@Example.com ", { delayMs: 0 }), {
    ok: true, email: "agent@example.com", message: "Demo complete. Your email was not sent or saved.",
  });
});

test("homepage concept is isolated, noindex and makes no API calls", async () => {
  const [page, component, adapter] = await Promise.all([
    readFile(new URL("../src/app/concept/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/homepage-concept/mock-trial.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /index:\s*false/);
  assert.match(page, /follow:\s*false/);
  assert.doesNotMatch(component, /fetch\(|analytics|gtag|pixel|requestMockTrial/i);
  assert.doesNotMatch(adapter, /fetch\(|database|localStorage|sessionStorage/i);
  assert.match(adapter, /no network request, persistence or analytics/i);
});

test("homepage composition explains the product, flow, pricing and final signup", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  for (const copy of [
    "More leads.", "Less ad management.", "real estate agents",
    "HeroAdShowcase", "<WorkflowShowcase />", "<ResultsReporting />", "<HomepagePricing />",
    "Ready to make your next ad?", "Start with three Feed and Story packs.",
  ]) assert.ok(component.includes(copy), `missing composition content: ${copy}`);
  assert.match(component, /TRIAL_SIGNUP_URL/);
  assert.match(component, /TRIAL_CTA_LABEL/);
  assert.match(component, /<span>More leads\.<\/span><span className="hc-hero-prompt">Less ad management\.<\/span>/);
  assert.doesNotMatch(component, /No card required\. Meta ad spend is separate\./);
  assert.doesNotMatch(component, /href="#trial"|CampaignControls|mock form/i);
  assert.doesNotMatch(component, /guarantee leads|guarantee sales/i);
  const sections = ["hc-hero", "hc-process", "<ResultsReporting />", "<HomepagePricing />", 'className="hc-faq"', "hc-trial"];
  const positions = sections.map((section) => component.indexOf(section));
  assert.ok(positions.every((position) => position >= 0), "approved sections remain present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("hero restores the previous animated ad deck without fabricated proof metrics", async () => {
  const showcase = await readFile(new URL("../src/components/homepage-concept/hero-ad-showcase.tsx", import.meta.url), "utf8");
  assert.match(showcase, /IntersectionObserver/);
  assert.match(showcase, /useHydratedReducedMotion/);
  // The front card is held long enough to be read before the deck advances.
  assert.match(showcase, /const DECK_HOLD_MS = homepageMotion\.hero\.holdMs/);
  assert.match(showcase, /const DECK_VISIBLE_COUNT = 3/);
  assert.match(showcase, /initial=\{reduceMotion \? false : \{ transform: transformFor\(pose\)/);
  assert.match(showcase, /setOrder\(\(current\) => \[\.\.\.current\.slice\(1\), current\[0\]\]\)/);
  assert.match(showcase, /eager=\{position === 0\}/);
  assert.doesNotMatch(showcase, /, 1850\)/);
  assert.doesNotMatch(showcase, /reactions|comments/);
});

test("homepage FAQ opens getting started while keeping the remaining groups collapsed", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /FAQ_GROUPS\.map/);
  assert.match(component, /className="hc-faq-groups"/);
  assert.deepEqual(FAQ_GROUPS.map((group) => group.heading), ["Getting started", "Plans", "Costs", "Billing", "Ownership and support", "Let’s talk"]);
  const faqs = FAQ_GROUPS.flatMap((group) => group.faqs);
  assert.equal(faqs.length, 15);
  assert.equal(faqs.find((faq) => faq.question === "What happens after the free allowance?")?.answer, "Saved designs and leads stay available. You only pay Blockwise if you choose a paid plan.");
  assert.equal(faqs.find((faq) => faq.question === "Is Meta ad spend included?")?.answer, "No. You pay Meta directly through your own ad account.");
  assert.ok(faqs.every((faq) => !/\u2014/.test(faq.answer)));
  const faqSection = component.slice(component.indexOf('className="hc-faq"'), component.indexOf('className="hc-trial"'));
  assert.match(faqSection, /open=\{groupIndex === 0\}/);
  assert.match(faqSection, /<details className="hc-faq-group"/);
});

test("every demo card on the homepage takes one shell", async () => {
  const [shell, workflow, results, workflowCss, resultsCss] = await Promise.all([
    readFile(new URL("../src/components/homepage-concept/demo-card.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/results-reporting.css", import.meta.url), "utf8"),
  ]);

  // The shell is declared once: one radius scale, one edge, one shadow.
  assert.match(shell, /\.hc-demo-card \{[^}]*--r-card: 24px/);
  assert.match(shell, /\.hc-demo-card \{[^}]*border-radius: var\(--r-card\)/);
  assert.match(shell, /@media \(max-width: 600px\) \{\s*\.hc-demo-card \{ --r-card: 16px; \}/);
  // Rounding the header is what lets a card skip overflow: hidden.
  assert.match(shell, /\.hc-demo-card > :first-child \{[^}]*border-start-start-radius: var\(--r-card\)/);

  // Both surfaces consume it, and each imports it rather than relying on order.
  assert.match(workflow, /className="hc-process-demo hc-demo-card"/);
  assert.match(results, /className="rr-stage hc-demo-card"/);
  assert.match(workflow, /import "\.\/demo-card\.css"/);
  assert.match(results, /import "\.\/demo-card\.css"/);

  // Shared radii remain unchanged; the owner requested a quieter workflow shadow.
  assert.doesNotMatch(workflowCss, /\.hc-process-demo \{[^}]*border-radius/);
  assert.doesNotMatch(resultsCss, /\.rr-stage \{[^}]*border-radius/);

  assert.doesNotMatch(resultsCss, /\.rr-stage \{[^}]*box-shadow: 0 30px 80px #0004/);

  // Each keeps its own height and header layout: only the frame is shared.
  assert.match(workflowCss, /--hc-demo-height: \d+px/);
  assert.match(workflowCss, /\.hc-process-demo \{[^}]*overflow: hidden/);
  assert.match(resultsCss, /\.rr-stage \{[^}]*overflow: hidden/);
});

test("the workflow headline follows the shared section scale", async () => {
  const css = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");
  const headline = css.match(/\.hc-process-copy h2 \{([^}]*)\}/)[1];
  assert.match(headline, /font-size: clamp\(40px, 4\.4vw, 58px\)/);
  assert.match(headline, /font-weight: 760/);
  assert.match(headline, /line-height: 1\.06/);
  assert.match(css, /\.hc-process-copy h2 > span \{\s*display: block/);
  assert.doesNotMatch(css, /font-size: clamp\(26px, 7\.4vw, 34px\)/);

});

test("the results card holds one height in every view", async () => {
  const css = await readFile(new URL("../src/components/homepage-concept/results-reporting.css", import.meta.url), "utf8");
  // The card is sized to the chart views; the taller email view scrolls inside
  // it, because a view that resized the card moved the trial section and the
  // footer under the reader.
  assert.match(css, /\.rr-stage \{ --rr-stage-h: \d+px;[^}]*height: var\(--rr-stage-h\)/);
  assert.match(css, /\.rr-panel \{ flex: 1 1 auto; min-height: 0; overflow: hidden; \}/);
  assert.match(css, /\.rr-panel > \.rr-lead-email \{ max-height: 100%; overflow-y: auto/);
  for (const height of [512, 505]) {
    assert.ok(css.includes(`--rr-stage-h: ${height}px`), `missing the ${height}px breakpoint value`);
  }
});

test("demo headers keep screen selectors without extra playback controls", async () => {
  const results = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  const resultsCss = await readFile(new URL("../src/components/homepage-concept/results-reporting.css", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
  const workflowCss = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");
  // The reporting header keeps only its top-right screen selector.
  assert.match(results, /className="rr-stage-topbar"/);
  assert.doesNotMatch(results, /className="rr-stage-brand"/);
  assert.doesNotMatch(results, />(?:Pause|Play|Replay)</);
  assert.match(results, /className="rr-stage-slot"/);
  assert.doesNotMatch(results, /rr-stage-head/);
  // The selection control is the same pill and slider as the ad-creation card's.
  const pill = (css, name) => css.match(new RegExp(`\\.${name} button \\{([^}]*)\\}`))[1];
  for (const property of ["border-radius: 999px", "font-weight: 700"]) {
    assert.ok(pill(resultsCss, "rr-views").includes(property), `the reporting selector lost ${property}`);
    assert.ok(pill(workflowCss, "hc-process-steps").includes(property), `the ad-creation selector lost ${property}`);
  }
  assert.match(pill(resultsCss, "rr-views"), /min-height: 32px/);
  assert.match(pill(workflowCss, "hc-process-steps"), /min-height: 36px/);
  assert.match(workflowCss, /min-height: 44px/);
  assert.match(workflow, /arrow=\{null\}/);
  // Reporting periods are named in the selectors; the workflow keeps its task hint.
  assert.doesNotMatch(results, /className="rr-view-brief"/);
  assert.match(workflow, /className="hc-process-brief"/);
});

test("headline and small print clear the contrast floor", async () => {
  const css = await readFile(new URL("../src/app/concept/concept.css", import.meta.url), "utf8");
  const token = (name) => css.match(new RegExp(`--${name}: (#[0-9a-f]{6})`, "i"))[1];
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const ratio = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  // The section headline is large text, so it needs the 3:1 contrast floor.
  assert.ok(ratio(token("hc-blue-bright"), token("hc-canvas")) >= 3, "the demo headline is under 3:1 on the card canvas");
  // Plan notes at 12px and the footer small print at 11px need 4.5:1 on white.
  assert.ok(ratio(token("hc-faint"), "#ffffff") >= 4.5, "small print is under 4.5:1 on white");
});

test("the hero ad deck stops itself instead of offering a control", async () => {
  const showcase = await readFile(new URL("../src/components/homepage-concept/hero-ad-showcase.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/components/homepage-concept/hero-ad-showcase.css", import.meta.url), "utf8");
  // WCAG 2.2.2: the deck carries no pause control, so it must stop itself once
  // every ad has had its turn rather than rotating indefinitely.
  assert.match(showcase, /const \[advances, setAdvances\] = useState\(0\)/);
  assert.match(showcase, /if \(!shouldPlay\) return;/);
  // One full turn of the deck, counted from the advances rather than from the
  // front ad: the first ad starts on top, so that test stopped it on mount.
  assert.match(showcase, /const cycled = advances >= SHOWCASE_ADS\.length;/);
  // The hero carries no label or playback control.
  assert.match(showcase, /className="hc-meta-format-selector"/);
  assert.match(showcase, /setAdvances\(SHOWCASE_ADS\.length\)/);
  assert.doesNotMatch(showcase, /hc-meta-example-label|hc-meta-rotate-toggle|Example ads|Replay|Pause the demo/);
  assert.doesNotMatch(css, /\.hc-meta-example-label|\.hc-meta-rotate-toggle/);
});

test("the trial headline and its supporting line do not collide", async () => {
  const css = await readFile(new URL("../src/app/concept/concept.css", import.meta.url), "utf8");
  // globals.css zeroes paragraph top margins, so the gap has to be padding.
  assert.match(css, /\.hc-trial-grid > div > p \{ padding-top: 14px/);
});
