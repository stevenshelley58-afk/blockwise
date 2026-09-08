import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDemoOutreachReport } from "../src/lib/outreach/fixtures.ts";
import { previewSegment } from "../src/lib/outreach/preview-options.ts";
const view = readFileSync("src/components/outbound-report/report-view.tsx", "utf8");
test("all recipient states retain local peer examples", () => {
  for (const segment of ["recent_ads_observed", "no_ads_found_after_successful_recent_scan", "unknown"] as const) { const report = buildDemoOutreachReport(segment); assert.equal(report.adExamples.length, 6); assert.equal(report.prospectAdExamples.length, segment === "recent_ads_observed" ? 1 : 0); }
  assert.doesNotMatch(view, /report.segment === "unknown" \? <UnknownState/);
  assert.match(view, /examples.length \?/);
});
test("preview parameters are restricted to known segments", () => { assert.equal(previewSegment("arbitrary"), "recent_ads_observed"); assert.equal(previewSegment("unknown"), "unknown"); });
test("report has one signup action and no private CRM fields or inferred category defaults", () => { assert.equal((view.match(/Create my first ad free/g) ?? []).length, 1); assert.doesNotMatch(view, /contactEmail|consentBasis|contactProvenance|private report|[—]/u); assert.match(view, /category \?\? "other"/); });
test("preview pages are complete, noindex and use one shared fixture", () => { for (const file of ["src/app/ad-reports/demo/page.tsx", "src/app/ad-reports/demo/email/page.tsx"]) { const source = readFileSync(file,"utf8"); assert.match(source,/export default async function/); assert.match(source,/index: false/); assert.match(source,/outreach\/fixtures/); } });
