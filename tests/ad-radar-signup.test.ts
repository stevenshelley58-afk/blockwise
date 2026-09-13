import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adRadarSignupMetadata,
  normalizeAdRadarAngle,
  normalizeAdRadarMarket,
  normalizeAdRadarReference,
  readAdRadarSignupContext,
} from "../src/lib/research/ad-radar-signup.ts";

test("parses the live audit CTA attribution contract", () => {
  assert.deepEqual(
    readAdRadarSignupContext("?source=audit&market=Perth%2C%20WA"),
    {
      source: "audit",
      market: "Perth, WA",
      postcode: null,
      intent: null,
      angle: null,
      adRef: null,
    },
  );
  assert.deepEqual(
    adRadarSignupMetadata("?source=audit&market=Perth%2C%20WA"),
    {
      ad_radar_source: "audit",
      ad_radar_market: "Perth, WA",
    },
  );
});

test("parses the live public radar dialog attribution contract", () => {
  assert.deepEqual(
    adRadarSignupMetadata(
      "?source=local-ad-radar&market=Subiaco%2C%20WA&angle=Free%20appraisal&adRef=observed-ad-123",
    ),
    {
      ad_radar_source: "local-ad-radar",
      ad_radar_market: "Subiaco, WA",
      ad_radar_angle: "Free appraisal",
      ad_radar_ad_ref: "observed-ad-123",
    },
  );
});

test("retains the legacy suburb-report handoff unchanged", () => {
  assert.deepEqual(
    adRadarSignupMetadata("?src=suburb-report&postcode=6000&intent=trial"),
    {
      ad_radar_postcode: "6000",
      ad_radar_source: "suburb-report",
      ad_radar_intent: "trial",
    },
  );
});

test("rejects unknown or malformed attribution without carrying unrelated params", () => {
  const source = "source=operator&market=Perth&angle=Free%20appraisal&adRef=observed-1";
  assert.deepEqual(readAdRadarSignupContext(source), {
    source: null,
    market: null,
    postcode: null,
    intent: null,
    angle: null,
    adRef: null,
  });
  assert.deepEqual(adRadarSignupMetadata(source), {});
  assert.equal(normalizeAdRadarMarket("x".repeat(121)), null);
  assert.equal(normalizeAdRadarAngle("agent@example.com"), null);
  assert.equal(normalizeAdRadarAngle("Call 0400 123 456"), null);
  assert.equal(normalizeAdRadarReference("observed/ad"), null);
  assert.equal(normalizeAdRadarReference("x".repeat(129)), null);
});

test("normalizes safe values while keeping attribution bounded", () => {
  assert.equal(normalizeAdRadarMarket("  Perth,   WA  "), "Perth, WA");
  assert.equal(normalizeAdRadarAngle("  Seller guide  "), "Seller guide");
  assert.equal(normalizeAdRadarReference("  observed-ad-123  "), "observed-ad-123");
  assert.deepEqual(
    readAdRadarSignupContext(
      "?source=audit&market=Perth%2C%20WA&angle=Market%20update&adRef=ad_123",
    ),
    {
      source: "audit",
      market: "Perth, WA",
      angle: "Market update",
      adRef: "ad_123",
      postcode: null,
      intent: null,
    },
  );
});


test("live CTA producers emit the source and attribution parameter names this parser accepts", () => {
  const audit = readFileSync("src/app/audit/page.tsx", "utf8");
  const radar = readFileSync("src/components/research/public-ad-radar-dialog.tsx", "utf8");

  assert.match(audit, /\/signup\?source=audit&market=/);
  assert.match(radar, /source:\s*"local-ad-radar"/);
  assert.match(radar, /market:\s*input\.location/);
  assert.match(radar, /params\.set\("angle"/);
  assert.match(radar, /params\.set\("adRef"/);
});

test("signup auth calls persist the bounded parser output as user metadata", () => {
  const source = readFileSync("src/components/signup-form.tsx", "utf8");
  assert.equal((source.match(/adRadarSignupMetadata\(location\.search\)/g) ?? []).length, 2);
  assert.match(source, /signup_flow:\s*"trial_self_serve"/);
});
