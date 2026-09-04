import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202609030002_meta_publish_execution_leases.sql",
  "utf8",
);
const executionSource = readFileSync("src/lib/providers/meta-execution.ts", "utf8");

test("publish execution leases are workspace and token fenced", () => {
  assert.match(migration, /^\s*--[\s\S]*\bbegin;/i);
  assert.match(migration, /execution_lease_token uuid/i);
  assert.match(migration, /execution_lease_expires_at timestamptz/i);
  assert.match(migration, /claim_meta_publish_execution\(p_workspace_id uuid, p_plan_id uuid/i);
  assert.match(migration, /workspace_id = p_workspace_id and id = p_plan_id/i);
  assert.match(migration, /execution_lease_token = p_lease_token/i);
  assert.match(migration, /coalesce\(\(select auth\.role\(\)\), ''\) <> 'service_role'/i);
  assert.match(migration, /revoke all on function public\.claim_meta_publish_execution[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_meta_publish_execution[\s\S]*to service_role/i);
  assert.match(migration, /commit;\s*$/i);
});

test("activation retries and uncertain compensation have durable fields", () => {
  assert.match(migration, /client_mutation_key text/i);
  assert.match(migration, /meta_publish_plan_mutations_activation_key_idx/i);
  assert.match(migration, /workspace_id, meta_publish_plan_id, action, client_mutation_key/i);
  assert.match(migration, /outcome_status text/i);
  assert.match(migration, /'confirmed_paused', 'unconfirmed'/i);
  assert.match(migration, /unconfirmed_pause_ids_json jsonb not null default '\[\]'/i);
});

test("plan retries adopt the canonical row without overwriting progress", () => {
  const persistStart = executionSource.indexOf("export async function persistMetaPublishPlan");
  const persistEnd = executionSource.indexOf("export async function loadMetaPublishPlan", persistStart);
  const persistBody = executionSource.slice(persistStart, persistEnd);

  assert.match(persistBody, /\.insert\(planToRow\(plan, userId\)\)/);
  assert.match(persistBody, /error\?\.code === "23505"/);
  assert.match(persistBody, /loadMetaPublishPlanByIdempotencyKey/);
  assert.doesNotMatch(persistBody, /\.upsert\(/);
  assert.match(executionSource, /export async function claimMetaPublishExecution/);
  assert.match(executionSource, /export async function releaseMetaPublishExecutionLease/);
});
