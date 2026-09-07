import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pages = [
  "src/app/guides/sold-price-list-seller-leads/page.tsx",
  "src/app/guides/downsizing-ad-seller-leads/page.tsx",
  "src/app/guides/lead-follow-up-playbook/page.tsx",
  "src/app/guides/custom-list-facebook-ad-buyer-leads/page.tsx",
];
const docs = [
  "docs/content/guides/sold-price-list-seller-leads.md",
  "docs/content/guides/downsizing-ad-seller-leads.md",
  "docs/content/guides/lead-follow-up-playbook.md",
  "docs/content/guides/custom-list-facebook-ad-buyer-leads.md",
];
const read = (file: string) => readFileSync(file, "utf8");

test("practical guides carry the current date and no decorative hero image", () => {
  for (const file of pages) {
    const source = read(file);
    assert.match(source, /2026-09-07|7 September 2026/u);
    assert.doesNotMatch(source, /from ["']next\/image["']/u);
    assert.doesNotMatch(source, /<Image\b/u);
  }
});

test("guide content includes explicit corrections and geographic scope", () => {
  const combined = [...pages, ...docs].map(read).join("\n");
  assert.match(combined, /2024.*n=1,023|n=1,023.*2024/u);
  assert.match(combined, /not evidence that this campaign will perform|not a benchmark/u);
  assert.match(combined, /US, Canada or Europe/u);
  assert.match(combined, /Australian domestic.*not universally/u);
  assert.match(combined, /nondiscrimination/i);
  assert.match(combined, /50 results in a week after the last significant edit/u);
  assert.match(combined, /not a fixed three-day learning rule/u);
  assert.doesNotMatch(combined, /average \+ 5[–-]10%|within 5%|15 or more|3\/5/u);
});

test("downloadable guide resources exist and are non-empty", () => {
  const resources = [
    "public/guides/resources/sold-price-list-seller-leads/synthetic-sold-price-list.csv",
    "public/guides/resources/sold-price-list-seller-leads/seller-qualification-form.txt",
    "public/guides/resources/sold-price-list-seller-leads/delivery-email.txt",
    "public/guides/resources/sold-price-list-seller-leads/seller-ad-copy.txt",
    "public/guides/resources/downsizing-ad-seller-leads/downsize-funnel-tracker.csv",
    "public/guides/resources/downsizing-ad-seller-leads/synthetic-matching-property-list.csv",
    "public/guides/resources/downsizing-ad-seller-leads/form-and-ad-copy.txt",
    "public/guides/resources/lead-follow-up-playbook/14-day-cadence.csv",
    "public/guides/resources/lead-follow-up-playbook/message-specimens.txt",
    "public/guides/resources/custom-list-facebook-ad-buyer-leads/curated-list-template.csv",
    "public/guides/resources/custom-list-facebook-ad-buyer-leads/form-delivery-checklist.txt",
    "public/guides/resources/custom-list-facebook-ad-buyer-leads/copy-specimens.txt",
  ];
  for (const file of resources) {
    assert.ok(existsSync(file), file);
    assert.ok(readFileSync(file).length > 50, file);
  }
});

test("downsizer calculator validates ordered counts and avoids undefined arithmetic", () => {
  const source = read("src/app/guides/downsizing-ad-seller-leads/economics-calculator.tsx");
  assert.match(source, /cannot be greater than/u);
  assert.match(source, /Number\.isFinite/u);
  assert.match(source, /Number\.isInteger/u);
  assert.match(source, /count > 0/u);
  assert.match(source, /denominator && denominator > 0/u);
  assert.doesNotMatch(source, /NaN|Infinity/u);
});
