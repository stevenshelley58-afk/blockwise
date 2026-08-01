import { tasks } from "@trigger.dev/sdk/v3";

import { enqueueQueuedJob, isQueuedKind } from "../providers/job-queue-enqueue.ts";

import type { MonitorCustomRange, MonitorRange } from "../meta-monitor/types.ts";
import { reportingRangeKey } from "../meta-monitor/reporting-snapshots.ts";

export async function queueReportingRefresh(input: {
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  reason: "stale_navigation" | "manual" | "connection" | "publish" | "mutation";
  requestedAt?: Date;
}) {
  const requestedAt = input.requestedAt ?? new Date();
  const bucketMs = input.reason === "manual" ? 60_000 : 15 * 60_000;
  const bucket = Math.floor(requestedAt.getTime() / bucketMs);
  const rangeKey = reportingRangeKey(input.range, input.customRange);

  if (isQueuedKind("reporting.refresh")) {
    return enqueueQueuedJob({
      kind: "reporting.refresh",
      payload: {
        workspaceId: input.workspaceId,
        range: input.range,
        customRange: input.customRange,
        reason: input.reason,
      },
      maxAttempts: 3,
      dedupeKey: `reporting:${input.workspaceId}:${rangeKey}:${input.reason}:${bucket}`,
    });
  }

  return tasks.trigger(
    "refresh.meta.reporting",
    {
      workspaceId: input.workspaceId,
      range: input.range,
      customRange: input.customRange,
      reason: input.reason,
    },
    {
      idempotencyKey: `reporting:${input.workspaceId}:${rangeKey}:${input.reason}:${bucket}`,
      concurrencyKey: `reporting:${input.workspaceId}:${rangeKey}`,
      tags: ["meta-reporting", input.workspaceId, rangeKey, input.reason],
      maxAttempts: 3,
    },
  );
}
