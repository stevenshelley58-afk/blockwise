import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260811130000_meta_publish_state_machine_and_legacy_rls.sql";

test("Meta publish state migration replaces only the named status check", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /drop constraint if exists meta_publish_plans_status_check/i);
  assert.doesNotMatch(sql, /pg_get_constraintdef\(oid\) like '%status%'/i);
  assert.match(sql, /status in \(\s*'draft', 'validating', 'queued', 'publishing', 'paused_ready',/i);
});

test("Meta publish state migration requires a SHA-256 subject hash when present", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /adstudio_compliance_reports_subject_hash_check/i);
  assert.match(sql, /subject_hash is null or subject_hash ~ '\^\[A-Fa-f0-9\]\{64\}\$'/i);
});
