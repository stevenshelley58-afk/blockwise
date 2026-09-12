import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomePerformanceChart } from "../src/components/self-serve/home-chart.tsx";
import { DemoModeNotice } from "../src/components/monitor/DemoModeNotice.tsx";
import { MetaMonitorHeader } from "../src/components/monitor/MetaMonitorHeader.tsx";
import { niche } from "../src/config/niche/index.ts";
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

function header(lastSyncedAt: string | null, isSample: boolean, isConnected: boolean): string {
  return renderToStaticMarkup(
    createElement(MetaMonitorHeader, {
      lastSyncedAt,
      isRefreshing: false,
      isSample,
      isConnected,
      onRefresh() {},
    }),
  );
}

test("Results labels samples plainly and never invents a recent timestamp", () => {
  // The demo label lives in the one bar under the figures that also carries the
  // way out, so the header stays free of a second badge and a sample never
  // claims a sync.
  const banner = renderToStaticMarkup(
    createElement(DemoModeNotice, { metaConnectHref: "/connect-meta" }),
  );
  assert.match(banner, /data-notice-bar/);
  assert.match(banner, />Demo numbers for an example account</);
  assert.match(banner, /Connect Meta/);
  assert.match(banner, /href="\/connect-meta"/);
  assert.doesNotMatch(banner, /Setup guide|Hide demo/);

  const sample = header(null, true, true);
  assert.doesNotMatch(sample, /Last known|just now|Not synced yet|Not connected/);
  assert.doesNotMatch(sample, /Refresh/);

  const unknown = header(null, false, true);
  assert.match(unknown, /Not synced yet/);
  assert.doesNotMatch(unknown, /Last known|just now/);

  const real = header("2026-08-01T02:03:00.000Z", false, true);
  assert.match(real, /Last known/);
});

test("Results labels a disconnected account plainly and hides sync controls", () => {
  const disconnected = header(null, false, false);
  assert.match(disconnected, /Not connected/);
  assert.doesNotMatch(disconnected, /Not synced yet/);
  assert.doesNotMatch(disconnected, /Refresh/);
});

test("a demo is labelled in the same bar and the same words everywhere", () => {
  // One sentence, three bars: Home's weekly figures, Home's example leads and
  // Results' example report. Nothing to keep in step by hand, because there is
  // one string to change.
  const { home } = niche.copy;
  assert.equal(home.leads.demoNote, home.kpis.demoNote);
  assert.equal(niche.copy.performance.demoNote, home.kpis.demoNote);
});


test("Home chart does not describe missing data as zero enquiries", () => {
  for (const daily of [null, []]) {
    const html = renderToStaticMarkup(createElement(HomePerformanceChart, { daily }));
    assert.match(html, /Reporting unavailable/);
    assert.doesNotMatch(html, /No enquiries recorded|No leads yet/);
  }
  const html = renderToStaticMarkup(createElement(HomePerformanceChart, { daily: [{ date: "2026-09-06", leads: 0 }] }));
  assert.match(html, /No enquiries recorded/);
  assert.doesNotMatch(html, /Reporting unavailable/);
});
