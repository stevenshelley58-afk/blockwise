import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FAQ_GROUPS } from "../src/lib/homepage-concept/content.ts";
import { requestMockTrial, validateTrialEmail } from "../src/lib/homepage-concept/mock-trial.ts";

test("homepage concept trial adapter validates email without a backend", async () => {
  assert.equal(validateTrialEmail(""), "Enter your work email.");
  assert.equal(validateTrialEmail("agent"), "Enter a valid email address.");
  assert.equal(validateTrialEmail("agent@example.com"), null);

  const result = await requestMockTrial(" Agent@Example.com ", { delayMs: 0 });
  assert.deepEqual(result, {
    ok: true,
    email: "agent@example.com",
    message: "Demo complete. Your email was not sent or saved.",
  });
});

test("homepage concept is isolated, noindex and uses the mock adapter", async () => {
  const [page, component, adapter, content] = await Promise.all([
    readFile(new URL("../src/app/concept/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/homepage-concept/mock-trial.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/homepage-concept/content.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /index:\s*false/);
  assert.match(page, /follow:\s*false/);
  assert.match(component, /requestMockTrial/);
  assert.doesNotMatch(component, /fetch\(|analytics|gtag|pixel/i);
  assert.doesNotMatch(adapter, /fetch\(|database|localStorage|sessionStorage/i);
  assert.match(adapter, /no network request, persistence or analytics/i);
  assert.match(content, /NEXT_PUBLIC_BASE_PATH/);
});

test("homepage concept uses a clean Meta ad loop as the hero visual", async () => {
  const component = (await Promise.all([
    "homepage-concept.tsx", "results-reporting.tsx",
  ].map((name) => readFile(new URL(`../src/components/homepage-concept/${name}`, import.meta.url), "utf8")))).join("\n");

  for (const copy of [
    "Your competition is running ads.",
    "More listings, less marketing stress.",
    "Facebook Feed",
    "Instagram Story",
    "Sponsored",
    "Learn more",
    "Like",
    "Comment",
    "Share",
    "Send message",
    "See your leads. Know your costs.",
    "Start free trial",
    "No card required.",
    "Ad spend is separate.",
    "Nothing will be sent or saved",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((component.match(/format: "feed",/g) ?? []).length, 4);
  assert.equal((component.match(/format: "story",/g) ?? []).length, 4);
  assert.match(component, /className="hc-hero-visual">\s*<MetaAdShowcase \/>/);
  assert.match(component, /\/home\/home-dusk\.webp/);
  assert.match(component, /\/hero\/hero-tall\.jpg/);
  assert.doesNotMatch(component, /Real estate ads that look native on Meta\./);
  assert.match(component, /className="hc-process" id="how-it-works"/);
  assert.match(component, /META_SHOWCASE_ADS/);
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /useReducedMotion/);
  assert.doesNotMatch(component, /hc-meta-loop-control|Pause ad showcase|Play ad showcase/);
  assert.doesNotMatch(component, /<PrimaryLink>Start free trial<\/PrimaryLink>\s*<ArrowRight/);
  assert.doesNotMatch(component, /Property Check\b|three free ads|3 free ads/i);
});

test("homepage FAQ mirrors pricing in grouped collapsed disclosures", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /<h2>FAQ<\/h2>/);
  assert.match(component, /<p>What to expect before you start\.<\/p>/);
  assert.match(component, /FAQ_GROUPS\.map/);
  assert.match(component, /className="hc-faq-groups"/);
  assert.match(component, /groupIndex/);
  assert.match(component, /group.heading/);

  assert.deepEqual(FAQ_GROUPS.map((group) => group.heading), [
    "Getting started",
    "Plans",
    "Costs",
    "Billing",
    "Ownership and support",
    "Let’s talk",
  ]);
  assert.deepEqual(FAQ_GROUPS.map((group) => group.faqs.length), [3, 2, 3, 2, 3, 2]);
  const faqs = FAQ_GROUPS.flatMap((group) => group.faqs);
  assert.equal(faqs.length, 15);
  assert.equal(faqs.find((faq) => faq.question === "What does self-serve cost?")?.answer, "A$249/month until cancelled. Your ad spend is separate.");
  assert.equal(faqs.find((faq) => faq.question === "Is Meta ad spend included?")?.answer, "No. You pay Meta directly through your own ad account.");
  assert.equal(faqs.find((faq) => faq.question === "Who owns my Meta ad account and ad data?")?.answer, "You do, even if you leave Blockwise.");
  assert.ok(faqs.every((faq) => !/\u2014/.test(faq.answer)), "homepage FAQ answers contain no em dashes");

  const faqSection = component.slice(component.indexOf('className="hc-faq"'), component.indexOf('className="hc-trial"'));
  assert.doesNotMatch(faqSection, /<details[^>]*open/);
  assert.match(faqSection, /<details className="hc-faq-group"[^>]*>\s*<summary>\s*<h3/);
  assert.match(faqSection, /<details key=\{faq.question\}>\s*<summary>/);
  assert.match(faqSection, /<p>\{faq.answer\}<\/p>/);
});

test("homepage reconciliation preserves approved sections and their order", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  const sections = ['id="top"', 'id="how-it-works"', '<ResultsReporting />', '<CampaignControls />', 'id="faq"', 'id="trial"'];
  const positions = sections.map((section) => component.indexOf(section));
  assert.ok(positions.every((position) => position >= 0), "All approved sections remain present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(component, /href="#how-it-works">How it works/);
  assert.match(component, /className="hc-login"[^>]*href="https:\/\/blockwise\.sale\/login"/);
  assert.match(component, /https:\/\/blockwise\.sale\/pricing/);
  const controls = await readFile(new URL("../src/components/homepage-concept/campaign-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /Creative control/);
  assert.match(controls, /Budget control/);
  assert.match(controls, /Campaign detail/);
  assert.match(controls, /Helpful updates/);
  assert.doesNotMatch(component, /id="examples"|href="#examples"/);
  assert.doesNotMatch(component, /EditingPreview/);
});


test("preview form cannot submit before its mock handler is hydrated", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /useState\(false\)/);
  assert.match(component, /useEffect\(\(\) => setHydrated\(true\), \[\]\)/);
  assert.equal((component.match(/disabled=\{!hydrated \|\| state === "loading"\}/g) ?? []).length, 2);
  assert.match(component, /<noscript>/);
});

test("campaign control preview keeps interaction local and accessible", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/campaign-controls.tsx", import.meta.url), "utf8");
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /inert=\{active !== index\}/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /budget \* days/);
  assert.match(source, /setPaused\(!paused\)/);
  assert.match(source, /setFrequency\(value\)/);
  assert.match(source, /useReducedMotion/);
  assert.doesNotMatch(source, /fetch\(|localStorage|setInterval|\u2014/);
});
