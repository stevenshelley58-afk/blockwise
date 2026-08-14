import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rollingMigrationPath =
  "supabase/migrations/20260802122856_job_queue_workspace_leases.sql";
const cutoverMigrationPath =
  "supabase/migrations/20260802123157_drop_legacy_job_settlement_rpcs.sql";

const rollingMigration = readFileSync(rollingMigrationPath, "utf8");
const cutoverMigration = readFileSync(cutoverMigrationPath, "utf8");

test("production-only migration history is represented in source", () => {
  const templateOverrides = readFileSync(
    "supabase/migrations/20260731080000_adstudio_template_review_overrides.sql",
    "utf8",
  );
  const finalProfile = readFileSync(
    "supabase/migrations/20260802075842_google_final_image_profile.sql",
    "utf8",
  );
  const imageFallback = readFileSync(
    "supabase/migrations/20260802114954_adstudio_gemini_primary_openai_fallback.sql",
    "utf8",
  );

  assert.match(finalProfile, /mp\.key = 'image_final'/);
  assert.match(templateOverrides, /public\.adstudio_template_review_overrides/);
  assert.equal(
    existsSync("supabase/migrations/202607260001_ad_creatives_ocr_enrichment.sql"),
    false,
  );
  assert.equal(
    existsSync("supabase/migrations/202607270001_progressive_activation_credit_ledger.sql"),
    false,
  );
  assert.match(finalProfile, /'gemini-3\.1-flash-image'/);
  assert.match(finalProfile, /image_usd_per_unit = 0\.067/);
  assert.match(imageFallback, /key in \('image_draft', 'image_final'\)/);
  assert.match(imageFallback, /set active_to = now\(\)/);
  assert.match(imageFallback, /OpenAI remains the\s+-- declared code fallback/);
});

test("queue migration establishes a mandatory relational workspace fence", () => {
  assert.match(
    rollingMigration,
    /add column if not exists workspace_id uuid/,
  );
  assert.match(
    rollingMigration,
    /alter column workspace_id set not null/,
  );
  assert.match(
    rollingMigration,
    /constraint job_queue_workspace_id_fkey[\s\S]*foreign key \(workspace_id\)[\s\S]*references public\.workspaces \(id\)/,
  );
  assert.match(
    rollingMigration,
    /constraint job_queue_workspace_payload_check[\s\S]*payload ->> 'workspaceId'[\s\S]*workspace_id::text/,
  );
  assert.match(
    rollingMigration,
    /job_queue_workspace_dedupe_idx[\s\S]*\(workspace_id, kind, dedupe_key\)/,
  );
});

test("unscoped legacy rows are archived with active-job and row-count guards", () => {
  assert.match(
    rollingMigration,
    /legacy_archive\.job_queue_unscoped/,
  );
  assert.match(
    rollingMigration,
    /if v_active > 0 then[\s\S]*raise exception/,
  );
  assert.match(
    rollingMigration,
    /if v_archived <> v_unscoped then[\s\S]*archive row-count mismatch/,
  );
  assert.match(
    rollingMigration,
    /if v_deleted <> v_unscoped then[\s\S]*removal row-count mismatch/,
  );
  assert.match(
    rollingMigration,
    /alter table legacy_archive\.job_queue_unscoped enable row level security/,
  );
});

test("v2 queue RPCs use UUID ids and the exact workspace lease contract", () => {
  assert.match(
    rollingMigration,
    /function public\.claim_job_v2\(\s*p_kind text,\s*p_lease_seconds integer\s*\)[\s\S]*returns table \(\s*id uuid,\s*workspace_id uuid,\s*kind text,\s*payload jsonb,\s*attempts integer,\s*max_attempts integer,\s*lease_token uuid/,
  );
  assert.match(
    rollingMigration,
    /function public\.heartbeat_job\(\s*p_workspace_id uuid,\s*p_id uuid,\s*p_lease_token uuid,\s*p_lease_seconds integer/,
  );
  assert.match(
    rollingMigration,
    /function public\.complete_job_v2\(\s*p_workspace_id uuid,\s*p_id uuid,\s*p_lease_token uuid/,
  );
  assert.match(
    rollingMigration,
    /function public\.cancel_job_v2\(\s*p_workspace_id uuid,\s*p_id uuid\s*\)[\s\S]*j\.workspace_id = p_workspace_id[\s\S]*j\.id = p_id[\s\S]*j\.status = 'pending'/,
  );
  assert.match(
    rollingMigration,
    /function public\.fail_job_v2\(\s*p_workspace_id uuid,\s*p_id uuid,\s*p_lease_token uuid,\s*p_error text/,
  );
  assert.doesNotMatch(rollingMigration, /queue_id bigint|\bid bigint,/);
});

test("claims are capped and v2 settlement requires a live matching lease", () => {
  assert.match(
    rollingMigration,
    /claim_job_v2[\s\S]*q\.attempts < q\.max_attempts[\s\S]*for update skip locked/,
  );
  assert.match(
    rollingMigration,
    /heartbeat_job[\s\S]*j\.workspace_id = p_workspace_id[\s\S]*j\.id = p_id[\s\S]*j\.lease_token = p_lease_token[\s\S]*j\.lease_expires_at > now\(\)/,
  );
  assert.match(
    rollingMigration,
    /complete_job_v2[\s\S]*j\.workspace_id = p_workspace_id[\s\S]*j\.id = p_id[\s\S]*j\.lease_token = p_lease_token[\s\S]*j\.lease_expires_at > now\(\)/,
  );
  assert.match(
    rollingMigration,
    /fail_job_v2[\s\S]*q\.workspace_id = p_workspace_id[\s\S]*q\.id = p_id[\s\S]*q\.lease_token = p_lease_token[\s\S]*q\.lease_expires_at > now\(\)[\s\S]*if not found then\s*return null/,
  );
  assert.match(rollingMigration, /return 'pending';/);
  assert.match(rollingMigration, /return 'failed';/);
  assert.doesNotMatch(
    rollingMigration,
    /status = 'failed',\s*status = 'failed'/,
  );
});

test("terminal failure and reaping preserve publishing reconciliation state", () => {
  const terminalPlanFilters = rollingMigration.match(
    /p\.status in \('approved', 'publishing'\)/g,
  );

  assert.ok(
    (terminalPlanFilters?.length ?? 0) >= 3,
    "v2 fail, rolling fail, and terminal reaper must all fence plan propagation",
  );
  assert.match(
    rollingMigration,
    /status = case\s*when p\.status = 'approved' then 'failed'\s*else p\.status\s*end/,
  );
  assert.match(
    rollingMigration,
    /reap_stale_jobs[\s\S]*v_job\.attempts >= v_job\.max_attempts[\s\S]*status = 'failed'/,
  );
  assert.match(rollingMigration, /last_error = t\.last_error/);
  assert.match(
    rollingMigration,
    /Publish did not complete after % automatic recovery attempts/,
  );
});

test("RPC and table access stays service-role-only", () => {
  for (const signature of [
    "claim_job_v2(text, integer)",
    "heartbeat_job(uuid, uuid, uuid, integer)",
    "cancel_job_v2(uuid, uuid)",
    "complete_job_v2(uuid, uuid, uuid)",
    "fail_job_v2(uuid, uuid, uuid, text)",
  ]) {
    assert.ok(
      rollingMigration.includes(
        `revoke execute on function public.${signature}`,
      ),
      `missing public revoke for ${signature}`,
    );
    assert.ok(
      rollingMigration.includes(
        `grant execute on function public.${signature}`,
      ),
      `missing service role grant for ${signature}`,
    );
  }

  assert.match(
    rollingMigration,
    /revoke all on public\.job_queue from public, anon, authenticated/,
  );
  assert.match(
    rollingMigration,
    /alter table public\.job_queue enable row level security/,
  );
  assert.match(
    rollingMigration,
    /alter table public\.job_queue force row level security/,
  );
});

test("cutover removes legacy claim, settlement, and producer RPCs", () => {
  assert.match(cutoverMigration, /drop function if exists public\.claim_job\(text\)/);
  assert.match(cutoverMigration, /drop function if exists public\.complete_job\(uuid\)/);
  assert.match(cutoverMigration, /drop function if exists public\.fail_job\(uuid, text\)/);
  assert.match(cutoverMigration, /drop function if exists public\.enqueue_job\(/);

  assert.match(
    rollingMigration,
    /legacy overload requires payload\.workspaceId/,
  );
  assert.match(
    rollingMigration,
    /where w\.id::text = p_payload ->> 'workspaceId'/,
  );
});

test("every queue producer passes workspace identity explicitly", () => {
  const enqueueHelper = readFileSync(
    "src/lib/providers/job-queue-enqueue.ts",
    "utf8",
  );
  assert.match(enqueueHelper, /workspaceId: string/);
  assert.match(enqueueHelper, /rpc\("enqueue_job_v2"/);
  assert.match(enqueueHelper, /p_workspace_id: input\.workspaceId/);
  assert.match(enqueueHelper, /rpc\("cancel_job_v2"/);
  assert.match(
    enqueueHelper,
    /cancelQueuedJob[\s\S]*p_workspace_id: input\.workspaceId[\s\S]*p_id: input\.jobId/,
  );
  assert.doesNotMatch(
    rollingMigration,
    /function public\.enqueue_job\(\s*p_workspace_id uuid/,
  );

  for (const path of [
    "src/lib/providers/meta-mutation-queue.ts",
    "src/lib/providers/lead-delivery-queue.ts",
    "src/lib/providers/meta-leads-queue.ts",
    "src/lib/providers/meta-publish-queue.ts",
    "src/lib/meta-monitor/reporting-refresh-queue.ts",
    "src/lib/providers/scheduled-maintenance.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      /enqueueQueuedJob\(\{\s*workspaceId:/,
      `${path} must pass workspaceId separately from payload`,
    );
  }
});

test("the publish queue remains the sole capped retry authority", () => {
  const maintenance = readFileSync(
    "src/lib/providers/scheduled-maintenance.ts",
    "utf8",
  );
  const publishQueue = readFileSync(
    "src/lib/providers/meta-publish-queue.ts",
    "utf8",
  );

  assert.match(
    maintenance,
    /recoverStuckMetaPublishPlans\(\{ stuckMinutes: 5 \}\)/,
  );
  assert.doesNotMatch(
    maintenance,
    /recoverStuckMetaPublishPlans\(\{[^}]*maxAttempts/,
  );
  assert.match(
    publishQueue,
    /queueMetaPublishPlanExecution[\s\S]*maxAttempts: 3/,
  );
  assert.match(
    rollingMigration,
    /reap_stale_jobs[\s\S]*v_job\.attempts >= v_job\.max_attempts/,
  );
});
