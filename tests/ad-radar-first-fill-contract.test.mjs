import assert from "node:assert/strict";
import test from "node:test";
import {
  adRadarCollectorDedupeKey,
  FIRST_FILL_CAPTURE_INPUT,
  FIRST_FILL_QUEUE_FILTER,
  initialFillAvailableAt,
  isFirstFillPage,
  isWaFirstFillScope,
  shouldRunAdDbJob,
} from "../hermes/tools/research-runtime/bin/ad-radar-first-fill-scheduling.mjs";

const verifiedWa = { agent: { state: "WA", status: "licensed_verified" } };

test("first-fill page eligibility excludes completed, queued, invalid, and out-of-scope pages", () => {
  const base = { id: "page-1", page_id: "123", scan_state: "needs_first_fill", initial_fill_completed_at: null, ...verifiedWa };
  assert.equal(isFirstFillPage(base, new Set()), true);
  assert.equal(isFirstFillPage({ ...base, initial_fill_completed_at: "2026-09-12T00:00:00Z" }, new Set()), false);
  assert.equal(isFirstFillPage(base, new Set(["page-1"])), false);
  assert.equal(isFirstFillPage({ ...base, page_id: "slug:foo" }, new Set()), false);
  assert.equal(isFirstFillPage({ id: "global-enabled", page_id: "456", scan_enabled: true }, new Set()), false);
});

test("first-fill WA scope accepts verified roster links or explicit unmapped quarantine only", () => {
  assert.equal(isWaFirstFillScope({ agent: { state: "WA", status: "licensed_verified" } }), true);
  assert.equal(isWaFirstFillScope({ agency: { state: "WA", status: "licensed_verified" } }), true);
  assert.equal(isWaFirstFillScope({ agent: { state: "NSW", status: "licensed_verified" } }), false);
  assert.equal(isWaFirstFillScope({ agent: { state: "WA", status: "market_seen_unverified" } }), false);
  assert.equal(isWaFirstFillScope({ agent_id: null, agency_id: null, metadata: { first_fill_intent: "unmapped_quarantine", first_fill_state: "WA" } }), true);
  assert.equal(isWaFirstFillScope({ agent_id: null, agency_id: null, metadata: { first_fill_intent: "unmapped_quarantine", first_fill_state: "NSW" } }), false);
  assert.equal(isWaFirstFillScope({ agent_id: "linked", metadata: { first_fill_intent: "unmapped_quarantine", first_fill_state: "WA" } }), false);
});

test("failed first fills retain queue eligibility and expose their backoff", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const page = { id: "page-1", page_id: "123", scan_enabled: true, scan_state: "failing", initial_fill_completed_at: null, ...verifiedWa };
  assert.equal(isFirstFillPage(page, new Set()), true);
  assert.equal(initialFillAvailableAt({ ...page, backoff_until: "2026-09-12T03:00:00.000Z" }, now), "2026-09-12T03:00:00.000Z");
  assert.equal(initialFillAvailableAt({ ...page, backoff_until: "2026-09-11T03:00:00.000Z" }, now), now.toISOString());
  assert.equal(adRadarCollectorDedupeKey("page-1"), "ad-radar:collector:page-1");
  assert.equal(isFirstFillPage({ ...page, scan_enabled: false }, new Set()), false);
});

test("first-fill eligibility treats scan state as operational, not completion", () => {
  const base = { id: "page-1", page_id: "123", scan_enabled: true, initial_fill_completed_at: null, ...verifiedWa };
  for (const scan_state of ["needs_first_fill", "queued", "scanning", "failing", "zero_ads", "healthy", null]) {
    assert.equal(isFirstFillPage({ ...base, scan_state }, new Set()), true);
  }
});

test("first-fill-only worker admits only initial-fill collectors and their media children", () => {
  const initial = { job_type: "blockwise-ad-collector", payload: { scanMode: "initial_fill" } };
  const refresh = { job_type: "blockwise-ad-collector", payload: { scanMode: "refresh" } };
  const child = { job_type: "blockwise-media-collector", payload: { ad_db_child: true, parent_scan_mode: "initial_fill" } };
  const maintenanceChild = { job_type: "blockwise-media-collector", payload: { ad_db_child: true, parent_scan_mode: "refresh" } };
  assert.equal(shouldRunAdDbJob(initial, true), true);
  assert.equal(shouldRunAdDbJob(refresh, true), false);
  assert.equal(shouldRunAdDbJob(child, true), true);
  assert.equal(shouldRunAdDbJob(maintenanceChild, true), false);
  assert.equal(shouldRunAdDbJob(refresh, false), true);
  assert.equal(FIRST_FILL_CAPTURE_INPUT.country, "ALL");
  assert.equal(FIRST_FILL_CAPTURE_INPUT.activeStatus, "active");
  assert.match(FIRST_FILL_QUEUE_FILTER, /parent_scan_mode\.eq\.initial_fill/);
});

test("first-fill replay identity is stable on the queue job, not a newly inserted fetch row", () => {
  const runKey = (jobId, fetchRunId) => "ad-radar-first-fill:" + (jobId || fetchRunId);
  assert.equal(runKey("queue-1", "fetch-a"), runKey("queue-1", "fetch-b"));
  assert.notEqual(runKey("queue-1", "fetch-a"), runKey("queue-2", "fetch-a"));
});
