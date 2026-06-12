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
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ComplianceReportRow = {
  campaign_id?: string | null;
  status?: string | null;
};

type ProviderConnectionRow = {
  id?: string;
  workspace_id?: string | null;
  provider?: ProviderKey | string | null;
  status?: string | null;
  last_sync_at?: string | null;
  updated_at?: string | null;
  external_account_name?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type LeadRow = {
  id: string;
  workspace_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  suburb?: string | null;
  provider?: ProviderKey | string | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type LeadLabelRow = {
  lead_id?: string | null;
  label?: string | null;
  created_at?: string | null;
};

type LeadAttributionRow = {
  lead_id?: string | null;
  source?: Record<string, unknown> | null;
};

type LeadDedupeRow = {
  lead_id?: string | null;
  duplicate_of_lead_id?: string | null;
};

type LeadDeliveryAttemptRow = {
  lead_id?: string | null;
  status?: string | null;
  destination_label?: string | null;
  created_at?: string | null;
};

export const LEAD_QUALITY_LABELS = ["valid", "invalid", "high_intent"] as const;

export type LeadQualityLabel = (typeof LEAD_QUALITY_LABELS)[number];

type AgentRunRow = {
  id: string;
  status?: string | null;
  task?: string | null;
  confidence?: number | string | null;
  error_message?: string | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
  agent_definitions?: { name?: string | null } | Array<{ name?: string | null }> | null;
  ai_runs?: { estimated_cost_cents?: number | null } | Array<{ estimated_cost_cents?: number | null }> | null;
};

type WorkspaceOverviewRow = {
  id: string;
  name: string;
  mode?: string | null;
  region?: string | null;
  managed_service_enabled?: boolean | null;
  updated_at?: string | null;
  created_at?: string | null;
  workspace_plans?: { name?: string | null; key?: string | null } | Array<{ name?: string | null; key?: string | null }> | null;
};

type AiLedgerRow = {
  id: string;
  user_id?: string | null;
  provider?: string | null;
  model?: string | null;
  task?: string | null;
  output_type?: string | null;
  result?: string | null;
  estimated_cost_cents?: number | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
  profiles?: { email?: string | null; full_name?: string | null } | Array<{ email?: string | null; full_name?: string | null }> | null;
};

export type AiLedgerFilters = {
  userId?: string;
  model?: string;
  task?: string;
  day?: string;
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
  deliveryAttempts?: LeadDeliveryAttemptRow[];
  incoming?: { email?: string; phone?: string };
}) {
  const labelByLead = new Map<string, { label: LeadQualityLabel; createdAt: number }>();

  for (const label of input.labels ?? []) {
    if (!label.lead_id) continue;

    const normalized = normalizeLeadQualityLabel(label.label);

    if (normalized) {
      const createdAt = labelTime(label);
      const current = labelByLead.get(label.lead_id);

      if (!current || createdAt >= current.createdAt) {
        labelByLead.set(label.lead_id, { label: normalized, createdAt });
      }
    }
  }

  const attributionByLead = new Map((input.attributions ?? []).map((attribution) => [attribution.lead_id, attribution.source]));
  const latestDeliveryByLead = new Map<string, LeadDeliveryAttemptRow>();

  for (const attempt of input.deliveryAttempts ?? []) {
    if (!attempt.lead_id) continue;

    const current = latestDeliveryByLead.get(attempt.lead_id);

    if (current && deliveryAttemptTime(current) >= deliveryAttemptTime(attempt)) continue;

    latestDeliveryByLead.set(attempt.lead_id, attempt);
  }

  const duplicateLeadIds = new Set(
    (input.dedupeRecords ?? [])
      .filter((record) => record.duplicate_of_lead_id)
      .map((record) => record.lead_id)
      .filter((leadId): leadId is string => Boolean(leadId)),
  );
  const rows = input.leads.map((lead) => {
    const source = sourceLabel(lead.provider);
    const attribution = attributionByLead.get(lead.id);
    const delivery = latestDeliveryByLead.get(lead.id);

    return {
      id: lead.id,
      name: lead.full_name ?? lead.name ?? "Unknown lead",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      suburb: lead.suburb ?? "Unknown",
      source,
      quality: labelByLead.get(lead.id)?.label ?? "unlabelled",
      createdAt: lead.created_at ?? new Date(0).toISOString(),
      dedupeKey: buildLeadDedupeKey({ email: lead.email ?? "", phone: lead.phone ?? "" }),
      duplicateCandidate: duplicateLeadIds.has(lead.id),
      delivery: formatLeadDelivery(delivery),
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
    cost: cents(one(row.ai_runs)?.estimated_cost_cents ?? 0),
    confidence: formatConfidence(row.confidence),
    ...(row.error_message ? { error: row.error_message } : {}),
  }));
}

export function buildAiLedgerRows(rows: AiLedgerRow[]) {
  return rows.map((row) => ({
    id: row.id,
    workspace: one(row.workspaces)?.name ?? "Workspace",
    userId: row.user_id ?? null,
    user: profileDisplayName(row.profiles, row.user_id),
    userEmail: one(row.profiles)?.email ?? null,
    profile: row.provider ?? "unknown",
    task: row.task ?? "unknown_task",
    provider: row.provider ?? "unknown",
    model: row.model ?? "unknown",
    usage: row.output_type ?? "unknown",
    estimatedCost: cents(row.estimated_cost_cents ?? 0),
    result: row.result ?? "completed",
    createdAt: row.created_at ?? null,
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

export function buildOperatorOverview(input: {
  workspaceCount: number;
  leadCount: number;
  pendingApprovalCount: number;
  providerIssueCount: number;
  workspaces: WorkspaceOverviewRow[];
  providerConnections: ProviderConnectionRow[];
  approvals: ApprovalRow[];
  recentLeads: LeadRow[];
  agentRuns: AgentRunRow[];
}) {
  const providersByWorkspace = new Map<string, ProviderConnectionRow[]>();

  for (const connection of input.providerConnections) {
    if (!connection.workspace_id) continue;
    const connections = providersByWorkspace.get(connection.workspace_id) ?? [];
    connections.push(connection);
    providersByWorkspace.set(connection.workspace_id, connections);
  }

  const workspaceRows = input.workspaces.map((workspace) => {
    const providers = providersByWorkspace.get(workspace.id) ?? [];
    const issueCount = providers.filter((provider) => provider.status === "needs_attention" || provider.status === "not_connected").length;
    const lastSyncAt = latestDate(providers.map((provider) => provider.last_sync_at ?? provider.updated_at));
    const plan = one(workspace.workspace_plans);

    return {
      id: workspace.id,
      name: workspace.name,
      mode: workspace.mode === "self_serve" ? "Self serve" : "Monitor",
      plan: plan?.name ?? plan?.key ?? "Unassigned",
      region: workspace.region ?? "AU",
      managedService: workspace.managed_service_enabled ? "Managed" : "Customer-led",
      providerHealth: providers.length === 0 ? "No providers" : issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : "Healthy",
      providerTone: providers.length === 0 || issueCount > 0 ? "amber" : "green",
      lastSync: lastSyncAt ? formatRelativeDate(lastSyncAt) : "No sync yet",
    };
  });

  const providerHealthRows = input.providerConnections
    .filter((connection) => connection.status === "needs_attention" || connection.status === "not_connected")
    .map((connection) => ({
      id: connection.id ?? `${connection.workspace_id ?? "workspace"}-${connection.provider ?? "provider"}`,
      workspace: one(connection.workspaces)?.name ?? "Workspace",
      provider: formatProviderLabel(connection.provider),
      status: connection.status === "needs_attention" ? "Needs attention" : "Not connected",
      tone: connection.status === "needs_attention" ? "rose" : "amber",
      lastSync: connection.last_sync_at ? formatRelativeDate(connection.last_sync_at) : "No sync yet",
      account: connection.external_account_name ?? "Account pending",
    }));

  const recentActivity = [
    ...input.approvals.map((approval) => ({
      id: approval.id ?? `${approval.target_type ?? "approval"}-${approval.target_id ?? "unknown"}`,
      at: approval.created_at ?? "",
      title: `${approval.target_type ?? "Action"} approval ${approval.status ?? "requested"}`,
      workspace: one(approval.workspaces)?.name ?? "Workspace",
      detail: approval.risk_summary ?? "Review required",
      tone: approval.status === "approved" ? "green" : approval.status === "rejected" ? "rose" : "amber",
    })),
    ...input.recentLeads.map((lead) => ({
      id: lead.id,
      at: lead.created_at ?? "",
      title: "Lead received",
      workspace: one(lead.workspaces)?.name ?? "Workspace",
      detail: `${lead.full_name ?? lead.name ?? lead.email ?? "Unknown lead"} via ${sourceLabel(lead.provider)}`,
      tone: "blue",
    })),
    ...input.agentRuns.map((run) => ({
      id: run.id,
      at: run.created_at ?? "",
      title: `${one(run.agent_definitions)?.name ?? "Agent"} ${formatAgentStatus(run.status)}`,
      workspace: one(run.workspaces)?.name ?? "Workspace",
      detail: run.error_message ?? run.task ?? "Queued task",
      tone: run.status === "failed" ? "rose" : run.status === "completed" ? "green" : "blue",
    })),
  ]
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
    .slice(0, 8);

  return {
    metrics: {
      workspaces: String(input.workspaceCount),
      leads: String(input.leadCount),
      pendingApprovals: String(input.pendingApprovalCount),
      providerIssues: String(input.providerIssueCount),
    },
    workspaceRows,
    providerHealthRows,
    approvalRows: buildApprovalRows(input.approvals).slice(0, 5),
    recentActivity,
  };
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

  const [{ data: labels }, { data: attributions }, { data: dedupeRecords }, { data: deliveryAttempts }] = await Promise.all([
    supabase
      .from("lead_quality_labels")
      .select("lead_id,label,created_at")
      .eq("workspace_id", workspaceId)
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false }),
    supabase.from("lead_source_attribution").select("lead_id,source").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase.from("lead_dedupe_records").select("lead_id,duplicate_of_lead_id").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase
      .from("lead_delivery_attempts")
      .select("lead_id,status,destination_label,created_at")
      .eq("workspace_id", workspaceId)
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false }),
  ]);

  return buildLeadRowsWithDedupe({
    leads: (leads ?? []) as LeadRow[],
    labels: (labels ?? []) as LeadLabelRow[],
    attributions: (attributions ?? []) as LeadAttributionRow[],
    dedupeRecords: (dedupeRecords ?? []) as LeadDedupeRow[],
    deliveryAttempts: (deliveryAttempts ?? []) as LeadDeliveryAttemptRow[],
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
    .select("id,status,task,confidence,error_message,workspaces(name),agent_definitions(name),ai_runs(estimated_cost_cents)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data } = await query;

  return buildAgentRunRows((data ?? []) as AgentRunRow[]);
}

export async function listAiLedgerRows(supabase: SupabaseServerClient, workspaceId?: string, filters: AiLedgerFilters = {}) {
  let query = supabase
    .from("ai_usage_ledger")
    .select("id,user_id,provider,model,task,output_type,result,estimated_cost_cents,created_at,workspaces(name),profiles(email,full_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  }

  if (filters.model) {
    query = query.ilike("model", `%${filters.model}%`);
  }

  if (filters.task) {
    query = query.eq("task", filters.task);
  }

  const dayRange = dayToUtcRange(filters.day);
  if (dayRange) {
    query = query.gte("created_at", dayRange.startIso).lt("created_at", dayRange.endIso);
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

export async function loadOperatorOverview(supabase: SupabaseServerClient) {
  const [
    { count: workspaceCount },
    { count: leadCount },
    { count: pendingApprovalCount },
    { count: providerIssueCount },
    { data: workspaces },
    { data: providerConnections },
    { data: approvals },
    { data: recentLeads },
    { data: agentRuns },
  ] = await Promise.all([
    supabase.from("workspaces").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "requested"),
    supabase.from("provider_connections").select("id", { count: "exact", head: true }).in("status", ["needs_attention", "not_connected"]),
    supabase
      .from("workspaces")
      .select("id,name,mode,region,managed_service_enabled,updated_at,created_at,workspace_plans(name,key)")
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("provider_connections")
      .select("id,workspace_id,provider,status,last_sync_at,updated_at,external_account_name,workspaces(name)")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("approval_requests")
      .select("id,target_type,target_id,status,risk_summary,created_at,workspaces(name)")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("leads")
      .select("id,workspace_id,full_name,name,email,provider,created_at,workspaces(name)")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("agent_runs")
      .select("id,status,task,confidence,error_message,created_at,workspaces(name),agent_definitions(name)")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return buildOperatorOverview({
    workspaceCount: workspaceCount ?? 0,
    leadCount: leadCount ?? 0,
    pendingApprovalCount: pendingApprovalCount ?? 0,
    providerIssueCount: providerIssueCount ?? 0,
    workspaces: (workspaces ?? []) as WorkspaceOverviewRow[],
    providerConnections: (providerConnections ?? []) as ProviderConnectionRow[],
    approvals: (approvals ?? []) as ApprovalRow[],
    recentLeads: (recentLeads ?? []) as LeadRow[],
    agentRuns: (agentRuns ?? []) as AgentRunRow[],
  });
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

function formatProviderLabel(provider: ProviderConnectionRow["provider"]) {
  if (provider === "meta" || provider === "google") {
    return formatProvider(provider);
  }

  return provider ? String(provider) : "Provider";
}

function sourceLabel(provider: LeadRow["provider"]) {
  if (provider === "meta") return "Meta lead form";
  if (provider === "google") return "Google lead form";
  return "Manual import";
}

export function normalizeLeadQualityLabel(value: string | null | undefined): LeadQualityLabel | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "high_intent" || normalized === "valid" || normalized === "invalid") {
    return normalized;
  }

  if (normalized === "unqualified") {
    return "invalid";
  }

  return null;
}

function formatLeadDelivery(attempt: LeadDeliveryAttemptRow | undefined): string {
  if (!attempt) {
    return "Not sent";
  }

  const destination = attempt.destination_label?.trim();

  switch (attempt.status) {
    case "delivered":
      return destination ? `Delivered to ${destination}` : "Delivered";
    case "failed":
      return destination ? `Failed to ${destination}` : "Failed";
    case "manual_review":
      return destination ? `Review needed for ${destination}` : "Review needed";
    case "queued":
      return destination ? `Queued for ${destination}` : "Queued";
    default:
      return destination ? `Pending for ${destination}` : "Pending";
  }
}

function deliveryAttemptTime(attempt: LeadDeliveryAttemptRow): number {
  const time = new Date(attempt.created_at ?? 0).getTime();

  return Number.isFinite(time) ? time : 0;
}

function labelTime(label: LeadLabelRow): number {
  const time = new Date(label.created_at ?? 0).getTime();

  return Number.isFinite(time) ? time : 0;
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

function latestDate(values: Array<string | null | undefined>): string | null {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  return latest ? new Date(latest).toISOString() : null;
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function profileDisplayName(
  value: { email?: string | null; full_name?: string | null } | Array<{ email?: string | null; full_name?: string | null }> | null | undefined,
  userId: string | null | undefined,
): string {
  const profile = one(value);
  const fullName = profile?.full_name?.trim();

  if (fullName) return fullName;
  if (profile?.email) return profile.email;

  return userId ? "Unknown user" : "System";
}

function dayToUtcRange(day: string | undefined): { startIso: string; endIso: string } | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }

  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}
