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

test("activation creation is an atomic fenced service RPC", () => {
  assert.match(migration, /create or replace function public\.ensure_meta_activation_mutation/i);
  assert.match(migration, /p_workspace_id uuid, p_plan_id uuid, p_client_mutation_key text/i);
  assert.match(migration, /p_plan_fingerprint text, p_requested_by uuid/i);
  assert.match(migration, /auth\.role\(\).*service_role_required/i);
  assert.match(migration, /security definer set search_path = ''/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /client_mutation_key=p_client_mutation_key/i);
  assert.match(migration, /jsonb_each_text\(coalesce\(v_plan\.reconciled_objects_json->'ownedAdIds'/i);
  assert.match(migration, /activation ownership could not be verified/i);
  assert.match(migration, /new_campaign_new_adset[\s\S]*campaign ownership could not be verified/i);
  assert.match(migration, /reused campaign fencing failed/i);
  assert.match(migration, /insert into public\.approval_requests[\s\S]*status,requested_by,approved_by/i);
  assert.match(migration, /update public\.meta_publish_plan_mutations set approval_request_id/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*meta\.activate_requested/i);
  assert.match(migration, /exception when unique_violation[\s\S]*client_mutation_key=p_client_mutation_key/i);
  assert.match(migration, /revoke all on function public\.ensure_meta_activation_mutation[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ensure_meta_activation_mutation[\s\S]*to service_role/i);
  assert.match(executionSource, /export async function ensureMetaActivationMutation/);
});

test("provider mutation outcome and audit finalize atomically", () => {
  assert.match(migration, /create or replace function public\.finalize_meta_publish_plan_mutation/i);
  assert.match(migration, /select \* into v_mut[\s\S]*for update/i);
  assert.match(migration, /if v_mut\.status in \('applied','failed'\)[\s\S]*is not distinct from p_outcome_status/i);
  assert.match(migration, /if v_mut\.status <> 'applying' then raise exception/i);
  assert.match(migration, /update public\.meta_publish_plan_mutations set[\s\S]*outcome_status=p_outcome_status/i);
  assert.match(migration, /insert into public\.audit_logs[\s\S]*'meta\.' \|\| v_mut\.action/i);
  assert.match(migration, /revoke all on function public\.finalize_meta_publish_plan_mutation[\s\S]*from public, anon, authenticated/i);
});

test("publication snapshots are durably linked", () => {
  assert.match(migration, /add column if not exists publication_snapshot_id uuid references public\.ad_publication_snapshots\(id\) on delete set null/i);
  assert.match(executionSource, /publicationSnapshotId\?: string \| null/);
  assert.match(executionSource, /publication_snapshot_id: plan\.publicationSnapshotId/);
  assert.match(executionSource, /source: plan\.source \?\? null/);
  assert.match(executionSource, /source: planJson\.source \?\? null/);
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
