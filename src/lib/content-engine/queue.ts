import { tasks } from "@trigger.dev/sdk/v3";

import type { ContentSkillName } from "./contracts.ts";

export async function queueContentRun(input: {
  workspaceId: string;
  runId: string;
  fromStep?: ContentSkillName;
}) {
  return tasks.trigger(
    "content.run",
    input,
    {
      concurrencyKey: `content-run:${input.workspaceId}:${input.runId}`,
      tags: ["content-run", input.workspaceId, input.runId],
      maxAttempts: 1,
    },
  );
}

