import { schedules, task } from "@trigger.dev/sdk/v3";

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
};

export const scheduledCompetitorResearch = schedules.task({
  id: "scheduled-competitor-research",
  cron: "0 9 * * 1",
  run: async () => {
    return {
      scheduled: true,
      agentKey: "research_agent",
      safety: "Workers call Blockwise APIs only; raw provider tokens and service-role keys are never passed to agents.",
    };
  },
});

export const runAgentWorkflow = task({
  id: "run-agent-workflow",
  run: async (payload: AgentRunPayload) => {
    return {
      workspaceId: payload.workspaceId,
      agentKey: payload.agentKey,
      task: payload.task,
      status: "queued_for_native_worker",
    };
  },
});
