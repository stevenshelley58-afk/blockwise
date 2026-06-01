import { tasks } from "@trigger.dev/sdk/v3";

export async function queueLeadDeliveryAttempt(input: {
  workspaceId: string;
  attemptId: string;
}) {
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
