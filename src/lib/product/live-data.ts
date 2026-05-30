import { evaluatePublishReadiness, type ApprovalStatus, type ProviderConnectionStatus } from "../campaigns/publishing.ts";
import type { ComplianceStatus } from "../compliance/real-estate-policy.ts";
import { buildLeadDedupeKey, findDuplicateLeadIds } from "../leads/dedupe.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ProviderKey = "meta" | "google";

type CampaignRow = {
  id: string;
  name: string;
  provider?: ProviderKey | string | null;
  status?: string | null;
  draft_payload?: Record<string, unknown> | null;
};

type ApprovalRow = {
  id?: string;
  target_id?: string | null;
  target_type?: string | null;
  status?: string | null;
  risk_summary?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ComplianceReportRow = {
  campaign_id?: string | null;
  status?: string | null;
};

type ProviderConnectionRow = {
  provider?: ProviderKey | string | null;
  status?: string | null;
};

type LeadRow = {
  id: string;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  suburb?: string | null;
  provider?: ProviderKey | string | null;
  created_at?: string | null;
};

type LeadLabelRow = {
  lead_id?: string | null;
  label?: string | null;
};

type LeadAttributionRow = {
  lead_id?: string | null;
  source?: Record<string, unknown> | null;
};

type LeadDedupeRow = {
  lead_id?: string | null;
  duplicate_of_lead_id?: string | null;
};

type AgentRunRow = {
  id: string;
  status?: string | null;
  task?: string | null;
  confidence?: number | string | null;
  error_message?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
  agent_definitions?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type AiLedgerRow = {
  id: string;
  provider?: string | null;
  model?: string | null;
  task?: string | null;
  output_type?: string | null;
  result?: string | null;
  estimated_cost_cents?: number | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ResearchSignalRow = {
  competitor?: string | null;
  signal?: string | null;
  evidence?: string | null;
  confidence?: number | string | null;
  page_name?: string | null;
  library_id?: string | null;
  headline?: string | null;
  body?: string | null;
  active_status?: string | null;
  last_seen_at?: string | null;
  postcodes?: string[] | null;
};

export function buildCampaignReadinessRows(input: {
  campaigns: CampaignRow[];
  approvals: ApprovalRow[];
  complianceReports: ComplianceReportRow[];
  providerConnections: ProviderConnectionRow[];
}) {
  const latestApprovalByCampaign = new Map(
    input.approvals
      .filter((approval) => approval.target_id)
      .map((approval) => [approval.target_id as string, normalizeApprovalStatus(approval.status)]),
  );
  const latestComplianceByCampaign = new Map(
    input.complianceReports
      .filter((report) => report.campaign_id)
      .map((report) => [report.campaign_id as string, normalizeComplianceStatus(report.status)]),
  );
  const providerStatus = new Map(
    input.providerConnections
      .filter((connection) => connection.provider)
      .map((connection) => [String(connection.provider), normalizeProviderConnectionStatus(connection.status)]),
  );

  return input.campaigns.map((campaign) => {
    const provider = normalizeProvider(campaign.provider);
    const approvalStatus = latestApprovalByCampaign.get(campaign.id) ?? "draft";
    const complianceStatus =
      latestComplianceByCampaign.get(campaign.id) ??
      normalizeComplianceStatus(String(campaign.draft_payload?.complianceStatus ?? campaign.draft_payload?.compliance_status ?? ""));
    const readiness = evaluatePublishReadiness({
      providerConnectionStatus: providerStatus.get(provider) ?? "not_connected",
      approvalStatus,
      complianceStatus,
      hasDraftPayload: Object.keys(campaign.draft_payload ?? {}).length > 0,
    });

    return {
      id: campaign.id,
      name: campaign.name,
      provider: formatProvider(provider),
      channel: provider === "meta" ? "Lead ad" : "Search",
      status: campaign.status ?? "draft",
      approvalStatus,
      complianceStatus,
      providerConnectionStatus: providerStatus.get(provider) ?? "not_connected",
      draftPayload: campaign.draft_payload ?? {},
      readiness,
    };
  });
}

export function buildLeadRowsWithDedupe(input: {
  leads: LeadRow[];
  labels?: LeadLabelRow[];
  attributions?: LeadAttributionRow[];
  dedupeRecords?: LeadDedupeRow[];
  incoming?: { email?: string; phone?: string };
}) {
  const labelByLead = new Map((input.labels ?? []).map((label) => [label.lead_id, label.label]));
  const attributionByLead = new Map((input.attributions ?? []).map((attribution) => [attribution.lead_id, attribution.source]));
  const duplicateLeadIds = new Set(
    (input.dedupeRecords ?? [])
      .filter((record) => record.duplicate_of_lead_id)
      .map((record) => record.lead_id)
      .filter((leadId): leadId is string => Boolean(leadId)),
  );
  const rows = input.leads.map((lead) => {
    const source = sourceLabel(lead.provider);
    const attribution = attributionByLead.get(lead.id);

    return {
      id: lead.id,
      name: lead.full_name ?? lead.name ?? "Unknown lead",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      suburb: lead.suburb ?? "Unknown",
      source,
      quality: labelByLead.get(lead.id) ?? "Unlabelled",
      createdAt: lead.created_at ?? new Date(0).toISOString(),
      dedupeKey: buildLeadDedupeKey({ email: lead.email ?? "", phone: lead.phone ?? "" }),
      duplicateCandidate: duplicateLeadIds.has(lead.id),
      attribution: extractAttributionLabel(attribution),
    };
  });
  const incoming = input.incoming ?? {};
  const incomingDedupeKey = buildLeadDedupeKey(incoming);

  return {
    rows,
    incoming: {
      ...incoming,
      dedupeKey: incomingDedupeKey,
      duplicateIds: incomingDedupeKey ? findDuplicateLeadIds(rows, incoming) : [],
    },
  };
}

export function buildApprovalRows(rows: ApprovalRow[]) {
  return rows.map((row) => ({
    id: row.id ?? `${row.target_type ?? "approval"}-${row.target_id ?? "unknown"}`,
    title: `${row.target_type ?? "Action"} approval`,
    workspace: one(row.workspaces)?.name ?? "Workspace",
    risk: row.risk_summary ?? "Review required",
    status: row.status ?? "requested",
  }));
}

export function buildAgentRunRows(rows: AgentRunRow[]) {
  return rows.map((row) => ({
    id: row.id,
    agent: one(row.agent_definitions)?.name ?? "Agent",
    task: row.task ?? "Queued task",
    status: formatAgentStatus(row.status),
    workspace: one(row.workspaces)?.name ?? "Workspace",
    cost: "$0.00",
    confidence: formatConfidence(row.confidence),
    ...(row.error_message ? { error: row.error_message } : {}),
  }));
}

export function buildAiLedgerRows(rows: AiLedgerRow[]) {
  return rows.map((row) => ({
    id: row.id,
    workspace: one(row.workspaces)?.name ?? "Workspace",
    profile: row.provider ?? "unknown",
    task: row.task ?? "unknown_task",
    provider: row.provider ?? "unknown",
    model: row.model ?? "unknown",
    usage: row.output_type ?? "unknown",
    estimatedCost: cents(row.estimated_cost_cents ?? 0),
    result: row.result ?? "completed",
  }));
}

export function buildResearchSignals(rows: ResearchSignalRow[]) {
  return rows.map((row) => ({
    competitor: row.competitor ?? "Unknown competitor",
    signal: row.signal ?? "No signal summary",
    evidence: row.evidence ?? "Evidence pending",
    confidence: formatConfidence(row.confidence),
  }));
}

export async function listCampaignReadinessRows(supabase: SupabaseServerClient, workspaceId: string) {
  const [{ data: campaigns }, { data: approvals }, { data: complianceReports }, { data: providerConnections }] =
    await Promise.all([
      supabase.from("campaigns").select("id,name,provider,status,draft_payload").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
      supabase.from("approval_requests").select("target_id,status,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("adstudio_compliance_reports").select("campaign_id,status,checked_at").eq("workspace_id", workspaceId).order("checked_at", { ascending: false }),
      supabase.from("provider_connections").select("provider,status").eq("workspace_id", workspaceId),
    ]);

  return buildCampaignReadinessRows({
    campaigns: (campaigns ?? []) as CampaignRow[],
    approvals: (approvals ?? []) as ApprovalRow[],
    complianceReports: (complianceReports ?? []) as ComplianceReportRow[],
    providerConnections: (providerConnections ?? []) as ProviderConnectionRow[],
  });
}

export async function listLeadRowsWithDedupe(supabase: SupabaseServerClient, workspaceId: string) {
  const { data: leads } = await supabase
    .from("leads")
    .select("id,full_name,email,phone,suburb,provider,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  const leadIds = ((leads ?? []) as LeadRow[]).map((lead) => lead.id);

  if (leadIds.length === 0) {
    return buildLeadRowsWithDedupe({ leads: [] });
  }

  const [{ data: labels }, { data: attributions }, { data: dedupeRecords }] = await Promise.all([
    supabase.from("lead_quality_labels").select("lead_id,label").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase.from("lead_source_attribution").select("lead_id,source").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase.from("lead_dedupe_records").select("lead_id,duplicate_of_lead_id").eq("workspace_id", workspaceId).in("lead_id", leadIds),
  ]);

  return buildLeadRowsWithDedupe({
    leads: (leads ?? []) as LeadRow[],
    labels: (labels ?? []) as LeadLabelRow[],
    attributions: (attributions ?? []) as LeadAttributionRow[],
    dedupeRecords: (dedupeRecords ?? []) as LeadDedupeRow[],
  });
}

export async function listApprovalRows(supabase: SupabaseServerClient, workspaceId: string) {
  const { data } = await supabase
    .from("approval_requests")
    .select("id,target_type,target_id,status,risk_summary,workspaces(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return buildApprovalRows((data ?? []) as ApprovalRow[]);
}

export async function listAgentRunRows(supabase: SupabaseServerClient, workspaceId?: string) {
  let query = supabase
    .from("agent_runs")
    .select("id,status,task,confidence,error_message,workspaces(name),agent_definitions(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data } = await query;

  return buildAgentRunRows((data ?? []) as AgentRunRow[]);
}

export async function listAiLedgerRows(supabase: SupabaseServerClient, workspaceId?: string) {
  let query = supabase
    .from("ai_usage_ledger")
    .select("id,provider,model,task,output_type,result,estimated_cost_cents,workspaces(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data } = await query;

  return buildAiLedgerRows((data ?? []) as AiLedgerRow[]);
}

export async function listResearchSignals(supabase: SupabaseServerClient, _workspaceId: string) {
  const { data } = await supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select("page_name,library_id,headline,body,active_status,last_seen_at,postcodes")
    .order("last_seen_at", { ascending: false })
    .limit(30);

  return buildResearchSignals(((data ?? []) as ResearchSignalRow[]).map(toResearchSignalRow));
}

function toResearchSignalRow(row: ResearchSignalRow): ResearchSignalRow {
  const summary = row.headline ?? firstSentence(row.body) ?? "Creative captured";
  const postcodes = Array.isArray(row.postcodes) && row.postcodes.length > 0 ? `Postcodes ${row.postcodes.join(", ")}` : "Postcode match pending";

  return {
    competitor: row.page_name ?? "Unknown competitor",
    signal: summary,
    evidence: `${postcodes}${row.last_seen_at ? `, last seen ${new Date(row.last_seen_at).toLocaleDateString("en-AU")}` : ""}`,
    confidence: row.confidence ?? (row.active_status === "active" ? 80 : 50),
  };
}

function normalizeProvider(provider: CampaignRow["provider"]): ProviderKey {
  return provider === "google" ? "google" : "meta";
}

function formatProvider(provider: ProviderKey) {
  return provider === "meta" ? "Meta" : "Google";
}

function sourceLabel(provider: LeadRow["provider"]) {
  if (provider === "meta") return "Meta lead form";
  if (provider === "google") return "Google lead form";
  return "Manual import";
}

function normalizeApprovalStatus(value: string | null | undefined): ApprovalStatus {
  if (value === "approved" || value === "rejected" || value === "cancelled" || value === "requested") {
    return value;
  }

  return "draft";
}

function normalizeComplianceStatus(value: string | null | undefined): ComplianceStatus {
  if (value === "approved" || value === "blocked" || value === "needs_review") {
    return value;
  }

  return "needs_review";
}

function normalizeProviderConnectionStatus(value: string | null | undefined): ProviderConnectionStatus {
  if (value === "connected" || value === "needs_attention") {
    return value;
  }

  return "not_connected";
}

function extractAttributionLabel(source: Record<string, unknown> | null | undefined): string {
  return String(source?.campaignName ?? source?.campaign_name ?? source?.utm_campaign ?? "Direct");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstSentence(value: string | null | undefined): string | null {
  if (!value) return null;
  const sentence = value.split(/[.!?]\s/)[0] ?? value;
  return sentence.length > 96 ? `${sentence.slice(0, 95).trim()}...` : sentence;
}

function formatAgentStatus(status: string | null | undefined): string {
  if (status === "completed") return "Complete";
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";

  return "Needs review";
}

function formatConfidence(value: number | string | null | undefined): string {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    return "0%";
  }

  const percentage = numeric! <= 1 ? numeric! * 100 : numeric!;

  return `${Math.round(percentage)}%`;
}

function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}
