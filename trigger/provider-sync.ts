import { schedules, task } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import { resolveMonitorDateRange } from "../src/lib/monitor/dashboard-data.ts";
import { syncProviderWorkspace } from "../src/lib/providers/provider-sync.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type ProviderSyncPayload = {
  workspaceId: string;
  provider: "meta" | "google";
};

export const syncProviderReports = schedules.task({
  id: "sync-provider-reports",
  cron: "0 */6 * * *",
  run: async () => {
    const serviceSupabase = createSupabaseServiceClient();
    const { data: connections, error } = await serviceSupabase
      .from("provider_connections")
      .select("workspace_id,provider")
      .in("provider", ["meta", "google"])
      .eq("status", "connected");

    if (error) {
      throw new Error(error.message);
    }

    const results = await Promise.all(
      ((connections ?? []) as ProviderSyncPayload[]).map(async (connection) => {
        try {
          return await syncProviderWorkspace({
            supabase: serviceSupabase as never,
            serviceSupabase,
            workspaceId: connection.workspaceId,
            provider: connection.provider,
            range: resolveMonitorDateRange("last_30"),
            jobKey: "sync-provider-reports",
          });
        } catch (error) {
          Sentry.captureException(error);
          return { status: "failed" as const, error: error instanceof Error ? error.message : "Sync failed" };
        }
      }),
    );

    return {
      synced: results.filter((result) => result.status === "completed").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
  },
});

export const syncProviderWorkspaceTask = task({
  id: "sync-provider-workspace",
  run: async (payload: ProviderSyncPayload) => {
    const serviceSupabase = createSupabaseServiceClient();

    return syncProviderWorkspace({
      supabase: serviceSupabase as never,
      serviceSupabase,
      workspaceId: payload.workspaceId,
      provider: payload.provider,
      range: resolveMonitorDateRange("last_30"),
      jobKey: "sync-provider-workspace",
    });
  },
});
