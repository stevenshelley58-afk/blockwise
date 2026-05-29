import { schedules, task } from "@trigger.dev/sdk/v3";

import { executeLeadDeliveryAttemptById } from "../src/lib/providers/lead-delivery-worker.ts";
import { checkMetaConnectionHealth } from "../src/lib/providers/meta-assets.ts";
import { syncMetaLeadsForPlanById } from "../src/lib/providers/meta-leads-worker.ts";
import { executeMetaMutationById } from "../src/lib/providers/meta-mutation-worker.ts";
import { executeMetaPublishPlanById } from "../src/lib/providers/meta-publish-worker.ts";
import { loadStoredProviderTokens } from "../src/lib/providers/provider-connections.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type MetaPublishPayload = {
  workspaceId: string;
  planId: string;
};

type MetaMutationPayload = {
  workspaceId: string;
  mutationId: string;
};

type MetaLeadSyncPayload = {
  workspaceId: string;
  planId: string;
  since?: string | null;
};

type LeadDeliveryPayload = {
  workspaceId: string;
  attemptId: string;
};

type ScheduledMetaPlanRow = {
  id: string;
  workspace_id: string;
  status: string;
  reconciled_objects_json: {
    leadFormIds?: Record<string, string>;
  } | null;
};

type ScheduledMetaConnectionRow = {
  id: string;
  workspace_id: string;
  status: string;
  token_expires_at: string | null;
};

export const executeMetaPublishPlanTask = task({
  id: "publish.meta.execute",
  run: async (payload: MetaPublishPayload) =>
    executeMetaPublishPlanById({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: payload.workspaceId,
      planId: payload.planId,
    }),
});

export const executeMetaMutationTask = task({
  id: "publish.meta.mutate",
  run: async (payload: MetaMutationPayload) =>
    executeMetaMutationById({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: payload.workspaceId,
      mutationId: payload.mutationId,
    }),
});

export const syncMetaLeadsTask = task({
  id: "sync.meta.leads",
  run: async (payload: MetaLeadSyncPayload) =>
    syncMetaLeadsForPlanById({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: payload.workspaceId,
      planId: payload.planId,
      since: payload.since,
    }),
});

export const deliverLeadTask = task({
  id: "deliver.lead",
  run: async (payload: LeadDeliveryPayload) =>
    executeLeadDeliveryAttemptById({
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: payload.workspaceId,
      attemptId: payload.attemptId,
    }),
});

export const scheduledMetaLeadSyncTask = schedules.task({
  id: "sync.meta.leads.scheduled",
  cron: {
    pattern: "*/15 * * * *",
    timezone: "Australia/Perth",
  },
  run: async () => runScheduledMetaLeadSyncs(createSupabaseServiceClient()),
});

export const scheduledMetaTokenHealthTask = schedules.task({
  id: "check.meta.token-health.scheduled",
  cron: {
    pattern: "0 */6 * * *",
    timezone: "Australia/Perth",
  },
  run: async () => runScheduledMetaTokenHealthChecks(createSupabaseServiceClient()),
});

export async function runScheduledMetaLeadSyncs(serviceSupabase: SupabaseServiceClient) {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .select("id,workspace_id,status,reconciled_objects_json")
    .in("status", ["approved", "publishing", "paused_live"])
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as ScheduledMetaPlanRow[]).filter(
    (row) => Object.keys(row.reconciled_objects_json?.leadFormIds ?? {}).length > 0,
  );
  const results: Array<{ planId: string; status: "synced" | "failed"; error?: string }> = [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const row of rows) {
    try {
      await syncMetaLeadsForPlanById({
        serviceSupabase,
        workspaceId: row.workspace_id,
        planId: row.id,
        since,
      });
      results.push({ planId: row.id, status: "synced" });
    } catch (error) {
      results.push({ planId: row.id, status: "failed", error: error instanceof Error ? error.message : "Lead sync failed." });
    }
  }

  return {
    scanned: data?.length ?? 0,
    attempted: rows.length,
    synced: results.filter((result) => result.status === "synced").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export async function runScheduledMetaTokenHealthChecks(serviceSupabase: SupabaseServiceClient) {
  const { data, error } = await serviceSupabase
    .from("provider_connections")
    .select("id,workspace_id,status,token_expires_at")
    .eq("provider", "meta")
    .in("status", ["connected", "needs_attention"])
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ScheduledMetaConnectionRow[];
  const results: Array<{ connectionId: string; status: string; error?: string }> = [];

  for (const row of rows) {
    try {
      const tokens = await loadStoredProviderTokens(serviceSupabase, row.id);
      const health = await checkMetaConnectionHealth({
        accessToken: tokens.accessToken ?? "",
        tokenExpiresAt: row.token_expires_at,
      });
      const connectionStatus = health.status === "needs_reconnect" || health.status === "missing_token" ? "needs_attention" : "connected";
      const { error: updateError } = await serviceSupabase
        .from("provider_connections")
        .update({
          status: connectionStatus,
          health_status: health.status,
          health_checked_at: health.checkedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("workspace_id", row.workspace_id)
        .eq("provider", "meta");

      if (updateError) {
        throw new Error(updateError.message);
      }

      results.push({ connectionId: row.id, status: health.status });
    } catch (error) {
      results.push({ connectionId: row.id, status: "failed", error: error instanceof Error ? error.message : "Token health check failed." });
    }
  }

  return {
    scanned: rows.length,
    healthy: results.filter((result) => result.status === "healthy").length,
    needsAttention: results.filter((result) => result.status === "needs_reconnect" || result.status === "missing_token").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
