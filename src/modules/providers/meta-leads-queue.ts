import { tasks } from "@trigger.dev/sdk/v3";

export async function queueMetaLeadSync(input: {
  workspaceId: string;
  planId: string;
  since?: string | null;
}) {
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
