export type WorkforceAction =
  | "capture_public_evidence"
  | "classify_pattern"
  | "generate_idea"
  | "draft_creative_brief"
  | "draft_campaign"
  | "run_compliance_review"
  | "summarize_reporting"
  | "queue_support_action"
  | "watch_costs"
  | "send_client_message"
  | "publish_provider_campaign"
  | "change_campaign_budget"
  | "export_lead_pii";

export type WorkforceDataClass =
  | "internal_operational"
  | "public_competitor_data"
  | "performance_metrics"
  | "campaign_draft"
  | "creative_asset"
  | "compliance_risk"
  | "support_metadata"
  | "cost_metadata"
  | "lead_pii"
  | "provider_token";

export type WorkforceDestination =
  | "internal_artifact"
  | "model_prompt"
  | "provider_api"
  | "client_message"
  | "external_export";

export type WorkforceAgent = {
  key: string;
  label: string;
  description: string;
  allowedActions: WorkforceAction[];
  allowedDataClasses: WorkforceDataClass[];
  allowedDestinations: WorkforceDestination[];
  allowedOutboundDomains: string[];
  maxRowsPerRun: number;
  canCrossWorkspace: boolean;
};

export const HUMAN_APPROVAL_ACTIONS: WorkforceAction[] = [
  "send_client_message",
  "publish_provider_campaign",
  "change_campaign_budget",
  "export_lead_pii",
];

const MODEL_OUTBOUND_DOMAINS = ["api.openai.com", "gateway.ai.cloudflare.com"];

export const WORKFORCE_AGENTS: WorkforceAgent[] = [
  {
    key: "research_agent",
    label: "Research Agent",
    description: "Checks watchlists, captures permitted public ad examples, and prepares review evidence.",
    allowedActions: ["capture_public_evidence", "classify_pattern"],
    allowedDataClasses: ["public_competitor_data", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 100,
    canCrossWorkspace: false,
  },
  {
    key: "pattern_classifier_agent",
    label: "Pattern Classifier Agent",
    description: "Classifies observed ads by hook, offer, creative type, suburb relevance, and risk.",
    allowedActions: ["classify_pattern"],
    allowedDataClasses: ["public_competitor_data", "compliance_risk", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 100,
    canCrossWorkspace: false,
  },
  {
    key: "idea_agent",
    label: "Idea Agent",
    description: "Turns patterns and owned performance into lead generation ideas.",
    allowedActions: ["generate_idea"],
    allowedDataClasses: ["public_competitor_data", "performance_metrics", "campaign_draft", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 100,
    canCrossWorkspace: false,
  },
  {
    key: "creative_brief_agent",
    label: "Creative Brief Agent",
    description: "Prepares prompts, carousel concepts, lead magnet covers, and brand-safe briefs.",
    allowedActions: ["draft_creative_brief"],
    allowedDataClasses: ["campaign_draft", "creative_asset", "public_competitor_data", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 50,
    canCrossWorkspace: false,
  },
  {
    key: "campaign_draft_agent",
    label: "Campaign Draft Agent",
    description: "Drafts Meta lead ad and Google Search campaign structures for review.",
    allowedActions: ["draft_campaign", "run_compliance_review"],
    allowedDataClasses: ["campaign_draft", "compliance_risk", "performance_metrics", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 50,
    canCrossWorkspace: false,
  },
  {
    key: "compliance_agent",
    label: "Compliance Agent",
    description: "Flags AU real-estate claim, housing targeting, urgency, and unsupported-performance risks.",
    allowedActions: ["run_compliance_review"],
    allowedDataClasses: ["campaign_draft", "creative_asset", "compliance_risk", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 50,
    canCrossWorkspace: false,
  },
  {
    key: "reporting_agent",
    label: "Reporting Agent",
    description: "Summarizes weekly performance and recommends next tests.",
    allowedActions: ["summarize_reporting"],
    allowedDataClasses: ["performance_metrics", "cost_metadata", "internal_operational"],
    allowedDestinations: ["internal_artifact", "model_prompt"],
    allowedOutboundDomains: MODEL_OUTBOUND_DOMAINS,
    maxRowsPerRun: 250,
    canCrossWorkspace: false,
  },
  {
    key: "support_agent",
    label: "Support Agent",
    description: "Detects onboarding, OAuth, generation, and campaign roadblocks.",
    allowedActions: ["queue_support_action"],
    allowedDataClasses: ["support_metadata", "internal_operational"],
    allowedDestinations: ["internal_artifact"],
    allowedOutboundDomains: [],
    maxRowsPerRun: 100,
    canCrossWorkspace: false,
  },
  {
    key: "cost_control_agent",
    label: "Cost Control Agent",
    description: "Watches model spend, failed generations, model drift, and expensive image usage.",
    allowedActions: ["watch_costs"],
    allowedDataClasses: ["cost_metadata", "internal_operational"],
    allowedDestinations: ["internal_artifact"],
    allowedOutboundDomains: [],
    maxRowsPerRun: 500,
    canCrossWorkspace: false,
  },
];

export function canWorkforceAgentPerformAction(agentKey: string, action: WorkforceAction): boolean {
  const agent = WORKFORCE_AGENTS.find((definition) => definition.key === agentKey);

  if (!agent) {
    return false;
  }

  return agent.allowedActions.includes(action);
}

export function requiresHumanApproval(action: WorkforceAction): boolean {
  return HUMAN_APPROVAL_ACTIONS.includes(action);
}
