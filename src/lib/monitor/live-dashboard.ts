import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  buildDemoMonitorDashboardBundle,
  mergeProviderReportsWithDemo,
  normalizeProviderReport,
  scopeDemoBundleToProviders,
  type MonitorDashboardBundle,
  type MonitorProvider,
  type MonitorProviderReport,
  type MonitorRange,
} from "@/lib/monitor/dashboard-data";
import {
  listProviderConnections,
  loadStoredProviderTokens,
  type ProviderConnectionMetadata,
} from "@/lib/providers/provider-connections";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { fetchGoogleAdsReporting, refreshGoogleAccessToken } from "@/lib/providers/google-reporting";
import { fetchMetaReporting } from "@/lib/providers/meta-reporting";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function buildMonitorDashboardForWorkspace(input: {
  supabase: SupabaseServerClient;
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  range: MonitorRange;
  now?: Date;
}): Promise<MonitorDashboardBundle> {
  const demo = buildDemoMonitorDashboardBundle({
    workspaceId: input.workspaceId,
    range: input.range,
    now: input.now,
  });
  const connections = await listProviderConnections(input.supabase, input.workspaceId);

  if (connections.length === 0) {
    return demo;
  }

  // Only providers the workspace has actually connected (and that are enabled) may surface
  // any data — including demo/sample fixtures. This prevents a Meta-only workspace from
  // seeing fake Google cards, leads, or charts.
  const activeConnections = connections.filter(
    (connection) => connection.provider === "meta" || (GOOGLE_ADS_ENABLED && connection.provider === "google"),
  );

  if (activeConnections.length === 0) {
    return demo;
  }

  const connectedProviders: Set<MonitorProvider> = new Set(activeConnections.map((connection) => connection.provider));
  const scopedDemo = scopeDemoBundleToProviders(demo, connectedProviders);

  const reports = await Promise.all(
    activeConnections.map((connection) => buildProviderReport(input.serviceSupabase, connection, demo)),
  );

  return mergeProviderReportsWithDemo(
    scopedDemo,
    reports.filter((report): report is MonitorProviderReport => Boolean(report)),
  );
}

async function buildProviderReport(
  serviceSupabase: SupabaseServiceClient,
  connection: ProviderConnectionMetadata,
  demo: MonitorDashboardBundle,
): Promise<MonitorProviderReport | null> {
  const demoProvider = demo.providers.find((provider) => provider.provider === connection.provider);

  if (!demoProvider) {
    return null;
  }

  if (connection.status === "not_connected") {
    return demoProvider;
  }

  const tokens = await loadStoredProviderTokens(serviceSupabase, connection.id).catch(() => ({
    accessToken: null,
    refreshToken: null,
  }));

  if (!tokens.accessToken && !tokens.refreshToken) {
    return withConnectionMetadata(demoProvider, connection, "Connected account metadata exists, but the secure token vault is empty. Reconnect this provider.");
  }

  try {
    if (connection.provider === "meta" && tokens.accessToken && connection.externalAccountId) {
      return await fetchMetaReporting({
        accessToken: tokens.accessToken,
        accountId: connection.externalAccountId,
        accountName: connection.externalAccountName ?? undefined,
        range: demo.range,
      });
    }

    if (connection.provider === "google" && connection.externalAccountId) {
      const accessToken = tokens.refreshToken ? await refreshGoogleAccessToken(tokens.refreshToken) : tokens.accessToken;

      if (!accessToken) {
        throw new Error("Google access token is missing.");
      }

      return await fetchGoogleAdsReporting({
        accessToken,
        customerId: connection.externalAccountId,
        accountName: connection.externalAccountName ?? undefined,
        range: demo.range,
      });
    }

    return withConnectionMetadata(demoProvider, connection, "Provider account metadata is incomplete. Reconnect this provider.");
  } catch (error) {
    return withConnectionMetadata(
      demoProvider,
      connection,
      error instanceof Error ? error.message : "Live provider reporting failed. Sample data is shown for this provider.",
    );
  }
}

function withConnectionMetadata(
  demoProvider: MonitorProviderReport,
  connection: ProviderConnectionMetadata,
  issue: string,
): MonitorProviderReport {
  const providerLabel = formatProvider(connection.provider);

  return normalizeProviderReport(
    {
      ...demoProvider,
      status: "degraded",
      source: "demo",
      accountId: connection.externalAccountId ?? undefined,
      accountName: connection.externalAccountName ?? `${providerLabel} Ads`,
      lastSyncAt: connection.lastSyncAt,
      issue,
    },
    {
      key: "last_30",
      label: "Current",
      since: demoProvider.daily[0]?.date ?? new Date().toISOString().slice(0, 10),
      until: demoProvider.daily.at(-1)?.date ?? new Date().toISOString().slice(0, 10),
      days: Math.max(1, demoProvider.daily.length),
    },
  );
}

function formatProvider(provider: MonitorProvider): string {
  return provider === "meta" ? "Meta" : "Google";
}
