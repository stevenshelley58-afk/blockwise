import { task } from "@trigger.dev/sdk/v3";

import { buildAgentRuntimePolicy } from "../src/lib/ai-workforce/runtime-policy.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type AgentRunPayload = {
  workspaceId: string;
  agentKey:
    | "research_agent"
    | "pattern_classifier_agent"
    | "idea_agent"
    | "creative_brief_agent"
    | "campaign_draft_agent"
    | "compliance_agent"
    | "reporting_agent"
    | "support_agent"
    | "cost_control_agent";
  task: string;
  actorProfileId?: string;
  approvalIds?: string[];
};

export const runAgentWorkflow = task({
  id: "run-agent-workflow",
  run: async (payload: AgentRunPayload) => {
    const serviceSupabase = createSupabaseServiceClient();
    const { data: definition, error: definitionError } = await serviceSupabase
      .from("agent_definitions")
      .select("id")
      .eq("key", payload.agentKey)
      .maybeSingle();

    if (definitionError) {
      throw new Error(definitionError.message);
    }

    const { data: run, error: runError } = await serviceSupabase
      .from("agent_runs")
      .insert({
        workspace_id: payload.workspaceId,
        agent_definition_id: definition?.id ?? null,
        status: "running",
        task: payload.task,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runError) {
      throw new Error(runError.message);
    }

    const policy = buildAgentRuntimePolicy({
      workspaceId: payload.workspaceId,
      agentRunId: run.id,
      actorProfileId: payload.actorProfileId ?? "00000000-0000-0000-0000-000000000000",
      agentKey: payload.agentKey,
      approvalIds: payload.approvalIds,
    });

    await serviceSupabase.from("agent_steps").insert({
      workspace_id: payload.workspaceId,
      agent_run_id: run.id,
      step_key: "runtime_policy",
      status: "completed",
      input: { agentKey: payload.agentKey, task: payload.task },
      output: policy,
    });

    await serviceSupabase
      .from("agent_runs")
      .update({
        status: "completed",
        confidence: 0.8,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return {
      workspaceId: payload.workspaceId,
      agentRunId: run.id,
      agentKey: payload.agentKey,
      task: payload.task,
      status: "completed",
    };
  },
});
