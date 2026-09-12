import { enqueueQueuedJob } from "../providers/job-queue-enqueue.ts";

import { WARMED_REPORTING_RANGES } from "../monitor/dashboard-data.ts";
import type { MonitorCustomRange, MonitorRange } from "../meta-monitor/types.ts";
import { reportingRangeKey } from "../meta-monitor/reporting-snapshots.ts";

export async function queueReportingRefresh(input: {
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  reason: ReportingRefreshReason;
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

type ReportingRefreshReason = "stale_navigation" | "manual" | "connection" | "publish" | "mutation";

/**
 * Refresh every range a customer surface opens on. Home's figure row reads the
 * trailing month and Results opens on the trailing week, so a workspace
 * refreshed for one of them has to be refreshed for the other: the page a
 * customer lands on next would otherwise find no snapshot of its own range and
 * park on its fallback until the next scheduled pass.
 */
export async function queueReportingRefreshes(input: {
  workspaceId: string;
  reason: ReportingRefreshReason;
  requestedAt?: Date;
}): Promise<void> {
  await Promise.all(
    WARMED_REPORTING_RANGES.map((range) =>
      queueReportingRefresh({ ...input, range }),
    ),
  );
}
