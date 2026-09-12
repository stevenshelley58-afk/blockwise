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
    "No Blockwise subscription fee", "per month, plus Meta ad spend",
    "Cancel anytime. Monthly billing, no lock-in.",
    "You only pay Blockwise if you choose a paid plan.",
    "Choosing this plan is the paid step. Starting free does not auto-charge you.",
    "Three Feed + Story ad packs", "One trial set of ads sharing one budget",
    "Your saved ads and leads stay available", "Up to 50 Feed + Story packs a month",
    "Up to four live groups of ads managed for you",
    "Weekly improvements and monthly reports", "100 creative updates each billing period",
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
  assert.match(data, /14 days of app access/);
  assert.match(data, /Create and manage your own ads\./);
  assert.match(data, /Start free, then choose/);
  assert.doesNotMatch(data + component, /\u2014|#trial|Keep managing your ads for free|render credits|\bcampaigns\b/i);
});