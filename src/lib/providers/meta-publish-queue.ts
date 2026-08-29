import { randomUUID } from "node:crypto";

import { recordAuditLog } from "../supabase/audit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { enqueueQueuedJob } from "./job-queue-enqueue.ts";
import { loadMetaPublishPlan, type MetaPublishPlan } from "./meta-execution.ts";

/**
 * Publish execution runs on the VPS job_queue worker. A pending job with the same
 * dedupe key is reused instead of duplicated, fail_job retries with backoff up
 * to max_attempts, and reap_stale_jobs returns jobs held by a dead worker to
 * pending (see supabase/migrations/20260801030000_job_queue.sql).
 */
export async function queueMetaPublishPlanExecution(plan: MetaPublishPlan) {
  return enqueueQueuedJob({
    workspaceId: plan.workspaceId,
    kind: "publish.meta.execute",
    payload: { workspaceId: plan.workspaceId, planId: plan.planId },
    maxAttempts: 3,
    dedupeKey: `publish.meta.execute:${plan.planId}`,
  });
}

export async function hasActiveMetaPublishPlanExecution(input: {
  serviceSupabase?: ReturnType<typeof createSupabaseServiceClient>;
  workspaceId: string;
  planId: string;
}): Promise<boolean> {
  const state = await loadLatestMetaPublishPlanQueueState(input);
  return state?.status === "pending" || state?.status === "processing";
}

export async function loadLatestMetaPublishPlanQueueState(input: {
  serviceSupabase?: ReturnType<typeof createSupabaseServiceClient>;
  workspaceId: string;
  planId: string;
}): Promise<{ status: "pending" | "processing" | "completed" | "failed"; lastError: string | null } | null> {
  const supabase = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("job_queue")
    .select("status,last_error")
    .eq("workspace_id", input.workspaceId)
    .eq("kind", "publish.meta.execute")
    .eq("dedupe_key", `publish.meta.execute:${input.planId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to inspect the publish queue: ${error.message}`);
  }

  if (!data) return null;
  return {
    status: data.status as "pending" | "processing" | "completed" | "failed",
    lastError: typeof data.last_error === "string" ? data.last_error : null,
  };
}

/**
 * Watchdog recovery: find approved plans that were never queued and enqueue
 * them. A publishing plan is provider-ambiguous and is deliberately
 * quarantined for an explicit user retry after its queue budget is exhausted.
 *
 * The queue is the sole retry authority. Historical watchdog audit rows never
 * consume a new publish's retry budget. Active jobs are left untouched.
 */
export interface RecoverStuckPublishPlansResult {
  scanned: number;
  recovered: number;
  errors: string[];
  recoveredPlanIds: string[];
}

export async function recoverStuckMetaPublishPlans(options?: {
  stuckMinutes?: number;
}): Promise<RecoverStuckPublishPlansResult> {
  const stuckMinutes = options?.stuckMinutes ?? 5;
  const result: RecoverStuckPublishPlansResult = {
    scanned: 0,
    recovered: 0,
    errors: [],
    recoveredPlanIds: [],
  };

  const supabase = createSupabaseServiceClient();
  const cutoff = new Date(Date.now() - stuckMinutes * 60_000).toISOString();

  // Stuck = approved but never queued, and untouched beyond the window.
  const { data: rows, error: listError } = await supabase
    .from("meta_publish_plans")
    .select("*")
    .eq("status", "approved")
    .lt("updated_at", cutoff)
    .limit(25);

  if (listError) {
    throw new Error(`Failed to query stuck publish plans: ${listError.message}`);
  }

  result.scanned = rows?.length ?? 0;

  for (const row of rows ?? []) {
    const planId = String(row.id ?? "");
    const workspaceId = row.workspace_id ? String(row.workspace_id) : null;
    if (!planId || !workspaceId) continue;

    try {
      const active = await hasActiveMetaPublishPlanExecution({
        serviceSupabase: supabase,
        workspaceId,
        planId,
      });
      if (active) continue;

      const plan = await loadMetaPublishPlan(supabase, { workspaceId, planId });

      await queueMetaPublishPlanExecution(plan);
      result.recovered += 1;
      result.recoveredPlanIds.push(planId);

      await recordAuditLog(supabase, {
        workspaceId,
        actorProfileId: null,
        action: "meta.publish.watchdog.recover",
        targetType: "meta_publish_plan",
        targetId: planId,
        metadata: {
          stuckMinutes,
          planStatus: row.status,
        },
        correlationId: randomUUID(),
      });
    } catch (error) {
      result.errors.push(
        `Plan ${planId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}
