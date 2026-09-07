import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { ResultsReporting } from "../src/components/homepage-concept/results-reporting.tsx";
import { REPORTS, EMAIL_CADENCES, emailSchedule, lineChartGeometry } from "../src/lib/homepage-concept/reporting.ts";

test("reporting explains dashboard and email control in fewer than 80 words", () => {
  const html = renderToStaticMarkup(createElement(ResultsReporting));
  for (const copy of ["No more", "chasing updates.", "Your dashboard.", "Emails on your schedule.", "Example data", "Nothing sent or saved.", "No card required."]) assert.ok(html.includes(copy), copy);
  for (const option of EMAIL_CADENCES) assert.ok(html.includes(`value="${option.id}"`));
  const words = html.replace(/<[^>]+>/g, " ").trim().split(/\s+/);
  assert.ok(words.length < 80, `${words.length} words is too much copy`);
  assert.match(html, /href="#trial"/);
  assert.match(html, /id="results"/);
  assert.match(html, /aria-label="Dashboard reporting period"/);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Last 7 days:/);
  assert.match(html, /class="hc-chart-line"/);
  assert.doesNotMatch(html, /hc-chart-bars|<table|hc-email-signoff|style="opacity:0(?:;|")|mailto:|tel:/);
});

test("line chart faithfully represents both reporting periods", () => {
  for (const [id, report] of Object.entries(REPORTS)) {
    assert.equal(report.points.reduce((sum, n) => sum + n, 0), report.leads);
    assert.equal(report.labels.length, report.points.length);
    assert.equal(report.spend / report.leads, 18);
    const maximum = id === "week" ? 4 : 24;
    const chart = lineChartGeometry(report.points, maximum);
    assert.match(chart.line, /^M8,/);
    assert.equal((chart.line.match(/L/g) ?? []).length, report.points.length - 1);
    assert.equal(chart.end.x, 592);
    assert.equal(chart.end.y, 188 - report.points[report.points.length - 1] / maximum * 176);
    assert.ok(chart.area.endsWith("L8,188 Z"));
  }
  assert.equal(lineChartGeometry([], 4).area, "");
});

test("email schedule supports daily, weekly and bounded custom intervals", () => {
  assert.equal(emailSchedule("weekly", 3), "Every Monday, 8:00 am");
  assert.equal(emailSchedule("daily", 3), "Every day, 8:00 am");
  assert.equal(emailSchedule("custom", 14), "Every 14 days, 8:00 am");
  assert.equal(emailSchedule("custom", 0), "Every day, 8:00 am");
  assert.equal(emailSchedule("custom", 99), "Every 30 days, 8:00 am");
  assert.equal(emailSchedule("custom", NaN), "Every 3 days, 8:00 am");
});

test("reporting stays isolated, initially visible and reduced-motion aware", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  const fixture = await readFile(new URL("../src/lib/homepage-concept/reporting.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + fixture, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval/);
  assert.match(source, /useReducedMotion/);
  assert.match(source, /initial=\{reducedMotion \|\| instant \? false/);
  assert.match(source, /setInstant\(event.detail === 0\)/);
  assert.match(source, /onKeyDown=\{\(\) => setInstant\(true\)\}/);
});
