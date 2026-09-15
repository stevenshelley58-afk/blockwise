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
    'TRIAL_SIGNUP_URL = "https://blockwise.sale/signup?offer=ad-studio"',
    'TRIAL_CTA_LABEL = "Start your free trial"', "A$0", "A$249", "from A$1,500",
    "No Blockwise subscription fee", "per month, plus Meta ad spend",
    "Cancel anytime. Monthly billing, no lock-in.",
    "Creating and downloading ads is free. Publishing an ad needs a card and starts a 7-day trial.",
    "Publishing an ad starts a 7-day trial. After the trial this plan renews at A$249 per month until you cancel.",
    "Three Feed + Story ad packs", "Download and run them yourself",
    "Saved designs and leads stay available", "Up to 50 Feed + Story ad packs", "Up to four live campaigns",
  ]) assert.ok(data.includes(value), `missing offer fact: ${value}`);
  // Three distinct plans, each priced with its own action, and only one featured.
  assert.equal((data.match(/cta: \{ label:/g) ?? []).length, 3);
  assert.equal((data.match(/featured: true/g) ?? []).length, 1);
  assert.match(component, /HOMEPAGE_PLANS\.map/);
  assert.match(component, /<details className="hp-plan-details">/);
  assert.match(component, /className="hp-plan-note"/);
  assert.match(component, /plan\.cta\.href/);
  assert.match(component, /homepage-pricing\.css/);
  assert.match(styles, /\.hp-pricing-grid/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(data + component, /\u2014|#trial|Keep managing your ads for free|14 days|first ad runs/i);
});