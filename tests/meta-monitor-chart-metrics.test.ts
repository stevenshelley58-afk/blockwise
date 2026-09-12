import assert from "node:assert/strict";
import test from "node:test";

import { CHART_METRICS, DEFAULT_CHART_METRIC, chartSeries } from "../src/lib/meta-monitor/chart-metrics.ts";
import { buildSampleMetaMonitorPayload } from "../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import { performance as performanceCopy } from "../src/config/niche/blockwise/performance.ts";
import { buildDaily } from "../src/lib/meta-monitor/getMetaMonitorData.ts";

const sample = buildSampleMetaMonitorPayload({
  range: "last_30",
  now: new Date("2026-09-06T08:00:00.000Z"),
});

test("every chart metric is offered once, most important first", () => {
  const keys = CHART_METRICS.map((metric) => metric.key);

  assert.deepEqual(keys, [
    "leads",
    "cpl",
    "spend",
    "reach",
    "impressions",
    "clicks",
    "cpc",
    "ctr",
    "validRate",
  ]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(DEFAULT_CHART_METRIC, keys[0]);
  // The menu opens on leads, which is what the product sells.
  assert.equal(CHART_METRICS[0].key, "leads");
});

test("every chart metric has copy and can read the demo payload", () => {
  const copy = performanceCopy;
  const series = chartSeries(sample.daily, CHART_METRICS[0]);

  assert.equal(series.length, sample.daily.length);

  for (const metric of CHART_METRICS) {
    const label = copy.charts[metric.key];
    assert.equal(typeof label, "string", `${metric.key} needs a label`);
    assert.ok(label.length > 0, `${metric.key} label is empty`);

    const points = chartSeries(sample.daily, metric).filter((point) => typeof point.value === "number");
    assert.ok(points.length > 0, `${metric.key} charts nothing from the demo`);
    for (const point of points) {
      assert.ok(Number.isFinite(point.value), `${metric.key} produced ${point.value}`);
    }

    // A gap note is exactly what a ratio metric needs, and nothing else.
    if (metric.gap) {
      assert.equal(typeof copy.chartGaps[metric.gap], "string");
      assert.ok(copy.chartGaps[metric.gap].length > 0);
    }
  }
});

test("the daily sample carries delivery alongside spend, clicks and leads", () => {
  let impressions = 0;
  let reach = 0;

  for (const point of sample.daily) {
    assert.ok(point.impressions > 0, `${point.date} has no impressions`);
    assert.ok(point.reach > 0, `${point.date} has no reach`);
    assert.ok(point.reach <= point.impressions, `${point.date} reaches more people than it shows ads to`);
    impressions += point.impressions;
    reach += point.reach;
  }

  // The demo stays internally consistent: the chart's daily delivery lands near
  // the figure the summary reports for the same month.
  const summary = sample.summary!;
  assert.ok(Math.abs(impressions - summary.impressions) / summary.impressions < 0.05);
  assert.ok(Math.abs(reach - summary.reach) / summary.reach < 0.05);
});

test("a metric with a gap leaves the day out rather than plotting a zero", () => {
  const cpl = CHART_METRICS.find((metric) => metric.key === "cpl")!;
  const quiet = sample.daily.map((point) => ({ ...point, validLeads: 0, validCpl: null }));

  assert.deepEqual(chartSeries(quiet, cpl).map((point) => point.value), quiet.map(() => null));
});

test("the live daily series adds ad rows into one point per day", () => {
  const rows = [
    { date_start: "2026-09-01", spend: "10.50", clicks: "7", impressions: "1200", reach: "900", actions: [] },
    { date_start: "2026-09-01", spend: "4.25", clicks: "3", impressions: "800", reach: "500", actions: [] },
    { date_start: "2026-09-02", spend: "2", clicks: "1", impressions: "300", reach: "250", actions: [] },
  ];
  const daily = buildDaily(rows, { validByDate: new Map([["2026-09-02", 2]]), leadsByDate: new Map() }, {
    key: "last_7",
    label: "Last 7 days",
    since: "2026-09-01",
    until: "2026-09-03",
    days: 3,
  });

  assert.equal(daily.length, 3);
  assert.deepEqual(
    daily.map((point) => [point.date, point.spend, point.clicks, point.impressions, point.reach]),
    [
      ["2026-09-01", 14.75, 10, 2000, 1400],
      ["2026-09-02", 2, 1, 300, 250],
      // A day the account did not deliver keeps its zeros instead of vanishing.
      ["2026-09-03", 0, 0, 0, 0],
    ],
  );
  assert.equal(daily[1].validLeads, 2);
  assert.equal(daily[1].validCpl, 1);
});
