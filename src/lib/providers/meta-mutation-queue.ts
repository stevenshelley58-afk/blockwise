import { enqueueQueuedJob } from "./job-queue-enqueue.ts";
import type { MetaPlanMutation } from "./meta-mutations.ts";

/**
 * Mutations run on the VPS job_queue worker. The dedupe key collapses repeat
 * enqueues of the same mutation while one is still pending.
 */
export async function queueMetaMutationExecution(mutation: Pick<MetaPlanMutation, "workspaceId" | "mutationId">) {
  return enqueueQueuedJob({
    kind: "publish.meta.mutate",
    payload: { workspaceId: mutation.workspaceId, mutationId: mutation.mutationId },
    maxAttempts: 3,
    dedupeKey: `publish.meta.mutate:${mutation.mutationId}`,
  });
}
