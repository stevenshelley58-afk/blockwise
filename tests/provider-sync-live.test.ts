import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportingSnapshotInsert,
  buildSyncRunInsert,
  buildSyncRunUpdate,
} from "../src/lib/providers/provider-sync.ts";

test("provider sync writes reporting snapshots in production table shape", () => {
  const insert = buildReportingSnapshotInsert("workspace_1", {
    provider: "meta",
    status: "connected",
    source: "live",
    accountName: "Northstar Meta",
    lastSyncAt: "2026-05-27T01:00:00.000Z",
    metrics: {
      spendAud: 123.45,
      impressions: 1000,
      clicks: 50,
      leads: 10,
      validLeads: 7,
      validLeadRate: 0.7,
      cplAud: 12.35,
      validCplAud: 17.64,
    },
    daily: [],
    rows: [],
    creativePreviews: [],
  }, { since: "2026-05-01", until: "2026-05-27" });

  assert.equal(insert.workspace_id, "workspace_1");
  assert.equal(insert.provider, "meta");
  assert.equal(insert.date_range, "[2026-05-01,2026-05-27]");
  assert.equal(insert.metrics.spendAud, 123.45);
  assert.equal(insert.metrics.source, "live");
});

test("provider sync run builders record lifecycle state without provider tokens", () => {
  const insert = buildSyncRunInsert("workspace_1", "google", "sync-provider-workspace", "2026-05-27T01:00:00.000Z");
  const update = buildSyncRunUpdate("completed", "2026-05-27T01:05:00.000Z");

  assert.deepEqual(insert, {
    workspace_id: "workspace_1",
    provider: "google",
    job_key: "sync-provider-workspace",
    status: "running",
    started_at: "2026-05-27T01:00:00.000Z",
  });
  assert.deepEqual(update, {
    status: "completed",
    completed_at: "2026-05-27T01:05:00.000Z",
    error_message: null,
  });
});
