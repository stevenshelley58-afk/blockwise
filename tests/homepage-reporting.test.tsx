import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { ResultsReporting } from "../src/components/homepage-concept/results-reporting.tsx";
import { REPORTS, lineChartGeometry } from "../src/lib/homepage-concept/reporting.ts";
import { REPORT_EMAIL } from "../src/lib/homepage-concept/reporting-email.ts";

test("reporting sells live visibility and scheduled updates with minimal copy", () => {
  const html = renderToStaticMarkup(createElement(ResultsReporting));
  for (const copy of [
    "See your leads. Know your costs.",
    "Track your leads, cost per lead and ad spend in one simple dashboard. Get email updates as often or as little as you like.",
    "Leads generated",
    "Cost per lead",
    "Ad spend",
    "Email update",
    REPORT_EMAIL.subject,
    REPORT_EMAIL.intro,
    REPORT_EMAIL.metrics[0].label,
    REPORT_EMAIL.footer.text,
    "7 days",
    "30 days",
    "Email",
    "Start free trial",
    "No card required.",
  ]) assert.ok(html.includes(copy), copy);
  const words = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/);
  assert.ok(words.length < 120, `${words.length} words is too much copy`);
  assert.match(html, /id="results"/);
  assert.match(html, /aria-label="Dashboard reporting period"/);
  assert.equal((html.match(/aria-pressed=/g) ?? []).length, 3, "selector keeps three real buttons mounted");
  assert.match(html, /aria-label="7 days"/);
  assert.match(html, /aria-label="30 days"/);
  assert.match(html, /aria-label="Email"/);
  assert.match(html, /class="hc-reporting-view-stack"/);
  assert.match(html, /class="hc-reporting-view hc-reporting-view--chart"/);
  assert.match(html, /class="hc-reporting-view hc-reporting-view--email"/);
  assert.doesNotMatch(html, /Example data/);
  assert.doesNotMatch(html, /hc-email-update|hc-email-controls|hc-chart-line-base/);
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
  const emailFixture = await readFile(new URL("../src/lib/homepage-concept/reporting-email.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + fixture + emailFixture, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval/);
  assert.match(source, /useReducedMotion/);
  assert.match(source, /durations\.entrance/);
  assert.match(source, /useInView\(chartRef, \{ once: false, amount: 0.4 \}\)/);
  assert.match(source, /animate=\{\{ d: chart\.line \}\}/);
  assert.match(source, /layoutId="active-range"/);
  assert.match(source, /REPORT_RANGES: readonly ReportingView\[\] = \["week", "month", "email"\]/);
  assert.match(source, /REPORT_EMAIL\.footer\.links\.slice\(0, 1\)/);
  assert.match(source, /hc-reporting-view--email/);
  assert.match(source, /aria-hidden=\{view !== "email"\}/);
  assert.match(source, /inert=\{view !== "email"\}/);
  assert.match(source, /initial=\{false\}/);
  assert.match(source, /if \(id !== "email"\) setRange\(id\)/);
  assert.match(source, /reducedMotion \? 0 : view === "email"/);
  assert.match(source, /type="button"/);
  assert.match(source, /transition=\{\{ duration: reducedMotion \|\| instant \? 0 : durations\.state/);
  assert.match(source, /reportingReveal.duration/);
  assert.match(source, /setInstant\(event\.detail === 0\)/);
  assert.match(source, /report\.labels\.map/);
  assert.match(source, /key=\{`\$\{range\}-\$\{cycle\}`\}/);
  assert.match(source, /duration: reducedMotion \|\| !inView \? 0 : reportingReveal\.duration/);
  assert.match(source, /width: reducedMotion \|\| inView \? 608 : 0/);

  const conceptCss = await readFile(new URL("../src/app/concept/concept.css", import.meta.url), "utf8");
  assert.match(conceptCss, /\.hc-root \.hc-report-email-metrics[\s\S]*margin: 19px 0 18px/);
  assert.match(conceptCss, /\.hc-report-range[\s\S]*flex-shrink: 0/);
  assert.match(conceptCss, /\.hc-report-range button[\s\S]*white-space: nowrap/);
  assert.match(conceptCss, /flex-wrap: wrap[\s\S]*padding-block: 12px/);
  assert.match(conceptCss, /\.hc-reporting-view--email[\s\S]*padding-bottom: 24px/);

  const motionSource = await readFile(new URL("../src/lib/motion.ts", import.meta.url), "utf8");
  assert.match(motionSource, /reportingReveal = \{\s*duration: 1\.5,/);
});

test("requested reporting loop follows draw completion and respects interaction", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  assert.match(source, /onAnimationComplete=/);
  assert.match(source, /definition.width === 608/);
  assert.match(source, /view !== "email" && !drawFinished/);
  assert.match(source, /!inView \|\| paused \|\| reducedMotion \|\| pageHidden/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /Pause automatic preview/);
  assert.match(source, /Play automatic preview/);
  assert.match(source, /onFocusCapture=\{\(\) => setPaused\(true\)\}/);
  assert.match(source, /setCycle\(\(value\) => value \+ 1\)/);
  assert.match(source, /reportingLoop.emailHold : reportingLoop.chartHold/);
  assert.match(source, /delay: cycle > 0/);
});
