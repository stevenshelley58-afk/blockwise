import assert from "node:assert/strict";
import test from "node:test";

import { buildEmailLocationProjections, emailLocationHash, normalizeProjectionEmail } from "../hermes/tools/research-runtime/bin/customer-read-model-publisher.mjs";

const revision = "c0a80123-4567-4abc-8def-0123456789ab";
const now = "2026-09-14T00:00:00.000Z";

test("projection normalizes before hashing and never returns raw email", () => {
  assert.equal(normalizeProjectionEmail("  Agent@Agency.COM "), "agent@agency.com");
  const rows = buildEmailLocationProjections([{ email: "Agent@Agency.COM", primary_postcode: "6000", primary_suburb: "Perth", updated_at: now, metadata: {} }], revision, now);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["email_sha256", "postcode", "projected_at", "source", "source_observed_at", "source_revision", "suburb"]);
  assert.equal(JSON.stringify(rows).includes("Agent@Agency.COM"), false);
  assert.equal(rows[0].email_sha256, emailLocationHash("agent@agency.com"));
});

test("projection accepts enrichment but filters test records", () => {
  const rows = buildEmailLocationProjections([
    { email: "", primary_postcode: "6008", primary_suburb: "Subiaco", updated_at: now, metadata: { cold_email_enrichment: { v1: { email: "real@agency.com", enriched_at: "2026-09-13T00:00:00.000Z" } } } },
    { email: "demo@agency.test", primary_postcode: "6000", updated_at: now, metadata: {} },
  ], revision, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].postcode, "6008");
});

test("projection rejects conflicting postcode observations", () => {
  const rows = buildEmailLocationProjections([
    { email: "same@agency.com", primary_postcode: "6000", updated_at: now, metadata: {} },
    { email: "SAME@agency.com", primary_postcode: "6001", updated_at: now, metadata: {} },
  ], revision, now);
  assert.deepEqual(rows, []);
});

test("projection excludes records without an actual source observation time", () => {
  const rows = buildEmailLocationProjections([
    { email: "missing-time@agency.com", primary_postcode: "6000", metadata: {} },
  ], revision, now);
  assert.deepEqual(rows, []);
});
