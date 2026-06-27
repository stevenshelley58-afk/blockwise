import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606120002_lead_dedupe_unique_per_lead.sql";

test("lead dedupe migration moves uniqueness from dedupe key to lead id", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /partition by workspace_id,\s*lead_id/i);
  assert.match(sql, /drop constraint if exists lead_dedupe_records_workspace_id_dedupe_key_key/i);
  assert.match(sql, /drop index if exists public\.lead_dedupe_records_workspace_id_dedupe_key_key/i);
  assert.match(sql, /add constraint lead_dedupe_records_workspace_id_lead_id_key unique \(workspace_id,\s*lead_id\)/i);
});

test("Meta lead worker stores duplicate candidate dedupe records by lead", () => {
  const source = readFileSync("src/lib/providers/meta-leads-worker.ts", "utf8");

  assert.match(source, /\.from\("lead_dedupe_records"\)\.upsert\(/);
  assert.match(source, /duplicate_of_lead_id:\s*duplicateOfLeadId \?\? null/);
  assert.match(source, /onConflict:\s*"workspace_id,lead_id"/);
});
