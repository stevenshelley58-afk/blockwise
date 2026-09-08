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
    "More leads. Less ad management.", "real estate agents",
    "Example ad", "Example enquiry", "<WorkflowShowcase />", "<ResultsReporting />", "<HomepagePricing />",
    "Ready to make your next ad?", "Start with three Feed and Story packs.",
  ]) assert.ok(component.includes(copy), `missing composition content: ${copy}`);
  assert.match(component, /TRIAL_SIGNUP_URL/);
  assert.match(component, /TRIAL_CTA_LABEL/);
  assert.doesNotMatch(component, /href="#trial"|CampaignControls|mock form/i);
  assert.doesNotMatch(component, /guarantee leads|guarantee sales/i);
  const sections = ["hc-hero", "hc-process", "<ResultsReporting />", "<HomepagePricing />", 'className="hc-faq"', "hc-trial"];
  const positions = sections.map((section) => component.indexOf(section));
  assert.ok(positions.every((position) => position >= 0), "approved sections remain present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
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
