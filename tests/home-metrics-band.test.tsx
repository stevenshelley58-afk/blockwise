import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDashboard, type HomeData } from "../src/components/self-serve/home-dashboard.tsx";
import {
  homePerformanceFromReporting,
  trailingWeekTotals,
} from "../src/lib/home/home-safe-read-model.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";

const SAMPLE = buildSampleMetaMonitorPayload({
  range: "last_30",
  now: new Date("2026-09-06T08:00:00.000Z"),
});

function payloadWithSource(source: MetaMonitorPayload["source"]): MetaMonitorPayload {
  return { ...SAMPLE, connected: true, source };
}

function homeData(performance: HomeData["performance"]): HomeData {
  return {
    workspaceName: "West Coast Home Co",
    hasBrand: true,
    hasProvider: true,
    ads: { created: 0, live: null, publishedThisWeek: 0 },
    performance,
    leads: [],
    perthAds: [],
    activation: {
      currentStage: "brand",
      nextAction: "brand",
      resumePath: "/ad-studio/brand",
      completed: 1,
      total: 3,
      milestones: {},
      foundationAvailable: true,
    },
    credits: {
      granted: 10,
      used: 0,
      reserved: 0,
      remaining: 10,
      entitlementType: "trial",
      periodStart: null,
      periodEnd: null,
    },
    plan: {
      accessState: "trialing",
      currency: "AUD",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      latestInvoiceStatus: null,
    },
    meta: { state: "not_connected", accountName: null },
    booking: { state: "not_booked" },
  } as HomeData;
}

test("weekly totals take the last seven points of the series", () => {
  // buildDaily emits one point per day across the range, so the array tail is
  // the trailing week. Sorting keeps a caller's ordering from changing the sum.
  const daily = [
    { date: "2026-08-29", spend: 60, clicks: 600 },
    { date: "2026-08-30", spend: 99, clicks: 990 },
    { date: "2026-08-31", spend: 1, clicks: 10 },
    { date: "2026-09-01", spend: 2, clicks: 20 },
    { date: "2026-09-02", spend: 3, clicks: 30 },
    { date: "2026-09-03", spend: 4, clicks: 40 },
    { date: "2026-09-04", spend: 5, clicks: 50 },
    { date: "2026-09-05", spend: 6, clicks: 60 },
    { date: "2026-09-06", spend: 7, clicks: 70 },
  ];

  const week = trailingWeekTotals(daily);
  assert.equal(week.spend, 28);
  assert.equal(week.clicks, 280);

  // A shorter series sums every point it has rather than inventing empty days.
  const short = trailingWeekTotals([daily[8], daily[1]]);
  assert.equal(short.spend, 106);
  assert.equal(short.clicks, 1060);
});

test("weekly figure is the trailing seven days, not the 30 day total", () => {
  const model = homePerformanceFromReporting(payloadWithSource("live"));
  assert.ok(model);
  const { daily, weekly } = model.performance;

  // The band claims a week, so it must never echo the snapshot's 30 day totals.
  assert.equal(daily.length, 30);
  assert.equal(weekly.spend, trailingWeekTotals(daily).spend);
  assert.ok(weekly.spend < model.performance.daily.reduce((total, point) => total + point.spend, 0));
  assert.ok(weekly.clicks > 0);
  assert.ok(weekly.cpc !== null);
  assert.equal(weekly.cpc, weekly.spend / weekly.clicks);
  assert.equal(model.performance.isSample, false);
});

test("sample reporting is flagged so the band can label it", () => {
  const model = homePerformanceFromReporting(payloadWithSource("sample"));
  assert.ok(model);
  assert.equal(model.performance.isSample, true);
  assert.ok(model.performance.weekly.clicks > 0);
});

test("the band labels sample numbers instead of presenting them as delivery", () => {
  const model = homePerformanceFromReporting(payloadWithSource("sample"));
  assert.ok(model);
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(model.performance) }));

  assert.match(html, /Sample data/);
  assert.match(html, /not your account/);
  assert.match(html, /Cost per click/);
  assert.match(html, /Clicks/);
  assert.match(html, /Spend/);
});

test("the band claims a week and never a 30 day window", () => {
  const model = homePerformanceFromReporting(payloadWithSource("live"));
  assert.ok(model);
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(model.performance) }));

  assert.match(html, /This week/);
  assert.match(html, /Last 7 days/);
  assert.doesNotMatch(html, /Last 30 days/);
});

test("the band renders nothing rather than guessing when reporting is absent", () => {
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(null) }));
  assert.doesNotMatch(html, /This week/);
  assert.doesNotMatch(html, /Sample data/);
});
