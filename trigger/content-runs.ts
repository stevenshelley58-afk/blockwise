import { task } from "@trigger.dev/sdk/v3";

import { runContentRun } from "../src/lib/content-engine/orchestrator.ts";
import type { ContentSkillName } from "../src/lib/content-engine/contracts.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type ContentRunPayload = {
  workspaceId: string;
  runId: string;
  fromStep?: ContentSkillName;
};

export const runContentWorkflow = task({
  id: "content.run",
  run: async (payload: ContentRunPayload) => {
    const supabase = createSupabaseServiceClient();

    return runContentRun({
      supabase: supabase as never,
      runId: payload.runId,
      fromStep: payload.fromStep,
    });
  },
});

