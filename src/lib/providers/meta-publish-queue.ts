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
    kind: "publish.meta.execute",
    payload: { workspaceId: plan.workspaceId, planId: plan.planId },
    maxAttempts: 3,
    dedupeKey: `publish.meta.execute:${plan.planId}`,
  });
}

/**
 * Watchdog recovery: find publish plans stuck in `approved` (queued but never
 * executed) and re-enqueue them for execution.
 *
 * A plan counts as "stuck" when it has been `approved` longer than
 * `stuckMinutes` with no progress. Recovery is bounded by `maxAttempts`, and
 * the attempt count comes from this watchdog's own recovery audit trail —
 * once exhausted, the plan is moved to `failed` (retryable from Ad Studio) so
 * it stops being rescanned, and the exhaustion is audited for an operator.
 *
 * Re-enqueueing is duplicate-safe at the queue layer: enqueue_job reuses a
 * pending/processing job with the same dedupe key instead of inserting a
 * duplicate.
 */
export interface RecoverStuckPublishPlansResult {
  scanned: number;
  recovered: number;
  exhausted: number;
  errors: string[];
  recoveredPlanIds: string[];
}

export async function recoverStuckMetaPublishPlans(options?: {
  stuckMinutes?: number;
  maxAttempts?: number;
}): Promise<RecoverStuckPublishPlansResult> {
  const stuckMinutes = options?.stuckMinutes ?? 5;
  const maxAttempts = options?.maxAttempts ?? 3;
  const result: RecoverStuckPublishPlansResult = {
    scanned: 0,
    recovered: 0,
    exhausted: 0,
    errors: [],
    recoveredPlanIds: [],
  };

  const supabase = createSupabaseServiceClient();
  const cutoff = new Date(Date.now() - stuckMinutes * 60_000).toISOString();

  // Stuck = approved (queued) and untouched for longer than the window.
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
      // Count prior recoveries from the watchdog's own audit trail. (The
      // previous implementation queried publish_statuses by a column that does
      // not exist; the error was swallowed, the count was always zero, and a
      // permanently failing plan was re-queued every five minutes forever.)
      const { count, error: attemptsError } = await supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("action", "meta.publish.watchdog.recover")
        .eq("target_type", "meta_publish_plan")
        .eq("target_id", planId);

      if (attemptsError) {
        throw new Error(`Failed to count recovery attempts: ${attemptsError.message}`);
      }

      const attemptCount = count ?? 0;

      // Exhausted the retry budget: move the plan out of "approved" so it is
      // not rescanned forever, surface the failure, and stop.
      if (attemptCount >= maxAttempts) {
        result.exhausted += 1;
        await supabase
          .from("meta_publish_plans")
          .update({
            status: "failed",
            last_error: `Publish did not complete after ${attemptCount} automatic recovery attempts. Open Ad Studio and publish again.`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", planId)
          .eq("workspace_id", workspaceId);
        await recordAuditLog(supabase, {
          workspaceId,
          actorProfileId: null,
          action: "meta.publish.watchdog.exhausted",
          targetType: "meta_publish_plan",
          targetId: planId,
          metadata: {
            attemptCount,
            maxAttempts,
            lastError: typeof row.last_error === "string" ? row.last_error : null,
          },
          correlationId: randomUUID(),
        });
        continue;
      }

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
          priorAttemptCount: attemptCount,
          maxAttempts,
          stuckMinutes,
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
