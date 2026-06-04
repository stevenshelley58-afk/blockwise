import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202605280001_meta_execution_layer.sql";

test("meta execution migration creates server-owned publish plans", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table if not exists public\.meta_publish_plans/i);
  assert.match(sql, /adapter text not null/i);
  assert.match(sql, /status text not null/i);
  assert.match(sql, /idempotency_key text not null/i);
  assert.match(sql, /plan_json jsonb not null default '\{\}'/i);
  assert.match(sql, /request_log_json jsonb not null default '\[\]'/i);
  assert.match(sql, /response_log_json jsonb not null default '\[\]'/i);
  assert.match(sql, /reconciled_objects_json jsonb not null default '\{\}'/i);
  assert.match(sql, /unique \(workspace_id, idempotency_key\)/i);
  assert.match(sql, /alter table public\.meta_publish_plans enable row level security/i);
  assert.match(sql, /meta_publish_plans_server_owned_no_client_insert/i);
});

test("meta execution migration extends provider connections for Meta setup assets", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /alter table public\.provider_connections\s+add column if not exists metadata_json jsonb not null default '\{\}'/i);
  assert.match(sql, /create index if not exists meta_publish_plans_workspace_status_idx/i);
});

test("meta execution migration stores token health, mutation approvals, and lead delivery attempts", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /token_expires_at timestamptz/i);
  assert.match(sql, /create table if not exists public\.meta_publish_plan_mutations/i);
  assert.match(sql, /approval_request_id uuid references public\.approval_requests/i);
  assert.match(sql, /create table if not exists public\.lead_delivery_attempts/i);
  assert.match(sql, /lead_delivery_attempts_server_owned_no_client_insert/i);
});
