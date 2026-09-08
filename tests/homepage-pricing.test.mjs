import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("homepage pricing presents three honest choices with direct signup", async () => {
  const [data, component, styles] = await Promise.all([
    readFile(new URL("../src/lib/homepage-concept/pricing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/homepage-pricing.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/homepage-concept/homepage-pricing.css", import.meta.url), "utf8"),
  ]);
  for (const value of [
    'TRIAL_SIGNUP_URL = "https://blockwise.sale/signup?offer=self-serve"',
    'TRIAL_CTA_LABEL = "Start your free trial"', "A$0", "A$249", "from A$1,500",
    "per month, until cancelled", "Three Feed + Story ad packs", "One campaign",
    "Saved designs and leads stay available", "Up to 50 Feed + Story ad packs", "Up to four live campaigns",
  ]) assert.ok(data.includes(value), `missing offer fact: ${value}`);
  assert.match(component, /HOMEPAGE_PLANS\.map/);
  assert.match(component, /<details className="hp-plan-details">/);
  assert.match(component, /hp-pricing-sequence/);
  assert.match(component, /plan\.cta\.href/);
  assert.match(component, /homepage-pricing\.css/);
  assert.match(styles, /\.hp-pricing-grid/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(data + component, /\u2014|#trial|Keep managing your ads for free|14 days|first ad runs/i);
});
