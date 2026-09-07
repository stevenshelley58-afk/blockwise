import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { ResultsReporting } from "../src/components/homepage-concept/results-reporting.tsx";
import { REPORTS, EMAIL_CADENCES, exampleEmail } from "../src/lib/homepage-concept/reporting.ts";

test("reporting sells visibility and email control without another creation walkthrough", () => {
  const html = renderToStaticMarkup(createElement(ResultsReporting));
  for (const copy of ["No guesswork.", "No chasing updates.", "waiting for an agency report", "Your ad overview", "Or just check your inbox.", "Example data", "Nothing is saved or sent.", "No card required."]) assert.ok(html.includes(copy), copy);
  for (const option of EMAIL_CADENCES) assert.ok(html.includes(`value="${option.id}"`));
  assert.match(html, /href="#trial"/);
  assert.match(html, /id="results"/);
  assert.match(html, /aria-label="Dashboard reporting period"/);
  assert.match(html, /role="img" aria-label="Last 7 days:/);
  assert.doesNotMatch(html, /style="opacity:0(?:;|")/);
  assert.doesNotMatch(html, /Approve example budget|Create your ad|mailto:|tel:/);
});

test("dashboard chart, campaigns and metrics agree for both periods", () => {
  for (const report of Object.values(REPORTS)) {
    assert.equal(report.points.reduce((sum, n) => sum + n, 0), report.leads);
    assert.equal(report.campaigns.reduce((sum, item) => sum + item.leads, 0), report.leads);
    assert.equal(report.campaigns.reduce((sum, item) => sum + item.spend, 0), report.spend);
    assert.equal(report.labels.length, report.points.length);
    assert.equal(report.spend / report.leads, 18);
  }
});

test("email preview changes cadence, uses matching figures and bounds custom intervals", () => {
  const weekly = exampleEmail("weekly", 3);
  assert.equal(weekly.leads, REPORTS.week.leads);
  assert.equal(weekly.spend, REPORTS.week.spend);
  assert.equal(weekly.schedule, "Every Monday, 8:00 am");
  assert.equal(exampleEmail("daily", 3).schedule, "Every day, 8:00 am");
  assert.equal(exampleEmail("custom", 14).schedule, "Every 14 days, 8:00 am");
  assert.equal(exampleEmail("custom", 14).period, "Last 14 days");
  assert.equal(exampleEmail("custom", 7).leads, weekly.leads);
  assert.equal(exampleEmail("custom", 30).leads, REPORTS.month.leads);
  for (const days of [0, 1, 3, 14, 30, 99, NaN]) {
    const email = exampleEmail("custom", days);
    assert.ok(email.leads >= 3 && email.leads <= 62);
    assert.equal(email.spend / email.leads, 18);
  }
});

test("reporting remains an isolated, reduced-motion-aware client illustration", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  const fixture = await readFile(new URL("../src/lib/homepage-concept/reporting.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + fixture, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval/);
  assert.match(source, /useReducedMotion/);
  assert.match(source, /initial=\{false\}/);
  assert.match(source, /setInstant\(event.detail === 0\)/);
  assert.match(source, /onKeyDown=\{\(\) => setInstant\(true\)\}/);
});
