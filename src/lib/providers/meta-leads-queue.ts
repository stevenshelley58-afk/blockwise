import { enqueueQueuedJob } from "./job-queue-enqueue.ts";

export async function queueMetaLeadSync(input: {
  workspaceId: string;
  planId: string;
  since?: string | null;
}) {
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
