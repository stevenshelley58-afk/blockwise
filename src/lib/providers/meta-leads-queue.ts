import { tasks } from "@trigger.dev/sdk/v3";

import { enqueueQueuedJob, isQueuedKind } from "./job-queue-enqueue.ts";

export async function queueMetaLeadSync(input: {
  workspaceId: string;
  planId: string;
  since?: string | null;
}) {
  if (isQueuedKind("sync.meta.leads")) {
    return enqueueQueuedJob({
      kind: "sync.meta.leads",
      payload: {
        workspaceId: input.workspaceId,
        planId: input.planId,
        since: input.since ?? null,
      },
      maxAttempts: 3,
      dedupeKey: `sync-meta-leads:${input.workspaceId}:${input.planId}`,
    });
  }

  return tasks.trigger(
    "sync.meta.leads",
    {
      workspaceId: input.workspaceId,
      planId: input.planId,
      since: input.since ?? null,
    },
    {
      concurrencyKey: `meta-leads:${input.workspaceId}:${input.planId}`,
      tags: ["meta-leads", input.workspaceId, input.planId],
      maxAttempts: 3,
    },
  );
}
