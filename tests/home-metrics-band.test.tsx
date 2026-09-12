import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDashboard, type HomeData } from "../src/components/self-serve/home-dashboard.tsx";
import {
  homePerformanceFromReporting,
  previousWeekTotals,
  trailingWeekTotals,
} from "../src/lib/home/home-safe-read-model.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";

const SAMPLE = buildSampleMetaMonitorPayload({
  range: "last_30",
  now: new Date("2026-09-06T08:00:00.000Z"),
});

/** The fixture the reporting layer serves a workspace that has not connected Meta. */
const DISCONNECTED_SAMPLE: MetaMonitorPayload = buildSampleMetaMonitorPayload({
  range: "last_30",
  now: new Date("2026-09-06T08:00:00.000Z"),
  connected: false,
});

/** The markup for one metrics card, so a test can ask what that card holds. */
function card(html: string, key: string): string {
  const start = html.indexOf(`data-metric="${key}"`);
  assert.notEqual(start, -1, `no ${key} card in the band`);
  const next = html.indexOf("data-metric=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

function payloadWithSource(source: MetaMonitorPayload["source"]): MetaMonitorPayload {
  return { ...SAMPLE, connected: true, source };
}

function homeData(
  performance: HomeData["performance"],
  overrides: Partial<HomeData> = {},
): HomeData {
  return {
    workspaceName: "West Coast Home Co",
    hasBrand: true,
    hasProvider: true,
    ads: { created: 0, live: null, publishedThisWeek: 0 },
    performance,
    leads: [],
    leadsAreExamples: false,
    localAds: [],
    localAdsArea: null,
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
    ...overrides,
  } as HomeData;
}

test("weekly totals take the last seven points of the series", () => {
  // buildDaily emits one point per day across the range, so the array tail is
  // the trailing week. Sorting keeps a caller's ordering from changing the sum.
  const daily = [
    { date: "2026-08-29", spend: 60, clicks: 600, leads: 6 },
    { date: "2026-08-30", spend: 99, clicks: 990, leads: 9 },
    { date: "2026-08-31", spend: 1, clicks: 10, leads: 1 },
    { date: "2026-09-01", spend: 2, clicks: 20, leads: 2 },
    { date: "2026-09-02", spend: 3, clicks: 30, leads: 3 },
    { date: "2026-09-03", spend: 4, clicks: 40, leads: 4 },
    { date: "2026-09-04", spend: 5, clicks: 50, leads: 5 },
    { date: "2026-09-05", spend: 6, clicks: 60, leads: 6 },
    { date: "2026-09-06", spend: 7, clicks: 70, leads: 7 },
  ];

  const week = trailingWeekTotals(daily);
  assert.equal(week.spend, 28);
  assert.equal(week.clicks, 280);
  assert.equal(week.leads, 28);

  // A shorter series sums every point it has rather than inventing empty days.
  const short = trailingWeekTotals([daily[8], daily[1]]);
  assert.equal(short.spend, 106);
  assert.equal(short.clicks, 1060);
  assert.equal(short.leads, 16);
});

test("the prior week is the seven days before the trailing one", () => {
  const fortnight = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-08-${String(index + 24).padStart(2, "0")}`,
    spend: index + 1,
    clicks: (index + 1) * 10,
    leads: index + 1,
  }));

  const prior = previousWeekTotals(fortnight);
  assert.ok(prior);
  // Days 1 to 7, not the trailing days 8 to 14.
  assert.equal(prior.spend, 28);
  assert.equal(prior.clicks, 280);
  assert.equal(prior.leads, 28);
  assert.equal(trailingWeekTotals(fortnight).spend, 77);

  // A partial fortnight cannot support the comparison, so none is claimed.
  assert.equal(previousWeekTotals(fortnight.slice(0, 13)), null);
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
  // Leads join the week on the same window as the money and the clicks.
  assert.equal(weekly.leads, trailingWeekTotals(daily).leads);
  assert.equal(model.performance.isSample, false);
});

test("sample reporting is flagged so the band can label it", () => {
  const model = homePerformanceFromReporting(payloadWithSource("sample"));
  assert.ok(model);
  assert.equal(model.performance.isSample, true);
  assert.ok(model.performance.weekly.clicks > 0);
});

test("an unconnected workspace gets the demo band, still flagged as a demo", () => {
  const model = homePerformanceFromReporting(DISCONNECTED_SAMPLE);
  assert.ok(model);
  assert.equal(model.performance.isSample, true);
  assert.ok(model.performance.weekly.clicks > 0);
});

test("live reporting from a disconnected account is never presented as delivery", () => {
  // A live payload with no connection behind it is not this workspace's data,
  // and it is not a labelled demo either, so the band must not claim it.
  assert.equal(
    homePerformanceFromReporting({ ...payloadWithSource("live"), connected: false }),
    null,
  );
});

test("the band labels demo numbers instead of presenting them as delivery", () => {
  const model = homePerformanceFromReporting(DISCONNECTED_SAMPLE);
  assert.ok(model);
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(model.performance) }));

  // The demo tone is said once, in the note under the figures. A second badge
  // beside the heading only repeated it.
  assert.doesNotMatch(html, /Demo data/);
  assert.match(html, /Demo numbers for an example account, not yours\./);
  assert.match(html, /Connect Meta/);
  // The four figures the band owns, named the way the data actually reads, and
  // each one in the shared card surface rather than loose on the page.
  assert.match(html, /Spend/);
  assert.match(html, /Link clicks/);
  assert.match(html, /Cost per link click/);
  assert.equal(html.match(/data-metric=/g)?.length, 4);
  // The week's leads are the card's own figure, not the 30 day total.
  assert.match(card(html, "leads"), new RegExp(`>${model.performance.weekly.leads}<`));
  assert.equal(model.performance.weekly.leads, 46);
});

test("every card in the demo week draws its own line", () => {
  const model = homePerformanceFromReporting(DISCONNECTED_SAMPLE);
  assert.ok(model);
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(model.performance) }));

  // Spend, clicks, cost per click and leads all move across the demo week, so
  // each card carries a sparkline. Cost per link click used to be the exception:
  // the demo derived clicks from spend at one flat ratio, which left that card
  // with nothing to draw and read as a missing chart.
  for (const key of ["spend", "clicks", "cpc", "leads"]) {
    assert.match(card(html, key), /stroke-data/, `${key} draws no line`);
  }
});

test("a day with no clicks leaves the cost per link click card its line", () => {
  const model = homePerformanceFromReporting(DISCONNECTED_SAMPLE);
  assert.ok(model);
  const performance = model.performance;
  // One day of the trailing week with no clicks: it has no cost per click to
  // plot, and it must not take the rest of the week's line with it.
  const daily = performance.daily.map((point, index) =>
    index === performance.daily.length - 3 ? { ...point, spend: 0, clicks: 0 } : point,
  );
  const html = renderToStaticMarkup(
    createElement(HomeDashboard, { data: homeData({ ...performance, daily }) }),
  );

  assert.match(card(html, "cpc"), /stroke-data/);

  // Fewer than two days with a cost per click is not a shape, so that card
  // draws nothing rather than a line between one point and itself.
  const singleDay = performance.daily.map((point, index) => ({
    ...point,
    spend: index === performance.daily.length - 1 ? point.spend : 0,
    clicks: index === performance.daily.length - 1 ? point.clicks : 0,
  }));
  const singleHtml = renderToStaticMarkup(
    createElement(HomeDashboard, { data: homeData({ ...performance, daily: singleDay }) }),
  );
  assert.doesNotMatch(card(singleHtml, "cpc"), /stroke-data/);
});

test("the band claims a week and never a 30 day window", () => {
  const model = homePerformanceFromReporting(payloadWithSource("live"));
  assert.ok(model);
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(model.performance) }));

  assert.match(html, /Last 7 days/);
  assert.doesNotMatch(html, /This week/);
  assert.doesNotMatch(html, /Last 30 days/);
  assert.doesNotMatch(html, /Demo data/);
});

test("the band reports unavailable rather than guessing when reporting is absent", () => {
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(null) }));

  assert.match(html, /Last 7 days/);
  assert.match(html, /No reporting for this workspace yet\./);
  // It says what is missing and offers the one way forward, rather than
  // rendering three empty figure slots that read as a broken table.
  assert.match(html, /href="\/results"/);
  assert.match(html, /View performance/);
  assert.doesNotMatch(html, /Spend/);
  // A missing figure is never a zero, and never a demo dressed as delivery.
  assert.doesNotMatch(html, /\$0\.00/);
  assert.doesNotMatch(html, /Demo data/);
});

test("a workspace with no Meta connection is sent to connect, not to a report", () => {
  const html = renderToStaticMarkup(
    createElement(HomeDashboard, { data: homeData(null, { hasProvider: false }) }),
  );
  assert.match(html, /href="\/connect-meta"/);
});

test("the leads section says how many are waiting and offers the next action", () => {
  const empty = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData(null) }));
  assert.match(empty, /No leads yet/);
  assert.match(empty, /Create an ad/);

  const withLeads = renderToStaticMarkup(
    createElement(HomeDashboard, {
      data: homeData(null, {
        leads: [
          {
            id: "lead-1",
            name: "Ana Whitfield",
            suburb: "Scarborough",
            source: "Meta",
            createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        ],
      }),
    }),
  );
  assert.match(withLeads, /1 not yet followed up/);
  assert.match(withLeads, /Waiting 3 days/);
});
