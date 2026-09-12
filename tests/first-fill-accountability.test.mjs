import test from "node:test";
import assert from "node:assert/strict";
import { buildAccountabilityReport } from "../scripts/research/first-fill-accountability.mjs";

const entity = (id, kind, metadata = {}, extra = {}) => ({
  id, kind, state: "WA", metadata, status: "licensed_verified",
  ...(kind === "agent" ? { full_name: id } : { name: id }),
  ...extra,
});
const page = (id, owner, extra = {}) => ({
  id, page_id: id + "-meta", status: "resolved_collectable", scan_enabled: true,
  scan_state: "needs_first_fill", initial_fill_completed_at: null,
  last_successful_scan_at: null, resolution_decision_id: null,
  [owner.kind + "_id"]: owner.id, ...extra,
});
const decision = (id, kind, subject, body, extra = {}) => ({
  id, subject_type: kind, subject_id: subject, decision_type: "page_resolution",
  decided_at: "2026-09-01T00:00:00Z", decision: body, evidence: {}, rationale: "", ...extra,
});

function fixture() {
  const a1 = entity("a1", "agent", { cold_email_enrichment: { v1: {
    social_links: { facebook: "https://facebook.com/a1" },
    skipped_reason: "public_page_social_discovery_run",
  } } });
  const a2 = entity("a2", "agent", { cold_email_enrichment: { v1: {
    social_links: { facebook: "https://facebook.com/a2" },
    skipped_reason: "exa_key_missing_social_discovery_not_run",
  } } });
  const a3 = entity("a3", "agent", {}, {});
  const a4 = entity("a4", "agent", { cold_email_enrichment: { v1: {
    social_links: { facebook: "https://facebook.com/a4" },
    skipped_reason: "public_page_social_discovery_run",
  } } });
  const a5 = entity("a5", "agent", {}, {});
  const a6 = entity("a6", "agent", {}, {});
  const a7 = entity("a7", "agent", {}, {});
  const g1 = entity("g1", "agency", {}, {});
  const g2 = entity("g2", "agency", {}, {});
  const pending = page("p1", a1);
  pending.page_id = "111";
  const complete = page("p2", a7, {
    page_id: "222", scan_state: "healthy", initial_fill_completed_at: "2026-09-02T00:00:00Z",
  });
  const timestampOnly = page("p4", a7, {
    page_id: "333", scan_state: "healthy", initial_fill_completed_at: "2026-09-03T00:00:00Z",
  });
  const rejected = page("p3", g1, {
    page_id: null, status: "rejected_non_real_estate", scan_enabled: false, scan_state: "paused",
  });
  const slugOnly = page("p5", a6, {
    page_id: "facebook-slug", scan_state: "healthy", initial_fill_completed_at: "2026-09-04T00:00:00Z",
  });
  const d1 = decision("d1", "agent", "a1", { resolved: true, page_id: "111" });
  const d1fail = decision("d1-fail", "agent", "a1", { resolved: false }, {
    decided_at: "2026-09-02T00:00:00Z", rationale: "Provider timeout; failed attempt.",
  });
  pending.resolution_decision_id = d1.id;
  return {
    agents: [a1, a2, a3, a4, a5, a6, a7, entity("outside", "agent", {}, { state: "NSW" })],
    agencies: [g1, g2, entity("outside-g", "agency", {}, { state: "NSW" })],
    pages: [pending, complete, timestampOnly, rejected, slugOnly],
    decisions: [
      d1,
      d1fail,
      decision("d3-old", "agent", "a3", { resolved: true, page_id: "444" }, { decided_at: "2026-08-01T00:00:00Z" }),
      decision("d3", "agent", "a3", { resolved: false }, { rationale: "No verified match found." }),
      decision("d5", "agent", "a5", { resolved: false, status: "ambiguous" }),
      decision("d6", "agent", "a6", { resolved: false }, { rationale: "Provider failed with timeout." }),
    ],
    runs: [{
      id: "run-manual", advertiser_page_id: "p2", scan_mode: "manual", status: "success",
      coverage_complete: true, pagination_exhausted: true, completed_at: "2026-09-03T00:00:00Z",
    }],
    ads: [{ id: "ad1", advertiser_page_id: "p1", active_status: "active" }, { id: "ad2", advertiser_page_id: "p2", active_status: "inactive" }],
    creatives: [{ id: "c1", observed_ad_id: "ad1" }, { id: "c2", observed_ad_id: "ad2" }],
    media: [
      { id: "m1", observed_ad_id: "ad1", ad_creative_id: "c1", capture_status: "pending" },
      { id: "m4", observed_ad_id: "ad1", ad_creative_id: "c1", capture_status: "captured" },
      {
        id: "m2", observed_ad_id: "ad2", ad_creative_id: "c2", capture_status: "captured",
        archive_verified_at: "2026-09-03T00:00:00Z", storage_path: "archive/ad2.jpg",
      },
      {
        id: "m3", observed_ad_id: "ad2", ad_creative_id: "c2", capture_status: "blocked",
        metadata: { deduped_to_media_asset_id: "m2" },
      },
      {
        id: "m5", observed_ad_id: "ad2", ad_creative_id: "c2", capture_status: "captured",
        captured_at: "2026-09-03T00:00:00Z",
        metadata: { capture_verification: { status: "verified" }, storage_record: { object_key: "archive/ad2-alt.jpg" } },
      },
    ],
  };
}

test("full roster reconciliation is exact and excludes non-WA rows", () => {
  const report = buildAccountabilityReport(fixture());
  assert.deepEqual(report.scope, { state: "WA", agents: 7, agencies: 2, total: 9 });
  assert.equal(report.identity.reconciliation.passes, true);
  assert.equal(Object.values(report.identity.by_status).reduce((a, b) => a + b, 0), 9);
  assert.equal(report.identity.by_status.page_found, 2);
  assert.equal(report.identity.by_status.unchecked, 3);
  assert.equal(report.identity.by_status.no_verified_match, 1);
  assert.equal(report.identity.by_status.ambiguous, 1);
  assert.equal(report.identity.by_status.failed, 1);
  assert.equal(report.identity.by_status.attempted, 1);
  assert.equal(report.roster.find((row) => row.id === "a3").identity_status, "no_verified_match");
  assert.equal(report.roster.find((row) => row.id === "a1").identity_status, "page_found");
  assert.deepEqual(report.roster.find((row) => row.id === "a6").page_ids, []);
  assert.equal(report.page_scan.reconciliation.passes, true);
  assert.equal(Object.values(report.page_scan.by_status).reduce((a, b) => a + b, 0), 9);
});

test("a linked pending page is namechecked, while social candidates remain unverified", () => {
  const report = buildAccountabilityReport(fixture());
  const a1 = report.roster.find((row) => row.id === "a1");
  const a2 = report.roster.find((row) => row.id === "a2");
  assert.equal(a1.identity_status, "page_found");
  assert.equal(a1.page_scan_status, "pending");
  assert.deepEqual(a1.page_ids, ["111"]);
  assert.equal(a2.identity_status, "unchecked");
  assert.equal(a2.page_found, false);
  assert.equal(report.candidate_agents.with_facebook_candidate, 3);
  assert.equal(report.candidate_agents.linked_with_valid_identity_evidence, 1);
  assert.equal(report.candidate_agents.unlinked, 2);
});

test("media gaps and exclusion reasons remain separate dimensions", () => {
  const report = buildAccountabilityReport(fixture());
  assert.equal(report.media.by_status.gap, 1);
  assert.equal(report.media.by_status.no_gap, 1);
  assert.equal(report.media.by_status.not_evaluated, 7);
  assert.equal(report.media.deduped_assets, 1);
  assert.equal(report.media.assets_missing, 1);
  assert.equal(report.media.active_archive_gaps, 1);
  assert.equal(report.media.historical_archive_gaps, 0);
  assert.equal(report.media.captured_not_archived, 1);
  assert.equal(report.roster.find((row) => row.id === "a1").media.gap, true);
  const g1 = report.roster.find((row) => row.id === "g1");
  assert.equal(g1.page_scan_status, "excluded");
  assert.deepEqual(g1.excluded_reasons, ["rejected_non_real_estate", "scan_disabled:unspecified"]);
  assert.equal(report.exclusions.excluded, 1);
  assert.equal(report.exclusions.reconciliation.passes, true);
});

test("first-fill denominator is numeric enabled pages, not known pages", () => {
  const report = buildAccountabilityReport(fixture());
  assert.equal(report.first_fill.enabled_numeric_pages, 3);
  assert.equal(report.first_fill.trusted_initial_fill_completed_pages, 1);
  assert.equal(report.first_fill.backlog_pages, 2);
  assert.equal(report.roster.find((row) => row.id === "a7").page_scan_status, "partial");
  assert.equal(report.roster.find((row) => row.id === "a7").pages_full_complete, 1);
  assert.match(report.first_fill.note, /never known pages alone/);
});
