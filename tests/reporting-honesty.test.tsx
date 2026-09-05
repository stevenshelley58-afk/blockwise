import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MetaMonitorHeader } from "../src/components/monitor/MetaMonitorHeader.tsx";
import { homePerformanceFromReporting } from "../src/lib/home/home-dashboard-data.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";

function livePayload(): MetaMonitorPayload {
  const sample = buildSampleMetaMonitorPayload({
    range: "last_30",
    now: new Date("2026-09-06T08:00:00.000Z"),
  });
  return {
    ...sample,
    connected: true,
    source: "live",
    summary: sample.summary
      ? { ...sample.summary, lastSyncedAt: "2026-08-01T02:03:00.000Z" }
      : null,
  };
}

test("Home accepts stale real last-30 data and keeps the provider timestamp", () => {
  const model = homePerformanceFromReporting(livePayload());
  assert.ok(model);
  assert.equal(model.performance.lastSyncedAt, "2026-08-01T02:03:00.000Z");
  assert.ok(model.performance.leads > 0);
  assert.ok(model.performance.cpl !== null);
});

test("Home distinguishes missing, zero, mismatched source, and mismatched period", () => {
  assert.equal(homePerformanceFromReporting(null), null);

  const base = livePayload();
  const zeroAds = base.ads.map((ad) => ({
    ...ad,
    metrics: { ...ad.metrics, leads: 0 },
  }));
  const spend = zeroAds.reduce((total, ad) => total + ad.metrics.spend, 0);
  const zero = homePerformanceFromReporting({
    ...base,
    ads: zeroAds,
    summary: base.summary ? { ...base.summary, leads: 0, spend } : null,
  });
  assert.ok(zero);
  assert.equal(zero.performance.leads, 0);
  assert.equal(zero.performance.cpl, null);

  const mismatchedSource = homePerformanceFromReporting({
    ...base,
    summary: base.summary
      ? { ...base.summary, leads: base.summary.leads + 1 }
      : null,
  });
  assert.ok(mismatchedSource);
  assert.equal(mismatchedSource.performance.cpl, null);

  const mismatchedPeriod = homePerformanceFromReporting({
    ...base,
    summary: base.summary
      ? {
          ...base.summary,
          dateRange: { ...base.summary.dateRange, start: "2026-01-01" },
        }
      : null,
  });
  assert.equal(mismatchedPeriod, null);
});

function header(lastSyncedAt: string | null, isSample: boolean): string {
  return renderToStaticMarkup(
    createElement(MetaMonitorHeader, {
      range: {
        key: "last_30",
        since: "2026-08-08",
        until: "2026-09-06",
        days: 30,
        label: "Last 30 days",
      },
      rangeKey: "last_30",
      customRange: { since: "2026-08-08", until: "2026-09-06" },
      lastSyncedAt,
      isRefreshing: false,
      isSample,
      onRangeChange() {},
      onCustomRangeChange() {},
      onRefresh() {},
    }),
  );
}

test("Results labels samples plainly and never invents a recent timestamp", () => {
  const sample = header(null, true);
  assert.match(sample, /Example data/);
  assert.doesNotMatch(sample, /Last known|just now/);

  const unknown = header(null, false);
  assert.match(unknown, /Not synced yet/);
  assert.doesNotMatch(unknown, /Last known|just now/);

  const real = header("2026-08-01T02:03:00.000Z", false);
  assert.match(real, /Last known/);
});
