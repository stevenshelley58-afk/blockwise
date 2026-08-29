import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202605270001_security_hardening.sql";

test("security hardening migration moves provider token material into a private vault", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create table if not exists private\.provider_token_vault/i);
  assert.match(sql, /drop column if exists encrypted_access_token/i);
  assert.match(sql, /drop column if exists encrypted_refresh_token/i);
});

test("security hardening migration denies client-side writes to server-owned security tables", () => {
  const sql = readFileSync(migrationPath, "utf8");

  for (const tableName of ["audit_logs", "ai_runs", "agent_steps", "provider_connections", "lead_export_audits"]) {
    assert.match(sql, new RegExp(`drop policy if exists workspace_insert on public\\.${tableName}`, "i"));
    assert.match(sql, new RegExp(`create policy ${tableName}_server_owned_no_client_insert`, "i"));
  }
});

test("security hardening migration adds agent data-class and cross-workspace guardrails", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /allowed_data_classes text\[\] not null default/i);
  assert.match(sql, /allowed_outbound_domains text\[\] not null default/i);
  assert.match(sql, /can_cross_workspace boolean not null default false/i);
  assert.match(sql, /requested_workspace_ids uuid\[\] not null default/i);
});
