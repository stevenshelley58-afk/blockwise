import { tasks } from "@trigger.dev/sdk/v3";

import type { MetaPlanMutation } from "./meta-mutations.ts";

export async function queueMetaMutationExecution(mutation: Pick<MetaPlanMutation, "workspaceId" | "mutationId">) {
  return tasks.trigger(
    "publish.meta.mutate",
    {
      workspaceId: mutation.workspaceId,
      mutationId: mutation.mutationId,
    },
    {
      concurrencyKey: `meta-mutation:${mutation.workspaceId}:${mutation.mutationId}`,
      tags: ["meta-mutation", mutation.workspaceId, mutation.mutationId],
      maxAttempts: 3,
    },
  );
}
