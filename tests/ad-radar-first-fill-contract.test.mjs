import assert from "node:assert/strict";
import test from "node:test";
import {
  adRadarCollectorDedupeKey,
  initialFillAvailableAt,
  isFirstFillPage,
  shouldRunAdDbJob,
} from "../hermes/tools/research-runtime/bin/ad-radar-first-fill-scheduling.mjs";

test("first-fill page eligibility excludes completed, queued, and invalid pages", () => {
  const base = { id: "page-1", page_id: "123", scan_state: "needs_first_fill", initial_fill_completed_at: null };
  assert.equal(isFirstFillPage(base, new Set()), true);
  assert.equal(isFirstFillPage({ ...base, initial_fill_completed_at: "2026-09-12T00:00:00Z" }, new Set()), false);
  assert.equal(isFirstFillPage(base, new Set(["page-1"])), false);
  assert.equal(isFirstFillPage({ ...base, page_id: "slug:foo" }, new Set()), false);
});


test("failed first fills retain queue eligibility and expose their backoff", () => {
  const now = new Date("2026-09-12T00:00:00.000Z");
  const page = { id: "page-1", page_id: "123", scan_enabled: true, scan_state: "failing", initial_fill_completed_at: null };
  assert.equal(isFirstFillPage(page, new Set()), true);
  assert.equal(initialFillAvailableAt({ ...page, backoff_until: "2026-09-12T03:00:00.000Z" }, now), "2026-09-12T03:00:00.000Z");
  assert.equal(initialFillAvailableAt({ ...page, backoff_until: "2026-09-11T03:00:00.000Z" }, now), now.toISOString());
  assert.equal(adRadarCollectorDedupeKey("page-1"), "ad-radar:collector:page-1");
  assert.equal(isFirstFillPage({ ...page, scan_enabled: false }, new Set()), false);
});
test("first-fill eligibility treats scan state as operational, not completion", () => {
  const base = { id: "page-1", page_id: "123", scan_enabled: true, initial_fill_completed_at: null };
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
});

test("first-fill replay identity is stable on the queue job, not a newly inserted fetch row", () => {
  const runKey = (jobId, fetchRunId) => "ad-radar-first-fill:" + (jobId || fetchRunId);
  assert.equal(runKey("queue-1", "fetch-a"), runKey("queue-1", "fetch-b"));
  assert.notEqual(runKey("queue-1", "fetch-a"), runKey("queue-2", "fetch-a"));
});
