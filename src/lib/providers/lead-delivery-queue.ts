import { tasks } from "@trigger.dev/sdk/v3";

import { enqueueQueuedJob, isQueuedKind } from "./job-queue-enqueue.ts";

export async function queueLeadDeliveryAttempt(input: {
  workspaceId: string;
  attemptId: string;
}) {
  if (isQueuedKind("deliver.lead")) {
    return enqueueQueuedJob({
      kind: "deliver.lead",
      payload: { workspaceId: input.workspaceId, attemptId: input.attemptId },
      maxAttempts: 3,
      dedupeKey: `deliver-lead:${input.workspaceId}:${input.attemptId}`,
    });
  }

  return tasks.trigger(
    "deliver.lead",
    {
      workspaceId: input.workspaceId,
      attemptId: input.attemptId,
    },
    {
      concurrencyKey: `lead-delivery:${input.workspaceId}:${input.attemptId}`,
      tags: ["lead-delivery", input.workspaceId, input.attemptId],
      maxAttempts: 3,
    },
  );
}
