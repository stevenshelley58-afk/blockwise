import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEmailLocationProjections, emailLocationHash, normalizeProjectionEmail } from "../hermes/tools/research-runtime/bin/customer-read-model-publisher.mjs";
import { syncResearchEmailLocationProjection } from "../hermes/tools/research-runtime/bin/research-email-location-projection-sync.mjs";

const revision = "c0a80123-4567-4abc-8def-0123456789ab";
const now = "2026-09-14T00:00:00.000Z";
const knownPostcodes = new Set(["2000", "6000", "6001", "6008"]);

test("projection normalizes before hashing and never returns raw email", () => {
  assert.equal(normalizeProjectionEmail("  Agent@Agency.COM "), "agent@agency.com");
  const rows = buildEmailLocationProjections([{ email: "Agent@Agency.COM", primary_postcode: "6000", primary_suburb: "Perth", updated_at: now, metadata: {} }], revision, now, knownPostcodes);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["email_sha256", "postcode", "projected_at", "source", "source_observed_at", "source_revision", "suburb"]);
  assert.equal(JSON.stringify(rows).includes("Agent@Agency.COM"), false);
  assert.equal(rows[0].email_sha256, emailLocationHash("agent@agency.com"));
});

test("projection accepts enrichment but filters test records", () => {
  const rows = buildEmailLocationProjections([
    { email: "", primary_postcode: "6008", primary_suburb: "Subiaco", updated_at: now, metadata: { cold_email_enrichment: { v1: { email: "real@agency.com", enriched_at: "2026-09-13T00:00:00.000Z" } } } },
    { email: "demo@agency.test", primary_postcode: "6000", updated_at: now, metadata: {} },
  ], revision, now, knownPostcodes);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].postcode, "6008");
});

test("projection rejects conflicting postcode observations", () => {
  const rows = buildEmailLocationProjections([
    { email: "same@agency.com", primary_postcode: "6000", updated_at: now, metadata: {} },
    { email: "SAME@agency.com", primary_postcode: "6001", updated_at: now, metadata: {} },
  ], revision, now, knownPostcodes);
  assert.deepEqual(rows, []);
});

test("projection excludes records without an actual source observation time", () => {
  const rows = buildEmailLocationProjections([
    { email: "missing-time@agency.com", primary_postcode: "6000", metadata: {} },
    { email: "", primary_postcode: "6000", updated_at: now, metadata: { cold_email_enrichment: { v1: { email: "enrichment-without-time@agency.com" } } } },
  ], revision, now, knownPostcodes);
  assert.deepEqual(rows, []);
});

test("projection accepts only known AU postcodes without treating snapshot start as source recency", () => {
  const rows = buildEmailLocationProjections([
    { email: "unknown@agency.com", primary_postcode: "0000", updated_at: now, metadata: {} },
    { email: "future@agency.com", primary_postcode: "6000", updated_at: "2026-09-14T00:00:01.000Z", metadata: {} },
    { email: "valid@agency.com", primary_postcode: "2000", updated_at: now, metadata: {} },
  ], revision, now, knownPostcodes);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.postcode).sort(), ["2000", "6000"]);
});

test("dedicated sync reads research only and writes one hash-only RPC snapshot", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.startsWith("https://research.invalid/")) {
      return new Response(JSON.stringify([{ id: "agent-1", email: "person@agency.com", primary_postcode: "6000", primary_suburb: "Perth", metadata: {}, updated_at: now }]), { status: 200 });
    }
    const body = JSON.parse(init.body);
    assert.equal(url, "https://customer.invalid/rest/v1/rpc/replace_research_email_location_projection_snapshot");
    assert.equal(JSON.stringify(body).includes("person@agency.com"), false);
    assert.deepEqual(Object.keys(body.p_rows[0]).sort(), ["email_sha256", "postcode", "source_observed_at", "suburb"]);
    assert.equal(body.p_allow_large_removal, false);
    return new Response(JSON.stringify({ applied: true, removed_rows: 0, row_count: 1 }), { status: 200 });
  };
  const result = await syncResearchEmailLocationProjection({
    env: {
      HERMES_SUPABASE_URL: "https://research.invalid",
      HERMES_SUPABASE_SECRET_KEY: "research-secret",
      HERMES_CUSTOMER_SUPABASE_URL: "https://customer.invalid",
      HERMES_CUSTOMER_SUPABASE_SECRET_KEY: "customer-secret",
    },
    fetchImpl,
    now: () => now,
    createRevision: () => revision,
    knownPostcodes,
  });
  assert.equal(result.status, "applied");
  assert.equal(result.projectedRows, 1);
  assert.equal(requests.filter(({ url }) => url.startsWith("https://customer.invalid/")).length, 1);
  const researchRequests = requests.filter(({ url }) => url.startsWith("https://research.invalid/"));
  assert.ok(researchRequests.every(({ init }) => !init.method || init.method === "GET"));
  assert.ok(researchRequests[0].url.includes("order=id.asc"));
  assert.equal(researchRequests[0].url.includes("offset="), false);
});

test("atomic snapshot migration locks and rejects stale input before reconciliation", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260914020100_atomic_research_email_location_projection_snapshot.sql", import.meta.url), "utf8");
  const lock = migration.indexOf("pg_advisory_xact_lock");
  const stale = migration.indexOf("p_snapshot_at <= v_previous_snapshot_at");
  const upsert = migration.indexOf("insert into public.research_email_location_projections");
  const reconcile = migration.indexOf("delete from public.research_email_location_projections");
  const marker = migration.indexOf("insert into public.research_email_location_projection_state");
  assert.ok(lock >= 0 && lock < stale && stale < upsert && upsert < reconcile && reconcile < marker);
  assert.match(migration, /p_allow_large_removal boolean default false/);
  assert.match(migration, /current_setting\('request\.jwt\.claims', true\)/);
  assert.match(migration, /v_removed_count > greatest\(5, pg_catalog\.ceil\(v_current_count \* 0\.20\)/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
});
