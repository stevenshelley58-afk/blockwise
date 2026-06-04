import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dropMigration = "supabase/migrations/202605280002_research_drop_legacy.sql";
const schemaMigration = "supabase/migrations/202605280003_research_engine.sql";
const viewsMigration = "supabase/migrations/202605280004_research_views.sql";
const zeroAdContractMigration = "supabase/migrations/202606030003_zero_ad_item_count_contract.sql";
const adLibraryExtensionsMigration = "supabase/migrations/202606040001_ad_library_ingestion_extensions.sql";

test("legacy-drop migration removes the v1 research tables idempotently", () => {
  const sql = readFileSync(dropMigration, "utf8");
  for (const table of [
    "ad_area_matches",
    "ad_creatives",
    "ad_snapshots",
    "ad_fetch_runs",
    "agent_census_defects",
    "agent_census_audits",
    "agent_service_areas",
    "advertiser_pages",
    "agent_source_records",
    "agent_entity_links",
    "agent_entities",
  ]) {
    assert.match(
      sql,
      new RegExp(`drop table if exists public\\.${table} cascade`, "i"),
      `expected DROP TABLE IF EXISTS for ${table}`,
    );
  }
  // observed_ads columns added by the legacy 202605270004 migration must be
  // reversed defensively.
  for (const column of [
    "advertiser_page_id",
    "external_ad_id",
    "source_provider",
    "active_status",
    "first_seen_at",
    "last_seen_at",
    "last_checked_at",
    "missing_successive_checks",
    "raw_payload",
  ]) {
    assert.match(sql, new RegExp(`drop column if exists ${column}`, "i"));
  }
});

test("research engine migration creates the research schema and all core tables", () => {
  const sql = readFileSync(schemaMigration, "utf8");
  assert.match(sql, /create schema if not exists research/i);
  for (const table of [
    "source_documents",
    "agencies",
    "agents",
    "agent_service_areas",
    "advertiser_pages",
    "ad_fetch_runs",
    "observed_ads",
    "ad_snapshots",
    "ad_creatives",
    "ad_area_matches",
    "coverage_audits",
    "coverage_defects",
    "refresh_policies",
    "agent_decisions",
    "ingest_events",
  ]) {
    assert.match(
      sql,
      new RegExp(`create table research\\.${table}`, "i"),
      `expected research.${table} table`,
    );
  }
});

test("research engine migration enforces the absence-confirmation rule explicitly", () => {
  const sql = readFileSync(schemaMigration, "utf8");
  assert.match(sql, /missing_successive_checks/i);
  assert.match(sql, /active_status/i);
  assert.match(sql, /missingSuccessiveChecks >= 2|missing_successive_checks >= 2/i);
});

test("research engine migration creates an idempotency index on observed_ads", () => {
  const sql = readFileSync(schemaMigration, "utf8");
  assert.match(
    sql,
    /create unique index observed_ads_page_external_idx[\s\S]*?advertiser_page_id, external_ad_id/i,
  );
});

test("research engine migration enables pg_trgm before trigram indexes", () => {
  const sql = readFileSync(schemaMigration, "utf8").toLowerCase();
  const extensionIndex = sql.indexOf("create extension if not exists pg_trgm");
  const headlineIndex = sql.indexOf("headline gin_trgm_ops");
  const bodyIndex = sql.indexOf("body gin_trgm_ops");

  assert.ok(extensionIndex >= 0, "expected pg_trgm extension creation");
  assert.ok(headlineIndex > extensionIndex, "expected headline trigram index after pg_trgm");
  assert.ok(bodyIndex > extensionIndex, "expected body trigram index after pg_trgm");
});

test("research engine migration seeds the Perth refresh policy", () => {
  const sql = readFileSync(schemaMigration, "utf8");
  // Subiaco demo postcode should appear with high priority and a sub-daily
  // cadence so the smoke test can run quickly.
  assert.match(sql, /'6008',\s*'WA',\s*1,\s*720/i);
  // The seed should cover at least 20 Perth postcodes.
  const seedMatches = sql.match(/'\d{4}',\s*'WA',\s*\d,\s*\d+/g) ?? [];
  assert.ok(seedMatches.length >= 20, `expected >=20 seeded postcodes, got ${seedMatches.length}`);
});

test("views migration creates every curated view the app reads from", () => {
  const sql = readFileSync(viewsMigration, "utf8");
  for (const view of [
    "v_active_ads_by_postcode",
    "v_competitors_by_postcode",
    "v_ad_hooks_by_suburb",
    "v_agent_ad_history",
    "v_coverage_status",
    "v_recent_creative_patterns",
    "v_missing_competitors",
  ]) {
    assert.match(
      sql,
      new RegExp(`create or replace view research\\.${view}`, "i"),
      `expected view research.${view}`,
    );
  }
});

test("views migration restricts v_agent_ad_history to authenticated roles only", () => {
  const sql = readFileSync(viewsMigration, "utf8");
  assert.match(
    sql,
    /grant select on research\.v_agent_ad_history\s+to authenticated, service_role/i,
  );
  // The agent_ad_history view should NOT be granted to anon.
  assert.doesNotMatch(
    sql,
    /grant select on research\.v_agent_ad_history\s+to[^;]*anon/i,
  );
});

test("zero-ad diagnostics use Hermes item_count and ignore confirmed absence", () => {
  const sql = readFileSync(zeroAdContractMigration, "utf8");
  assert.match(sql, /watchdog_record_zero_ad_anomalies/i);
  assert.match(sql, /array\['item_count',\s*'ads_observed',\s*'adsObserved',\s*'itemCount'\]/i);
  assert.match(sql, /confirmed_absence'\)::boolean,\s*false\)\s*=\s*false/i);
  assert.match(sql, /create or replace view research\.v_operator_zero_ad_anomalies/i);
});

test("ad-library extension migration adds validation, swipe, and media-dedupe tables", () => {
  const sql = readFileSync(adLibraryExtensionsMigration, "utf8");
  assert.match(sql, /create table if not exists research\.official_api_validation_runs/i);
  assert.match(sql, /create table if not exists research\.media_blobs/i);
  assert.match(sql, /alter table research\.media_assets[\s\S]*add column if not exists content_hash/i);
  assert.match(sql, /create table if not exists public\.research_saved_ads/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant select, insert, update on research\.media_blobs to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on public\.research_saved_ads to authenticated, service_role/i);
});
