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
  assert.match(showcase, /Example ads/);
  assert.match(showcase, /IntersectionObserver/);
  assert.match(showcase, /useReducedMotion/);
  // The front card is held long enough to be read before the deck advances.
  assert.match(showcase, /const DECK_HOLD_MS = 3400/);
  assert.doesNotMatch(showcase, /, 1850\)/);
  assert.doesNotMatch(showcase, /reactions|comments/);
});

test("homepage FAQ remains grouped, collapsed and matches the offer", async () => {
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
  assert.doesNotMatch(faqSection, /<details[^>]*open/);
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

  // Neither card may reintroduce its own shell values.
  assert.doesNotMatch(workflowCss, /\.hc-process-demo \{[^}]*border-radius/);
  assert.doesNotMatch(resultsCss, /\.rr-stage \{[^}]*border-radius/);
  assert.doesNotMatch(workflowCss, /\.hc-process-demo \{[^}]*box-shadow/);
  assert.doesNotMatch(resultsCss, /\.rr-stage \{[^}]*box-shadow: 0 30px 80px #0004/);

  // Each keeps its own height and header layout: only the frame is shared.
  assert.match(workflowCss, /--hc-demo-height: 764px/);
  assert.match(workflowCss, /\.hc-process-demo \{[^}]*overflow: visible/);
  assert.match(resultsCss, /\.rr-stage \{[^}]*overflow: hidden/);
});

test("the ad-creation headline is set as a block, not shrunk to one line", async () => {
  const css = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");
  const layout = css.match(/\.hc-process-layout \{([^}]*)\}/)[1];
  const headline = css.match(/\.hc-process-copy h2 \{([^}]*)\}/)[1];
  // The column has to be wide enough to set the headline at display size.
  const column = Number(layout.match(/minmax\(260px, ([\d.]+)fr\)/)[1]);
  assert.ok(column >= 0.9, `copy column fraction is ${column}, too narrow for a display headline`);
  const size = Number(headline.match(/clamp\((\d+)px/)[1]);
  assert.ok(size >= 30, `headline starts at ${size}px, still caption sized`);
  // Two lines, one per span, is the intended shape.
  assert.match(css, /\.hc-process-copy h2 > span \{\s*display: block/);
});
