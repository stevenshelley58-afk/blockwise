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
    message: "Demo complete — your email was not sent or saved.",
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

test("homepage concept includes the required mobile story and disclosures", async () => {
  const component = (await Promise.all([
    "homepage-concept.tsx", "results-reporting.tsx",
  ].map((name) => readFile(new URL(`../src/components/homepage-concept/${name}`, import.meta.url), "utf8")))).join("\n");

  for (const copy of [
    "Your competition is running ads.",
    "More listings, less marketing stress.",
    "Create real estate ads for Facebook &amp; Instagram.",
    "Choose",
    "Customise",
    "Review",
    "Post copy",
    "Text on creative",
    "Review campaign",
    "Approve campaign",
    "No guesswork.",
    "No chasing updates.",
    "Your own dashboard. Clear email updates. On your schedule.",
    "Start free trial",
    "No card required.",
    "Ad spend is separate.",
    "Example data",
    "nothing will be sent or saved",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /STORY_PHASE_DELAYS/);
  assert.match(component, /data-editing-target="creative"/);
  assert.match(component, /useReducedMotion/);
  assert.match(component, /Pause/);
  assert.match(component, /Pause preview/);
  assert.match(component, /current >= STORY_STATUS.length - 1 \? 0 : current \+ 1/);
  assert.doesNotMatch(component, /Finished ad|Ready for approval|Example only|You approve before spending/);
  assert.doesNotMatch(component, /Property Check|three free ads|3 free ads/i);
});

test("homepage FAQ keeps setup first and explains separate spend and data ownership", async () => {
  const component = await readFile(new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url), "utf8");
  assert.match(component, /<h2>FAQ<\/h2>/);
  assert.match(component, /<p>What to expect before you start\.<\/p>/);
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
