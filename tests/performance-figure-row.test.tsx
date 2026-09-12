import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PerformanceFigureRow, compareTail } from "../src/components/monitor/PerformanceFigureRow.tsx";
import { changeBetween, formatCount, formatMoney } from "../src/components/ui/metric-card.tsx";
import {
  homePerformanceFromReporting,
  previousWeekTotals,
} from "../src/lib/home/home-safe-read-model.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import { resolveMonitorDateRange } from "../src/lib/monitor/dashboard-data.ts";
import type { MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";

const NOW = new Date("2026-09-06T08:00:00.000Z");
const SAMPLE_MONTH = buildSampleMetaMonitorPayload({ range: "last_30", now: NOW, connected: false });

function sample(input: Parameters<typeof buildSampleMetaMonitorPayload>[0] = {}): MetaMonitorPayload {
  return buildSampleMetaMonitorPayload({ now: NOW, connected: false, ...input });
}

function render(payload: MetaMonitorPayload): string {
  assert.ok(payload.summary, "the fixture has a summary");
  return renderToStaticMarkup(
    createElement(PerformanceFigureRow, {
      summary: payload.summary,
      range: payload.range,
      daily: payload.daily,
    }),
  );
}

/** The markup for one figure card, so a test can ask what that card holds. */
function card(html: string, key: string): string {
  const start = html.indexOf(`data-metric="${key}"`);
  assert.notEqual(start, -1, `no ${key} card in the figure row`);
  const next = html.indexOf("data-metric=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

test("Results leads with the four figures Home shows, in Home's order", () => {
  const html = render(sample({ range: "last_7" }));
  const order = [...html.matchAll(/data-metric="([a-z]+)"/g)].map((match) => match[1]);

  assert.deepEqual(order, ["spend", "clicks", "cpc", "leads"]);
  assert.match(html, /<h2[^>]*>Last 7 days<\/h2>/);
  assert.match(card(html, "spend"), /Spend/);
  assert.match(card(html, "clicks"), /Link clicks/);
  assert.match(card(html, "cpc"), /Cost per link click/);
  assert.match(card(html, "leads"), /Leads/);
});

test("each figure prints the period's own number, its line and its comparison", () => {
  const html = render(sample({ range: "last_7" }));

  // The demo fixture's trailing week: $1,200 over 1,497 clicks and 46 leads,
  // a cost per link click of $0.80.
  assert.match(card(html, "spend"), /\$1,200\.00/);
  assert.match(card(html, "clicks"), /1,497/);
  assert.match(card(html, "cpc"), /\$0\.80/);
  assert.match(card(html, "leads"), />46</);
  assert.equal((html.match(/vs prior week/g) ?? []).length, 4);
  // One line per figure, drawn from that figure's own days. The line is the
  // sparkline path; the comparison's arrow is an icon and must not be counted.
  for (const key of ["spend", "clicks", "cpc", "leads"]) {
    assert.match(card(html, key), /stroke-data/, `${key} draws no line`);
  }
});

test("a single day is a figure, not a trend", () => {
  const html = render(sample({ range: "today" }));

  assert.match(html, /<h2[^>]*>Today<\/h2>/);
  assert.equal((html.match(/stroke-data/g) ?? []).length, 0);
  assert.equal((html.match(/vs prior day/g) ?? []).length, 4);
});

test("a figure with nothing to divide by reads unavailable, with no comparison", () => {
  const payload = sample({ range: "last_7" });
  const summary = payload.summary!;
  const noClicks: MetaMonitorPayload = {
    ...payload,
    summary: { ...summary, clicks: 0 },
    daily: payload.daily.map((point) => ({ ...point, clicks: 0 })),
  };
  const html = render(noClicks);

  const cpc = card(html, "cpc");
  assert.match(cpc, /—/);
  assert.match(cpc, /Not reported/);
  assert.doesNotMatch(cpc, /vs previous/);
  assert.doesNotMatch(cpc, /stroke-data/);
  // The other three figures are untouched by one missing rate.
  assert.match(card(html, "leads"), />46</);
});

test("the customer's own span says its dates instead of a range name", () => {
  const html = render(
    sample({ range: "custom", customRange: { since: "2026-08-20", until: "2026-08-24" } }),
  );

  assert.match(html, /20 Aug/);
  assert.match(html, /24 Aug/);
  assert.doesNotMatch(html, /Custom range/);
});

test("a range the page cannot offer names its own length", () => {
  // Nothing borrows "prior week" for a window that is not one.
  assert.equal(compareTail(resolveMonitorDateRange("last_90", new Date("2026-09-06T08:00:00Z"))), "previous 90 days");
  assert.equal(compareTail(resolveMonitorDateRange("last_7", new Date("2026-09-06T08:00:00Z"))), "prior week");
  assert.equal(compareTail(resolveMonitorDateRange("today", new Date("2026-09-06T08:00:00Z"))), "prior day");
});

test("Home and Results print the same week for the same workspace", () => {
  // Home reads the trailing month and takes the last seven days out of it;
  // Results opens on the week itself. Both must land on one set of figures.
  const home = homePerformanceFromReporting(SAMPLE_MONTH);
  assert.ok(home);
  const html = render(sample({ range: "last_7" }));

  assert.match(card(html, "spend"), new RegExp(escape(formatMoney(home.performance.weekly.spend))));
  assert.match(card(html, "clicks"), new RegExp(escape(formatCount(home.performance.weekly.clicks))));
  assert.match(card(html, "leads"), new RegExp(`>${home.performance.weekly.leads}<`));
  assert.ok(home.performance.weekly.cpc !== null);
  assert.match(card(html, "cpc"), new RegExp(escape(formatMoney(home.performance.weekly.cpc))));

  // And they compare it against the same earlier week, so the same figure never
  // wears an up arrow on one surface and a down arrow on the other.
  const prior = previousWeekTotals(SAMPLE_MONTH.daily);
  assert.ok(prior);
  for (const [key, current, before] of [
    ["spend", home.performance.weekly.spend, prior.spend],
    ["clicks", home.performance.weekly.clicks, prior.clicks],
    ["leads", home.performance.weekly.leads, prior.leads],
  ] as const) {
    const change = changeBetween(current, before);
    assert.ok(change, `${key} has no comparison`);
    assert.match(card(html, key), new RegExp(`${change.percent}% vs prior week`));
  }
});

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
