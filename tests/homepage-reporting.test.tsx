import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { ResultsReporting } from "../src/components/homepage-concept/results-reporting.tsx";
import { REPORTS, lineChartGeometry } from "../src/lib/homepage-concept/reporting.ts";

test("reporting sells live visibility and scheduled updates with minimal copy", () => {
  const html = renderToStaticMarkup(createElement(ResultsReporting));
  for (const copy of [
    "See your leads. Know your costs.",
    "Track your leads, cost per lead and ad spend in one simple dashboard. Get email updates as often or as little as you like.",
    "Leads generated",
    "Cost per lead",
    "Ad spend",
    "In your inbox",
    "Performance update",
    "Start free trial",
    "No card required.",
  ]) assert.ok(html.includes(copy), copy);
  const words = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/);
  assert.ok(words.length < 90, `${words.length} words is too much copy`);
  assert.match(html, /id="results"/);
  assert.match(html, /aria-label="Dashboard reporting period"/);
  assert.doesNotMatch(html, /Example data/);
  assert.doesNotMatch(html, /hc-email-controls|hc-chart-line-base/);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Last 7 days:/);
  assert.match(html, /class="hc-chart-line"/);
  assert.match(html, /clip-path="url/);
  assert.doesNotMatch(html, /hc-chart-bars|<table|hc-email-signoff|mailto:|tel:/);
});

test("line chart faithfully represents and can morph between both periods", () => {
  const pointCounts = new Set<number>();
  for (const [id, report] of Object.entries(REPORTS)) {
    assert.equal(report.points.reduce((sum, n) => sum + n, 0), report.leads);
    assert.equal(report.labels.length, report.points.length);
    assert.equal(report.spend / report.leads, 18);
    pointCounts.add(report.points.length);
    const maximum = id === "week" ? 4 : 12;
    const chart = lineChartGeometry(report.points, maximum);
    assert.match(chart.line, /^M8,/);
    assert.equal(chart.vertices.length, report.points.length);
    assert.equal((chart.line.match(/C/g) ?? []).length, report.points.length - 1);
    assert.equal(chart.end.x, 592);
    assert.equal(chart.end.y, 188 - report.points[report.points.length - 1] / maximum * 176);
    assert.ok(chart.area.endsWith("L8,188 Z"));
  }
  assert.equal(pointCounts.size, 1, "both ranges need matching path commands for a smooth morph");
  assert.equal(lineChartGeometry([], 4).area, "");
});

test("reporting stays isolated and follows the shared motion rules", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  const fixture = await readFile(new URL("../src/lib/homepage-concept/reporting.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + fixture, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval/);
  assert.match(source, /useReducedMotion/);
  assert.match(source, /durations\.entrance/);
  assert.match(source, /useInView\(chartRef, \{ once: false, amount: 0.4 \}\)/);
  assert.match(source, /animate=\{\{ d: chart\.line \}\}/);
  assert.match(source, /layoutId="active-range"/);
  assert.match(source, /reportingReveal.duration/);
  assert.match(source, /setInstant\(event\.detail === 0\)/);
  assert.match(source, /report\.labels\.map/);
  assert.match(source, /key=\{range\}/);
  assert.match(source, /duration: reducedMotion \|\| !inView \? 0 : reportingReveal\.duration/);
  assert.match(source, /width: reducedMotion \|\| inView \? 608 : 0/);

  const motionSource = await readFile(new URL("../src/lib/motion.ts", import.meta.url), "utf8");
  assert.match(motionSource, /reportingReveal = \{\s*duration: 1\.5,/);
});
