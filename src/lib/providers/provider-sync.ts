import type { MonitorDateRange, MonitorProvider, MonitorProviderReport } from "../monitor/dashboard-data.ts";
import { listProviderConnections, loadStoredProviderTokens } from "./provider-connections.ts";
import { fetchGoogleAdsReporting, refreshGoogleAccessToken } from "./google-reporting.ts";
import { fetchMetaReporting } from "./meta-reporting.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type SyncStatus = "queued" | "running" | "completed" | "failed";

export function buildSyncRunInsert(
  workspaceId: string,
  provider: MonitorProvider,
  jobKey: string,
  startedAt = new Date().toISOString(),
) {
  return {
    workspace_id: workspaceId,
    provider,
    job_key: jobKey,
    status: "running",
    started_at: startedAt,
  };
}

export function buildSyncRunUpdate(
  status: Exclude<SyncStatus, "queued" | "running">,
  completedAt = new Date().toISOString(),
  errorMessage: string | null = null,
) {
  return {
    status,
    completed_at: completedAt,
    error_message: errorMessage,
  };
}

export function buildReportingSnapshotInsert(
  workspaceId: string,
  report: MonitorProviderReport,
  range: Pick<MonitorDateRange, "since" | "until">,
) {
  return {
    workspace_id: workspaceId,
    provider: report.provider,
    date_range: `[${range.since},${range.until}]`,
    metrics: {
      source: report.source,
      status: report.status,
      accountName: report.accountName,
      accountId: report.accountId,
      lastSyncAt: report.lastSyncAt,
      issue: report.issue,
      spendAud: report.metrics.spendAud,
      impressions: report.metrics.impressions,
      clicks: report.metrics.clicks,
      leads: report.metrics.leads,
      validLeads: report.metrics.validLeads,
      validLeadRate: report.metrics.validLeadRate,
      cplAud: report.metrics.cplAud,
      validCplAud: report.metrics.validCplAud,
      rows: report.rows,
      daily: report.daily,
      creativePreviews: report.creativePreviews,
    },
  };
}

export async function syncProviderWorkspace(input: {
  supabase: SupabaseServerClient;
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  provider: MonitorProvider;
  range: MonitorDateRange;
  jobKey?: string;
}) {
  const now = new Date().toISOString();
  const { data: syncRun, error: syncInsertError } = await input.serviceSupabase
    .from("sync_runs")
    .insert(buildSyncRunInsert(input.workspaceId, input.provider, input.jobKey ?? "sync-provider-workspace", now))
    .select("id")
    .single();

  if (syncInsertError) {
    throw new Error(syncInsertError.message);
  }

  try {
    const connections = await listProviderConnections(input.supabase, input.workspaceId);
    const connection = connections.find((item) => item.provider === input.provider);

    if (!connection) {
      throw new Error(`${input.provider} provider connection was not found.`);
    }

    const tokens = await loadStoredProviderTokens(input.serviceSupabase, connection.id);
    let report: MonitorProviderReport;

    if (input.provider === "meta") {
      if (!tokens.accessToken || !connection.externalAccountId) {
        throw new Error("Meta provider connection is missing an access token or account id.");
      }

      report = await fetchMetaReporting({
        accessToken: tokens.accessToken,
        accountId: connection.externalAccountId,
        accountName: connection.externalAccountName ?? undefined,
        range: input.range,
      });
    } else {
      if ((!tokens.accessToken && !tokens.refreshToken) || !connection.externalAccountId) {
        throw new Error("Google provider connection is missing token material or customer id.");
      }

      const accessToken = tokens.refreshToken ? await refreshGoogleAccessToken(tokens.refreshToken) : tokens.accessToken;

      if (!accessToken) {
        throw new Error("Google provider connection is missing an access token.");
      }

      report = await fetchGoogleAdsReporting({
        accessToken,
        customerId: connection.externalAccountId,
        accountName: connection.externalAccountName ?? undefined,
        range: input.range,
      });
    }

    const { error: snapshotError } = await input.serviceSupabase
      .from("reporting_snapshots")
      .insert(buildReportingSnapshotInsert(input.workspaceId, report, input.range));

    if (snapshotError) {
      throw new Error(snapshotError.message);
    }

    await input.serviceSupabase
      .from("provider_connections")
      .update({ status: "connected", last_sync_at: report.lastSyncAt ?? new Date().toISOString() })
      .eq("id", connection.id);

    await input.serviceSupabase
      .from("sync_runs")
      .update(buildSyncRunUpdate("completed"))
      .eq("id", syncRun.id);

    return { status: "completed" as const, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider sync failed.";

    await input.serviceSupabase
      .from("sync_runs")
      .update(buildSyncRunUpdate("failed", new Date().toISOString(), message))
      .eq("id", syncRun.id);
    await input.serviceSupabase
      .from("provider_connections")
      .update({ status: "needs_attention" })
      .eq("workspace_id", input.workspaceId)
      .eq("provider", input.provider);

    return { status: "failed" as const, error: message };
  }
}

export async function listProviderSyncSummariesForWorkspace(supabase: SupabaseServerClient, workspaceId: string) {
  const { data } = await supabase
    .from("provider_connections")
    .select("provider,status,last_sync_at")
    .eq("workspace_id", workspaceId)
    .order("provider", { ascending: true });

  return ((data ?? []) as Array<{ provider: MonitorProvider; status: string; last_sync_at: string | null }>).map((row) => ({
    workspaceId,
    provider: row.provider,
    status: row.status === "connected" || row.status === "needs_attention" ? row.status : "not_connected",
    lastSyncAt: row.last_sync_at,
  }));
}

export async function listReportingSnapshotsForWorkspace(supabase: SupabaseServerClient, workspaceId: string) {
  const { data } = await supabase
    .from("reporting_snapshots")
    .select("workspace_id,provider,date_range,metrics,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as Array<{
    workspace_id: string;
    provider: MonitorProvider;
    date_range: string;
    metrics: Record<string, unknown>;
  }>).map((row) => ({
    workspaceId: row.workspace_id,
    provider: row.provider,
    dateRange: row.date_range,
    metrics: row.metrics,
  }));
}
