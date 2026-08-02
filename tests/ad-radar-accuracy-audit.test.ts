import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AD_RADAR_ACCURACY_SETTING_KEY,
  formatAdRadarAccuracyAlert,
  summariseAdRadarAccuracyRows,
} from "../src/lib/research/ad-radar-accuracy-audit.ts";

test("Ad Radar accuracy audit summarises typed, advertiser, suburb, and freshness coverage", () => {
  const now = new Date("2026-06-13T08:00:00.000Z");
  const coverageByObservedAdId = new Map([
    ["ad-1", true],
    ["ad-2", false],
    ["ad-3", true],
  ]);

  const summary = summariseAdRadarAccuracyRows(
    [
      {
        observed_ad_id: "ad-1",
        agent_id: "agent-1",
        agency_id: null,
        ad_type: "listing",
        primary_intent: "listing",
        classification: null,
        last_seen_at: "2026-06-13T07:00:00.000Z",
      },
      {
        observed_ad_id: "ad-2",
        agent_id: null,
        agency_id: null,
        ad_type: "other",
        primary_intent: "other",
        classification: { ad_type: "other" },
        last_seen_at: "2026-06-13T05:00:00.000Z",
      },
      {
        observed_ad_id: "ad-3",
        agent_id: null,
        agency_id: "agency-1",
        ad_type: null,
        primary_intent: "appraisal",
        classification: { ad_type: "appraisal" },
        last_seen_at: "2026-06-12T23:00:00.000Z",
      },
    ],
    { now, candidateCount: 12, coverageByObservedAdId },
  );

  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.candidateCount, 12);
  assert.equal(summary.counts.typedClassification, 2);
  assert.equal(summary.counts.resolvedAdvertiser, 2);
  assert.equal(summary.counts.suburbPostcodeCoverage, 2);
  assert.equal(summary.metrics.typedClassificationPct, 66.7);
  assert.equal(summary.metrics.resolvedAdvertiserPct, 66.7);
  assert.equal(summary.metrics.suburbPostcodeCoveragePct, 66.7);
  assert.equal(summary.metrics.medianLastSeenAgeHours, 3);
  assert.equal(summary.status, "warn");
});

test("Ad Radar accuracy alert names threshold failures and runtime setting key is stable", () => {
  assert.equal(AD_RADAR_ACCURACY_SETTING_KEY, "ad_radar_accuracy_audit_latest");

  const alert = formatAdRadarAccuracyAlert({
    version: 1,
    auditedAt: "2026-06-13T08:00:00.000Z",
    windowDays: 7,
    sampleSize: 2,
    candidateCount: 2,
    status: "warn",
    thresholds: { typedClassificationPct: 70, resolvedAdvertiserPct: 90 },
    counts: { typedClassification: 1, resolvedAdvertiser: 1, suburbPostcodeCoverage: 2 },
    metrics: {
      typedClassificationPct: 50,
      resolvedAdvertiserPct: 50,
      suburbPostcodeCoveragePct: 100,
      medianLastSeenAgeHours: 4,
    },
    errors: ["suburb/postcode coverage query failed: missing relation"],
  });

  assert.match(alert.subject, /Ad Radar accuracy 50% typed, 50% advertiser/);
  assert.match(alert.text, /typed classification: 50\.0% \(1\/2\)/);
  assert.match(alert.text, /resolved advertiser: 50\.0% \(1\/2\)/);
  assert.match(alert.text, /suburb\/postcode coverage: 100\.0%/);
  assert.match(alert.text, /coverage query failed/);
});

test("weekly Ad Radar accuracy Vercel Cron stores to runtime settings and uses alert delivery", () => {
  const helper = readFileSync("src/lib/research/ad-radar-accuracy-audit.ts", "utf8");
  const route = readFileSync("src/app/api/cron/ad-radar-accuracy/route.ts", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");

  assert.match(helper, /from\("runtime_settings"\)/);
  assert.match(helper, /AD_RADAR_ACCURACY_SETTING_KEY/);
  assert.match(helper, /sendPaidServiceAlert/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /runAdRadarAccuracyAudit\(createSupabaseServiceClient\(\)\)/);
  assert.match(vercel, /"path": "\/api\/cron\/ad-radar-accuracy"/);
  assert.match(vercel, /"schedule": "0 0 \* \* 1"/);
});
