import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAuditAvailability, getAuditHeroCopy } from "../src/lib/research/audit-availability.ts";

function audit(detected: number, capped = false) {
  return { stats: { capped, totals: { detected } } } as never;
}

test("audit availability distinguishes failed, empty, limited, and observed scans", () => {
  assert.equal(getAuditAvailability(null), "unavailable");
  assert.equal(getAuditAvailability(audit(0)), "empty");
  assert.equal(getAuditAvailability(audit(4, true)), "limited");
  assert.equal(getAuditAvailability(audit(4)), "observed");
  assert.match(getAuditHeroCopy({ availability: "observed", area: "Perth", detected: 4, active: 2, advertisers: 2 }).lede, /observations, not a complete view/);
});

test("public audit copy avoids unsupported market and offer claims", () => {
  const page = readFileSync("src/app/audit/page.tsx", "utf8");
  const form = readFileSync("src/components/research/audit-lead-form.tsx", "utf8");
  const availability = readFileSync("src/lib/research/audit-availability.ts", "utf8");
  assert.match(availability, /Local ad observations are unavailable/);
  assert.match(availability, /does not show whether local agencies are advertising/);
  assert.match(availability, /not a complete view of the local market/);
  assert.match(availability, /Coverage is limited/);
  assert.match(availability, /No verified local ad observations were returned/);
  assert.doesNotMatch(page, /Almost no agencies are advertising|opening to be first|Three ads before Checkout|Six free renders|Create three ads free/);
  assert.match(page, /\["Free Appraisal", "Market Update", "Property Management"\]/);
  assert.doesNotMatch(form, /follow up about a trial|setup call|Promote a listing/i);
  assert.match(form, /only use these details to send your requested campaign plan/i);
  assert.match(form, /source: "audit-plan"/);
  assert.match(form, /property_management/);
  assert.match(page, /getAuditFooterCopy/);
  assert.match(page, /<h2>Example campaign<\/h2>/);
  assert.doesNotMatch(page, /Your campaign, ready to review/);
});


test("unavailable audit requests omit synthetic observations from the email payload", () => {
  const page = readFileSync("src/app/audit/page.tsx", "utf8");
  const form = readFileSync("src/components/research/audit-lead-form.tsx", "utf8");
  const availability = readFileSync("src/lib/research/audit-availability.ts", "utf8");
  assert.match(page, /metrics=\{hasObservedAds/);
  assert.match(page, /detected: undefined/);
  assert.match(form, /detected\?: number/);
  assert.match(form, /topPlatform\?: string/);
});
