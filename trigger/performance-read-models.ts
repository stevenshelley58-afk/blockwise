import { schedules, task } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import { resolveCustomerActivation } from "../src/lib/activation/customer-activation.ts";
import { refreshReportingSnapshot } from "../src/lib/meta-monitor/reporting-snapshots.ts";
import type { MonitorCustomRange, MonitorRange } from "../src/lib/meta-monitor/types.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type ReportingRefreshPayload = {
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  reason: "stale_navigation" | "manual" | "connection" | "publish" | "mutation" | "scheduled";
};

type ActivationReconcilePayload = {
  workspaceId: string;
  reason: "scheduled" | "source_changed";
};

export const refreshMetaReportingTask = task({
  id: "refresh.meta.reporting",
  queue: { concurrencyLimit: 4 },
  run: async (payload: ReportingRefreshPayload) => {
    const snapshot = await refreshReportingSnapshot({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: payload.workspaceId,
      range: payload.range,
      customRange: payload.customRange,
    });

    return {
      workspaceId: payload.workspaceId,
      rangeKey: snapshot.rangeKey,
      generatedAt: snapshot.generatedAt,
      reason: payload.reason,
    };
  },
});

export const reconcileCustomerActivationTask = task({
  id: "reconcile.customer.activation",
  queue: { concurrencyLimit: 4 },
  run: async (payload: ActivationReconcilePayload) => {
    const activation = await resolveCustomerActivation({
      workspaceId: payload.workspaceId,
      serviceSupabase: createSupabaseServiceClient(),
      repair: true,
    });

    return {
      workspaceId: payload.workspaceId,
      repairedMilestones: activation.repairedMilestones,
      reason: payload.reason,
    };
  },
});

export const scheduledPerformanceReadModelsTask = schedules.task({
  id: "refresh.performance-read-models.scheduled",
  cron: {
    pattern: "*/15 * * * *",
    timezone: "Australia/Perth",
  },
  run: async () => {
    const service = createSupabaseServiceClient();
    const [{ data: connections, error: connectionError }, { data: workspaces, error: workspaceError }] =
      await Promise.all([
        service
          .from("provider_connections")
          .select("workspace_id")
          .eq("provider", "meta")
          .eq("status", "connected")
          .limit(200),
        service.from("workspaces").select("id").limit(200),
      ]);

    if (connectionError) throw new Error(connectionError.message);
    if (workspaceError) throw new Error(workspaceError.message);

    const reportingWorkspaceIds = [
      ...new Set(((connections ?? []) as Array<{ workspace_id: string }>).map((row) => row.workspace_id)),
    ];
    const activationWorkspaceIds = ((workspaces ?? []) as Array<{ id: string }>).map((row) => row.id);
    const [reporting, activation] = await Promise.all([
      runWithConcurrency(reportingWorkspaceIds, 3, async (workspaceId) => {
        await refreshReportingSnapshot({
          serviceSupabase: service,
          workspaceId,
          range: "last_30",
        });
      }),
      runWithConcurrency(activationWorkspaceIds, 4, async (workspaceId) => {
        await resolveCustomerActivation({
          workspaceId,
          serviceSupabase: service,
          repair: true,
        });
      }),
    ]);

    return {
      reporting,
      activation,
    };
  },
});

async function runWithConcurrency(
  workspaceIds: string[],
  concurrency: number,
  run: (workspaceId: string) => Promise<void>,
): Promise<{ attempted: number; completed: number; failed: number }> {
  let cursor = 0;
  let completed = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(concurrency, workspaceIds.length) }, async () => {
    while (cursor < workspaceIds.length) {
      const workspaceId = workspaceIds[cursor++];
      if (!workspaceId) continue;
      try {
        await run(workspaceId);
        completed += 1;
      } catch (error) {
        failed += 1;
        Sentry.captureException(error, { tags: { workspaceId } });
      }
    }
  });

  await Promise.all(workers);
  return { attempted: workspaceIds.length, completed, failed };
}
