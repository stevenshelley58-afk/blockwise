import { AGENT_DEFINITIONS } from "@/lib/agents/permissions";
import type { StatusTone } from "@/components/status-pill";

export const workspace = {
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
