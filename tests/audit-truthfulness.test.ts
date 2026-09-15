import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAuditAvailability, getAuditHeroCopy } from "../src/lib/research/audit-availability.ts";
import { buildAdAudit } from "../src/lib/research/ad-audit.ts";

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
  assert.match(form, /use these details to respond to your campaign plan request/i);
  assert.match(form, /source: "audit-plan"/);
  assert.match(form, /property_management/);
  assert.match(page, /getAuditFooterCopy/);
  assert.match(page, /<h2>Example campaign<\/h2>/);
  assert.doesNotMatch(page, /Your campaign, ready to review/);
});


test("unavailable audit requests omit synthetic observations from the saved request", () => {
  const page = readFileSync("src/app/audit/page.tsx", "utf8");
  const form = readFileSync("src/components/research/audit-lead-form.tsx", "utf8");
  const availability = readFileSync("src/lib/research/audit-availability.ts", "utf8");
  assert.match(page, /metrics=\{hasObservedAds/);
  assert.match(page, /detected: undefined/);
  assert.match(form, /detected\?: number/);
  assert.match(form, /topPlatform\?: string/);
});

function ad(id: string) {
  return {
    id,
    library_id: id,
    advertiser_page_id: "page-id",
    advertiser_page_meta_id: "page-meta",
    page_name: "Harbour Realty",
    active_status: "active",
    first_seen_at: "2026-09-01T00:00:00Z",
    last_seen_at: "2026-09-02T00:00:00Z",
    last_checked_at: "2026-09-02T00:00:00Z",
    ad_delivery_started_at: "2026-09-01T00:00:00Z",
    ad_delivery_stopped_at: null,
    ad_creation_date: "2026-09-01",
    ad_creative_id: null,
    format: "image",
    headline: "Free appraisal",
    body: "Perth property update",
    cta: "Learn more",
    ad_type: "appraisal",
    primary_intent: "seller",
    classification: { description: null },
    display_state: "displayable",
    ownership: { agent: null, agency: { id: "agency-id", name: "Harbour Realty", relationship: "owner" } },
    locations: [{ id: "location-id", suburb: "Perth", state: "WA", postcode: "6000", relation: "property" }],
    media: [],
  } as never;
}

test("audit reads mapped Ad DB observations with a location filter and reports empty observations honestly", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await buildAdAudit(
    { location: "Perth, WA" },
    { searchAds: async (input) => { calls.push(input); return { items: [ad("one")], page: { nextCursor: null, limit: 100 } }; }, now: () => Date.parse("2026-09-03T00:00:00Z") },
  );
  assert.equal(result.stats.totals.detected, 1);
  assert.equal(result.generatedAt, "2026-09-03T00:00:00.000Z");
  assert.ok(calls.some((call) => call.state === "WA" && (call.suburb === "Perth" || call.postcode === "6000")));
  const empty = await buildAdAudit({ location: "Perth, WA" }, { searchAds: async () => ({ items: [], page: { nextCursor: null, limit: 100 } }) });
  assert.equal(empty.stats.totals.detected, 0);
  assert.equal(empty.stats.capped, true);
});

test("audit preserves gateway errors and marks a bounded page sequence as limited", async () => {
  await assert.rejects(buildAdAudit({ location: "Perth, WA" }, { searchAds: async () => { throw new Error("gateway unavailable"); } }), /gateway unavailable/);
  let page = 0;
  const capped = await buildAdAudit({ location: "Perth, WA" }, {
    searchAds: async () => {
      page += 1;
      const items = Array.from({ length: 100 }, (_, index) => ad(String((page - 1) * 100 + index)));
      return { items, page: { nextCursor: page < 8 ? String(page) : "more", limit: 100 } };
    },
  });
  assert.equal(capped.stats.sampleSize, 800);
  assert.equal(capped.stats.capped, true);
});
