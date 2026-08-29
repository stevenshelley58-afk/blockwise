import { enqueueQueuedJob } from "../providers/job-queue-enqueue.ts";

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

  return enqueueQueuedJob({
    workspaceId: input.workspaceId,
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
