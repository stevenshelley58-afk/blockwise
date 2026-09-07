import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FAQS } from "../src/lib/homepage-concept/content.ts";
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
  assert.match(component, /disabled=\{!hydrated \|\| state === "loading"\}/);
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
    "Know how your ads are going.",
    "Start free trial",
    "No card required.",
    "Ad spend is separate.",
    "Example data",
    "Your email is not sent or saved",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal((component.match(/format: "feed",/g) ?? []).length, 4);
  assert.equal((component.match(/format: "story",/g) ?? []).length, 4);
  assert.match(component, /className="hc-hero-visual">\s*<MetaAdShowcase \/>/);
  assert.match(component, /\/home\/home-dusk\.webp/);
  assert.match(component, /\/hero\/hero-tall\.jpg/);
  assert.doesNotMatch(component, /Real estate ads that look native on Meta\./);
  assert.doesNotMatch(component, /className="hc-process"/);
  assert.match(component, /META_SHOWCASE_ADS/);
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /visibilitychange/);
  assert.match(component, /useReducedMotion/);
  assert.doesNotMatch(component, /hc-meta-loop-control|Pause ad showcase|Play ad showcase/);
  assert.doesNotMatch(component, /<PrimaryLink>Start free trial<\/PrimaryLink>\s*<ArrowRight/);
  assert.doesNotMatch(component, /Property Check\b|three free ads|3 free ads/i);
});

test("homepage FAQ keeps setup first and explains separate spend and data ownership", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /<h2>FAQ<\/h2>/);
  assert.equal(FAQS[0].question, "What if I don't have a Meta ad account?");
  assert.match(FAQS[0].answer, /help you set one up in your name and connect it to Blockwise/);
  const spend = FAQS.find((faq) => faq.question === "Is ad spend included?");
  assert.ok(spend);
  assert.match(spend.answer, /pay Meta separately through your own ad account/);
  assert.match(spend.answer, /your ad data stays yours, even if you leave Blockwise/);
  const trial = FAQS.find((faq) => faq.question === "What happens after the trial?");
  assert.ok(trial);
  assert.match(trial.answer, /keep running and managing your ads yourself for free/);
  assert.match(trial.answer, /Meta ad spend is still separate/);
  assert.match(trial.answer, /monthly plan or a managed account/);
  assert.equal(FAQS.length, 6);
});


test("complete homepage keeps approved sections without superseded explanatory panels", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /<CreativeEditPreview selectedExample=\{selectedExample\}/);
  assert.match(component, /aria-controls="example-panel"/);
  assert.ok(component.indexOf('id="examples"') < component.indexOf('<ResultsReporting />'));
  assert.doesNotMatch(component, /id="control"|id="how-it-works"|About this ad|Try the guided setup|Choose an objective/);
  assert.match(component, /href="https:\/\/blockwise.sale\/pricing"/);
  assert.match(component, /href="https:\/\/blockwise.sale\/guides"/);
  assert.doesNotMatch(component, /aria-live="polite">\s*Showing/);
  assert.match(component, /aria-hidden=\{position !== 0\}/);
  const visibleSources = await Promise.all([
    "../src/components/homepage-concept/homepage-concept.tsx",
    "../src/lib/homepage-concept/content.ts",
    "../src/lib/homepage-concept/mock-trial.ts",
  ].map((name) => readFile(new URL(name, import.meta.url), "utf8")));
  assert.doesNotMatch(visibleSources.join("\n"), /\u2014/);
});
