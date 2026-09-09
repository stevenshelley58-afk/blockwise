import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REPORTS, REPORT_EXAMPLE, lineChartGeometry } from "../src/lib/homepage-concept/reporting.ts";
import { REPORT_EMAIL, REPORT_EMAIL_FREQUENCIES } from "../src/lib/homepage-concept/reporting-email.ts";

test("reporting keeps honest example metrics and one safe lead", () => {
  assert.equal(REPORT_EXAMPLE.campaign, "Free property appraisal");
  assert.equal(REPORT_EXAMPLE.agency, "West Coast Home Co");
  assert.equal(REPORT_EXAMPLE.status, "Example data");
  assert.ok(REPORT_EXAMPLE.lead.email.endsWith("@example.com"));
  assert.match(REPORT_EXAMPLE.lead.phone, /·/);
  assert.deepEqual(REPORT_EMAIL_FREQUENCIES.map((option) => option.label), ["Weekly", "Monthly", "Off"]);
  assert.match(REPORT_EMAIL.subject, /^Example:/);

  for (const report of Object.values(REPORTS)) {
    assert.equal(report.points.reduce((sum, value) => sum + value, 0), report.leads);
    assert.equal(report.spend / report.leads, 18);
    assert.equal(report.labels.length, report.points.length);
  }
});

test("line chart geometry represents each fixture without extra values", () => {
  for (const [id, report] of Object.entries(REPORTS)) {
    const chart = lineChartGeometry(report.points, id === "week" ? 4 : 12);
    assert.match(chart.line, /^M8,/);
    assert.equal(chart.vertices.length, report.points.length);
    assert.equal((chart.line.match(/C/g) ?? []).length, report.points.length - 1);
    assert.equal(chart.end.x, 592);
    assert.ok(chart.area.endsWith("L8,188 Z"));
  }
  assert.equal(lineChartGeometry([], 4).area, "");
});

test("reporting demo is manual, isolated and explicit about side effects", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-reporting.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/components/homepage-concept/results-reporting.css", import.meta.url), "utf8");
  const fixtures = await readFile(new URL("../src/lib/homepage-concept/reporting.ts", import.meta.url), "utf8");
  const emailFixtures = await readFile(new URL("../src/lib/homepage-concept/reporting-email.ts", import.meta.url), "utf8");

  for (const required of [
    "See your leads. Know your costs.",
    "Example report",
    "Email updates",
    "Example ad",
    "You follow up",
    "Blockwise does not contact the lead for you.",
    "Illustrative email preview",
    "Nothing is fetched, saved or emailed.",
    "TRIAL_SIGNUP_URL",
    "TRIAL_CTA_LABEL",
  ]) assert.ok(source.includes(required), required);

  assert.match(source, /REPORT_VIEWS: readonly ReportingView\[\] = \["week", "month", "email"\]/);
  assert.match(source, /aria-label="Example report view"/);
  assert.match(source, /role="img"/);
  assert.match(source, /onPointerMove=\{inspectPoint\}/);
  assert.match(source, /<select value=\{frequency\}/);
  assert.doesNotMatch(source + fixtures + emailFixtures, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval|setTimeout|mailto:|tel:|\u2014/);
  assert.doesNotMatch(source, /AnimatePresence|LayoutGroup|motion\.|useInView|onAnimationComplete|Play|Pause/);
  assert.match(css, /^\/\* Hallmark/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.hc-reporting|transition:\s*all/);
});
