import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const component = await readFile(
    new URL("../src/components/homepage-concept/homepage-concept.tsx", import.meta.url),
    "utf8",
  );

  for (const copy of [
    "Facebook &amp; Instagram ads.",
    "From template to live ad.",
    "Your ads. Your leads. Your budget.",
    "Start free trial",
    "No card required.",
    "Ad spend is separate.",
    "Example data",
    "nothing will be sent or saved",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(component, /Property Check|three free ads|3 free ads/i);
});
