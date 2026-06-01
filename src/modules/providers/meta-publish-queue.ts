import { tasks } from "@trigger.dev/sdk/v3";

import { buildMetaPublishTaskOptions, type MetaPublishPlan } from "./meta-execution.ts";

export async function queueMetaPublishPlanExecution(plan: MetaPublishPlan, actorProfileId?: string | null) {
  return tasks.trigger(
    "publish.meta.execute",
    {
      workspaceId: plan.workspaceId,
      planId: plan.planId,
      actorProfileId: actorProfileId ?? null,
    },
    buildMetaPublishTaskOptions({
      workspaceId: plan.workspaceId,
      planId: plan.planId,
      idempotencyKey: plan.idempotencyKey,
    }),
  );
}
