import { AGENT_DEFINITIONS } from "@/lib/ai-workforce/permissions";
import { listModelProfiles } from "@/lib/model-control/model-registry";
import type { StatusTone } from "@/components/status-pill";

export const workspace = {
  id: "workspace_demo",
  name: "Northstar Realty",
  mode: "self_serve",
  plan: "Growth",
  region: "Australia",
  suburbs: ["Subiaco", "Leederville", "Mount Lawley", "Cottesloe"],
};

export const operatorMetrics = [
  { label: "Active workspaces", value: "18", note: "14 monitor, 4 self-serve" },
  { label: "AI spend", value: "$328", note: "Month to date across all profiles" },
  { label: "Agent queue", value: "27", note: "9 need operator action" },
  { label: "Approval queue", value: "6", note: "Publishing remains blocked until approval" },
];

export const workspaceRows = [
  {
    name: "Northstar Realty",
    mode: "Self-Serve",
    plan: "Growth",
    sync: "Google reconnect",
    spend: "$84.20",
    statusTone: "amber" as StatusTone,
  },
  {
    name: "Harbour Edge Property",
    mode: "Monitor",
    plan: "Starter",
    sync: "Healthy",
    spend: "$21.35",
    statusTone: "green" as StatusTone,
  },
  {
    name: "Metro Nest",
    mode: "Managed",
    plan: "Operator",
    sync: "Lead webhook retrying",
    spend: "$148.00",
    statusTone: "rose" as StatusTone,
  },
];

export const approvalQueue = [
  {
    title: "Meta lead ad draft",
    workspace: "Northstar Realty",
    risk: "Housing targeting review",
    status: "Client approval required",
  },
  {
    title: "Google Search budget change",
    workspace: "Metro Nest",
    risk: "Budget increase",
    status: "Operator approval required",
  },
  {
    title: "Lead CSV export",
    workspace: "Harbour Edge Property",
    risk: "PII export",
    status: "Operator approval required",
  },
];

export const agentRuns = AGENT_DEFINITIONS.slice(0, 6).map((agent, index) => ({
  agent: agent.label,
  task: agent.description,
  status: index % 3 === 0 ? "Needs review" : index % 3 === 1 ? "Running" : "Complete",
  workspace: index % 2 === 0 ? "Northstar Realty" : "Harbour Edge Property",
  cost: `$${(0.08 + index * 0.11).toFixed(2)}`,
  confidence: `${84 - index * 3}%`,
}));

export const modelRows = listModelProfiles()
  .filter((profile) => profile.key !== "disabled_profile")
  .map((profile) => ({
    profile: profile.label,
    task: profile.task,
    primary: profile.primary.model,
    fallbackCount: profile.fallbacks.length,
    maxCost: `$${profile.maxRunCostUsd.toFixed(2)}`,
    status: profile.enabled ? "Enabled" : "Disabled",
  }));

export const competitorSignals = [
  {
    competitor: "Perth Appraisal Co.",
    signal: "Seller guide ads highlight suburb price movement and free appraisal CTA.",
    evidence: "Public ad library capture",
    confidence: "91%",
  },
  {
    competitor: "Urban Door Realty",
    signal: "Carousel creatives compare renovated vs original homes for appraisal intent.",
    evidence: "Screenshot and landing capture",
    confidence: "83%",
  },
  {
    competitor: "Westside Agents",
    signal: "Urgency copy appears unsupported and should be avoided in client creative.",
    evidence: "Compliance classifier",
    confidence: "78%",
  },
];

export const campaignIdeas = [
  {
    title: "Suburb appraisal pulse",
    channel: "Meta + Google",
    hook: "See how buyer demand shifted in your suburb this month.",
    approval: "Compliance check pending",
  },
  {
    title: "Downsizer decision guide",
    channel: "Meta lead form",
    hook: "A practical checklist for owners weighing a 2026 sale.",
    approval: "Ready for operator review",
  },
  {
    title: "Renovate or sell calculator",
    channel: "Google Search",
    hook: "Capture high-intent owners comparing sale vs renovation value.",
    approval: "Needs landing-page evidence",
  },
];

export const campaignDrafts = [
  {
    id: "campaign_meta_appraisal_pulse",
    name: "Suburb Appraisal Pulse",
    provider: "Meta",
    channel: "Lead ad",
    status: "Blocked pending approval",
    approvalStatus: "requested",
    complianceStatus: "approved",
    providerConnectionStatus: "connected",
    draftPayload: {
      objective: "LEAD_GENERATION",
      headline: "What changed in your suburb this month?",
      callToAction: "Get report",
    },
  },
  {
    id: "campaign_google_appraisal_search",
    name: "High-Intent Appraisal Search",
    provider: "Google",
    channel: "Search",
    status: "Blocked by provider health",
    approvalStatus: "approved",
    complianceStatus: "approved",
    providerConnectionStatus: "needs_attention",
    draftPayload: {
      keywords: ["property appraisal subiaco", "real estate appraisal perth"],
      headline: "Local Appraisal Guide",
    },
  },
  {
    id: "campaign_meta_weekend_urgency",
    name: "Weekend Seller Push",
    provider: "Meta",
    channel: "Lead ad",
    status: "Blocked by compliance",
    approvalStatus: "approved",
    complianceStatus: "blocked",
    providerConnectionStatus: "connected",
    draftPayload: {
      objective: "LEAD_GENERATION",
      headline: "Guaranteed top price this weekend",
    },
  },
];

export const leads = [
  {
    id: "lead_001",
    name: "Amelia Hart",
    email: "amelia@example.com",
    phone: "0400 111 222",
    suburb: "Subiaco",
    source: "Meta lead form",
    quality: "High intent",
    createdAt: "2026-05-26T03:20:00.000Z",
  },
  {
    id: "lead_002",
    name: "Daniel Ng",
    email: "daniel@example.com",
    phone: "0400 333 444",
    suburb: "Leederville",
    source: "Google lead form",
    quality: "Needs nurture",
    createdAt: "2026-05-25T09:40:00.000Z",
  },
  {
    id: "lead_003",
    name: "Sofia Lane",
    email: "sofia@example.com",
    phone: "0400 555 666",
    suburb: "Mount Lawley",
    source: "CSV import",
    quality: "Unqualified",
    createdAt: "2026-05-24T12:10:00.000Z",
  },
];

export const aiLedgerPreview = [
  {
    id: "ai_run_hook_draft",
    workspace: "Northstar Realty",
    profile: "cheap_draft_text",
    task: "campaign_hook_draft",
    model: "gpt-4.1-mini",
    status: "completed",
    cost: "$0.01",
  },
  {
    id: "ai_run_final_image",
    workspace: "Northstar Realty",
    profile: "image_final",
    task: "final_image_generation",
    model: "gpt-image-1.5",
    status: "blocked",
    cost: "$2.36",
  },
  {
    id: "ai_run_compliance",
    workspace: "Metro Nest",
    profile: "compliance_review",
    task: "real_estate_compliance",
    model: "gpt-4.1-mini",
    status: "completed",
    cost: "$0.02",
  },
];

export const onboardingSteps = [
  { label: "Plan assigned", state: "Complete" },
  { label: "Agency profile", state: "Complete" },
  { label: "Service suburbs", state: "Complete" },
  { label: "Brand setup", state: "In progress" },
  { label: "Meta connection", state: "Connected" },
  { label: "Google connection", state: "Needs attention" },
];
