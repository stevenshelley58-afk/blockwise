import { enqueueQueuedJob } from "./job-queue-enqueue.ts";

export async function queueLeadDeliveryAttempt(input: {
  workspaceId: string;
  attemptId: string;
}) {
  return enqueueQueuedJob({
    kind: "deliver.lead",
    payload: { workspaceId: input.workspaceId, attemptId: input.attemptId },
    maxAttempts: 3,
    dedupeKey: `deliver-lead:${input.workspaceId}:${input.attemptId}`,
  });
}
