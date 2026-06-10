import { buildApprovalRows } from "../publishing/approvals.ts";
import { leadSourceLabel, type LeadRow } from "../leads/rows.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type ApprovalRow = {
  id?: string;
  target_id?: string | null;
  target_type?: string | null;
  status?: string | null;
  risk_summary?: string | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type ProviderConnectionRow = {
  id?: string;
  workspace_id?: string | null;
  provider?: string | null;
  status?: string | null;
  last_sync_at?: string | null;
  updated_at?: string | null;
  external_account_name?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

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
      detail: `${lead.full_name ?? lead.name ?? lead.email ?? "Unknown lead"} via ${leadSourceLabel(lead.provider)}`,
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

function formatProviderLabel(provider: ProviderConnectionRow["provider"]) {
  if (provider === "meta") return "Meta";
  if (provider === "google") return "Google";
  return provider ? String(provider) : "Provider";
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
