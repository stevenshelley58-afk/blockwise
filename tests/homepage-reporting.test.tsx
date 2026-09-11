import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REPORTS, REPORT_EXAMPLE, lineChartGeometry } from "../src/lib/homepage-concept/reporting.ts";
import { LEAD_EMAIL_TEMPLATE } from "../src/lib/homepage-concept/lead-email.ts";

/** Comments are not rendered copy, so copy checks ignore them. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\n)[ \t]*\/\/[^\n]*/g, "$1");

test("reporting keeps honest example metrics and one safe lead", () => {
  assert.equal(REPORT_EXAMPLE.campaign, "Free property appraisal");
  assert.equal(REPORT_EXAMPLE.agency, "West Coast Home Co");
  assert.equal(REPORT_EXAMPLE.status, "Example data");
  assert.ok(REPORT_EXAMPLE.lead.email.endsWith("@example.com"));
  assert.match(REPORT_EXAMPLE.lead.phone, /·/);

  for (const report of Object.values(REPORTS)) {
    assert.equal(report.points.reduce((sum, value) => sum + value, 0), report.leads);
    assert.equal(report.spend / report.leads, 18);
    assert.equal(report.labels.length, report.points.length);
  }

  // The example lead email is labelled as an example and addresses nobody.
  assert.equal(LEAD_EMAIL_TEMPLATE.previewLabel, "New lead email");
  assert.doesNotMatch(JSON.stringify(LEAD_EMAIL_TEMPLATE), /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
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
  const emailPreview = await readFile(new URL("../src/components/homepage-concept/lead-email-preview.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/components/homepage-concept/results-reporting.css", import.meta.url), "utf8");
  const fixtures = await readFile(new URL("../src/lib/homepage-concept/reporting.ts", import.meta.url), "utf8");
  const emailFixtures = await readFile(new URL("../src/lib/homepage-concept/lead-email.ts", import.meta.url), "utf8");

  for (const required of [
    "See your leads. Know your costs.",
    "Interactive example report",
    "Example report view",
    "TRIAL_SIGNUP_URL",
    "TRIAL_CTA_LABEL",
    "Static preview — nothing is sent.",
  ]) assert.ok(source.includes(required) || emailPreview.includes(required), required);

  assert.match(source, /REPORT_VIEWS: readonly ReportingView\[\] = \["week", "month", "email"\]/);
  assert.match(source, /aria-label="Example report view"/);
  assert.match(source, /role="img"/);
  assert.match(source, /onPointerMove=\{inspectPoint\}/);
  // The visitor drives the views, and the tour timers are cleaned up.
  assert.match(source, /aria-pressed=\{view === id\}/);
  assert.match(source, /window\.clearTimeout/);
  assert.match(emailPreview, /LEAD_EMAIL_TEMPLATE/);

  // No network, storage, analytics, polling or contact side effects in the demo.
  assert.doesNotMatch(
    source + emailPreview + fixtures + emailFixtures,
    /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|mailto:|tel:|setInterval/,
  );
  assert.doesNotMatch(source + emailPreview, /AnimatePresence|LayoutGroup|motion\.|useInView|onAnimationComplete|Play|Pause/);
  // No em dashes in rendered copy.
  assert.doesNotMatch(withoutComments(source + emailPreview + fixtures + emailFixtures), /\u2014/);

  assert.match(css, /^\/\* Hallmark/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\.hc-reporting|transition:\s*all/);
});