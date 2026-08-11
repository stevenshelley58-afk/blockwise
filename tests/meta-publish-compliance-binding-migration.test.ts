import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260811180000_bind_meta_publish_compliance.sql";

test("publish compliance binding migration follows its service-role grant dependency", () => {
  assert.ok(migrationPath > "supabase/migrations/20260811170000_adstudio_creatives_server_owned_dml.sql");
});

test("publish compliance binding is service-only, serialized, and ownership guarded", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create or replace function public\.adstudio_bind_publish_compliance/i);
  assert.match(sql, /security invoker[\s\S]*set search_path = ''/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /report\.id = p_report_id[\s\S]*report\.workspace_id = p_workspace_id[\s\S]*report\.campaign_id = p_campaign_id/i);
  assert.match(sql, /p_subject_hash is null or p_subject_hash !~ '\^\[A-Fa-f0-9\]\{64\}\$'/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i);
});
