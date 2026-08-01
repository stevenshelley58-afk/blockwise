import { randomUUID } from "node:crypto";
import { tasks } from "@trigger.dev/sdk/v3";

import { recordAuditLog } from "../supabase/audit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { buildMetaPublishTaskOptions, loadMetaPublishPlan, type MetaPublishPlan } from "./meta-execution.ts";

export async function queueMetaPublishPlanExecution(plan: MetaPublishPlan) {
  return tasks.trigger(
    "publish.meta.execute",
    {
      workspaceId: plan.workspaceId,
      planId: plan.planId,
    },
    buildMetaPublishTaskOptions({
      workspaceId: plan.workspaceId,
      planId: plan.planId,
      idempotencyKey: plan.idempotencyKey,
      attemptKey: plan.updatedAt,
    }),
  );
}

/**
 * Watchdog recovery: find publish plans stuck in `approved` (queued but the
 * Trigger.dev worker never picked them up) and re-queue them for execution.
 *
 * A plan counts as "stuck" when it has been `approved` longer than
 * `stuckMinutes` with no progress — i.e. the enqueue fired but the worker run
 * never started/advanced. Recovery is bounded by `maxAttempts` to avoid an
 * infinite re-queue loop if the worker keeps failing; once exhausted, the plan
 * is left in `approved` and flagged in the audit log so an operator sees it.
 *
 * Re-queueing is duplicate-safe: the Trigger.dev attemptKey embeds the plan's
 * `updated_at` (milliseconds), and `applyMetaPublishExecutionResult` always
 * writes a fresh `updated_at`, so every recovery pass enqueues a NEW attempt
 * rather than returning a cached dead run.
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
      const attempts = await supabase
        .from("publish_statuses")
        .select("status, error_message")
        .eq("publish_plan_id", planId)
        .order("created_at", { ascending: false });

      const history = (attempts.data ?? []) as Array<{
        status: string;
        error_message: string | null;
      }>;
      const attemptCount = history.length;

      // Exhausted the retry budget: stop re-queueing, surface for an operator.
      if (attemptCount >= maxAttempts) {
        result.exhausted += 1;
        await recordAuditLog(supabase, {
          workspaceId,
          actorProfileId: null,
          action: "meta.publish.watchdog.exhausted",
          targetType: "meta_publish_plan",
          targetId: planId,
          metadata: {
            attemptCount,
            maxAttempts,
            lastError: history[0]?.error_message ?? null,
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
