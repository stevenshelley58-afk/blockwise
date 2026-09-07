import assert from "node:assert/strict";
import test from "node:test";
import { buildOutreachEmail, buildOutreachFollowUpEmail, classifyEvidence, evaluateOutreachEligibility, toPublicOutreachReport, selectPeerExamples, publicOutreachReportSchema, type EvidenceSegment } from "../src/lib/outreach/postcode-campaign.ts";
import { DEMO_OUTREACH_NOW as now, DEMO_OUTREACH_SNAPSHOT as area, demoProspect, buildDemoOutreachPreview } from "../src/lib/outreach/fixtures.ts";
import { importOutreachDraft, loadPublicOutreachReport, snapshotFingerprint } from "../src/lib/outreach/repository.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
const person = (segment: EvidenceSegment = "recent_ads_observed") => ({ ...demoProspect(segment), isDemo: false });
const input = () => ({ snapshot: area, prospect: person(), reportUrl: "https://blockwise.sale/ad-reports/" + "a".repeat(43), businessIdentity: "Blockwise", unsubscribeUrl: "https://blockwise.sale/unsubscribe/example", now });

test("failed, stale, future and incomplete scans cannot become absence claims", () => {
  const evidence = person("no_ads_found_after_successful_recent_scan").advertisingEvidence;
  for (const override of [{ completed: false }, { scopeVerified: false }, { scannedAt: "2025-01-01T00:00:00Z" }, { scannedAt: "2027-01-01T00:00:00Z" }]) assert.equal(classifyEvidence({ ...evidence, ...override }, now).segment, "unknown");
  assert.equal(classifyEvidence(evidence, now).segment, "no_ads_found_after_successful_recent_scan");
});

test("one area supports three independent prospect segments, including neutral unknown", () => {
  for (const segment of ["recent_ads_observed", "no_ads_found_after_successful_recent_scan", "unknown"] as const) {
    const result = evaluateOutreachEligibility(area, person(segment), now);
    assert.equal(result.segment, segment); assert.equal(result.eligible, true);
    assert.equal(toPublicOutreachReport(area, person(segment), now).adExamples.length, 6);
  }
});

test("eligibility fails closed for stale area coverage, consent, suppression and insufficient peers", () => {
  assert.equal(evaluateOutreachEligibility({ ...area, evidence: { ...area.evidence, completed: false } }, person(), now).eligible, false);
  assert.equal(evaluateOutreachEligibility({ ...area, adExamples: [] }, person(), now).eligible, false);
  assert.equal(evaluateOutreachEligibility(area, { ...person(), consentRecordedAt: null }, now).eligible, false);
  assert.equal(evaluateOutreachEligibility(area, { ...person(), suppressionClear: false }, now).eligible, false);
  assert.equal(evaluateOutreachEligibility(area, { ...person(), postcode: "6001" }, now).eligible, false);
  assert.equal(evaluateOutreachEligibility(area, demoProspect(), now).eligible, false);
});

test("peer selection deduplicates and excludes the recipient agency", () => {
  const own = person().prospectAdExamples[0]!;
  const selected = selectPeerExamples({ ...area, adExamples: [own, area.adExamples[0]!, area.adExamples[0]!, area.adExamples[1]!] }, person());
  assert.deepEqual(selected.map(ad => ad.id), ["sample-1", "sample-2"]);
});

test("public projection strips CRM fields and requires both rights and allowed media origin", () => {
  const media = { ...area.adExamples[0]!, mediaUrl: "https://assets.example.test/a.png", mediaRightsConfirmed: true };
  const snapshot = { ...area, adExamples: [media, ...area.adExamples.slice(1)] };
  assert.equal(toPublicOutreachReport(snapshot, person(), now).adExamples[0]!.mediaUrl, null);
  assert.equal(toPublicOutreachReport(snapshot, person(), now, ["https://assets.example.test"]).adExamples[0]!.mediaUrl, media.mediaUrl);
  const report = toPublicOutreachReport(snapshot, person(), now);
  assert.equal(JSON.stringify(report).includes("sample@example.test"), false);
  const parsed = publicOutreachReportSchema.parse({ ...report, privateNotes: "secret", prospect: { ...report.prospect, contactEmail: "secret" } });
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
});

test("segment-specific email uses the same clock, two peers, Steven and a genuine unsubscribe link", () => {
  const observed = buildOutreachEmail(input());
  const noAds = buildOutreachEmail({ ...input(), prospect: person("no_ads_found_after_successful_recent_scan") });
  assert.match(observed.subject, /Your ads alongside/); assert.match(noAds.subject, /What agents around/);
  assert.match(observed.text, /Example City Realty/); assert.match(noAds.text, /Example Local Property/);
  assert.match(noAds.text, /Steven/); assert.doesNotMatch(noAds.text, /not advertising|private report|consent basis|Manage preferences/);
  assert.equal((observed.text.match(/View the Perth ad report/g) ?? []).length, 1);
  assert.throws(() => buildOutreachEmail({ ...input(), unsubscribeUrl: input().reportUrl }), /separate/);
  assert.throws(() => buildOutreachEmail({ ...input(), snapshot: { ...area, adExamples: [] } }), /Two sourced/);
});

test("follow-up adds a third sourced example and rejects a second follow-up", () => {
  const followUp = buildOutreachFollowUpEmail({ ...input(), followUpCount: 0 });
  assert.match(followUp.text, /Example West Homes/);
  assert.throws(() => buildOutreachFollowUpEmail({ ...input(), followUpCount: 1 }), /Only one/);
});

test("all three synthetic previews and follow-up render without external data or writes", () => {
  for (const segment of ["recent_ads_observed", "no_ads_found_after_successful_recent_scan", "unknown"] as const) {
    const email = buildDemoOutreachPreview({ segment }); assert.match(email.subject, /Sample/); assert.match(email.html, /Sample data/);
  }
  assert.match(buildDemoOutreachPreview({ followUp: true, theme: "dark" }).html, /email-force-dark/);
});

test("snapshot fingerprints normalize database timestamps and key order", () => {
  assert.equal(snapshotFingerprint(area), snapshotFingerprint({ ...area, evidence: { ...area.evidence, scannedAt: "2026-09-07T00:00:00+00:00" } }));
  assert.notEqual(snapshotFingerprint(area), snapshotFingerprint({ ...area, coverageLabel: "Another area" }));
});

test("imports reject demo contacts before touching the database", async () => {
  await assert.rejects(importOutreachDraft({} as SupabaseClient, { mode: "import", reportBaseUrl: "https://blockwise.sale", businessIdentity: "Blockwise", unsubscribeUrl: "https://blockwise.sale/unsubscribe/example", snapshot: area, prospect: demoProspect() }, now), /Synthetic/);
});

test("public read remains a frozen snapshot after day five and strips unexpected stored fields", async () => {
  const report = toPublicOutreachReport(area, person(), now);
  const chain = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { public_report: { ...report, contactEmail: "secret" } }, error: null }; } };
  const db = { from() { return chain; } } as unknown as SupabaseClient;
  const loaded = await loadPublicOutreachReport(db, "a".repeat(43), new Date("2026-09-20T00:00:00Z"));
  assert.equal(loaded?.segment, "recent_ads_observed"); assert.equal(JSON.stringify(loaded).includes("secret"), false);
  assert.equal(await loadPublicOutreachReport({} as SupabaseClient, "invalid"), null);
});
