import { enqueueQueuedJob } from "./job-queue-enqueue.ts";
import { queueMetaLeadSync } from "./meta-leads-queue.ts";
import { recoverStuckMetaPublishPlans } from "./meta-publish-queue.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceSupabase = ReturnType<typeof createSupabaseServiceClient>;

type ScheduledMetaPlanRow = {
  id: string;
  workspace_id: string;
  reconciled_objects_json: { leadFormIds?: Record<string, string> } | null;
};

export async function queueScheduledMetaLeadSyncs(service: ServiceSupabase) {
  const { data, error } = await service
    .from("meta_publish_plans")
    .select("id,workspace_id,reconciled_objects_json")
    .in("status", ["approved", "publishing", "paused_live"])
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as ScheduledMetaPlanRow[]).filter(
    (row) => Object.keys(row.reconciled_objects_json?.leadFormIds ?? {}).length > 0,
  );
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.allSettled(rows.map((row) => queueMetaLeadSync({
    workspaceId: row.workspace_id,
    planId: row.id,
    since,
  })));
  return {
    scanned: data?.length ?? 0,
    queued: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

export async function queueScheduledProviderMaintenance(service: ServiceSupabase) {
  const [metaConnections, googleConnections] = await Promise.all([
    service
      .from("provider_connections")
      .select("id,workspace_id")
      .eq("provider", "meta")
      .in("status", ["connected", "needs_attention"])
      .limit(200),
    service
      .from("provider_connections")
      .select("workspace_id")
      .eq("provider", "google")
      .eq("status", "connected")
      .limit(200),
  ]);
  if (metaConnections.error) throw new Error(metaConnections.error.message);
  if (googleConnections.error) throw new Error(googleConnections.error.message);

  const bucket = Math.floor(Date.now() / (6 * 60 * 60_000));
  const jobs = [
    ...(metaConnections.data ?? []).map((row) => enqueueQueuedJob({
      kind: "check.meta.token-health",
      payload: { workspaceId: row.workspace_id, connectionId: row.id },
      maxAttempts: 3,
      dedupeKey: `meta-token-health:${row.workspace_id}:${row.id}:${bucket}`,
    })),
    ...(googleConnections.data ?? []).map((row) => enqueueQueuedJob({
      kind: "sync.provider.reports",
      payload: { workspaceId: row.workspace_id, provider: "google" },
      maxAttempts: 3,
      dedupeKey: `provider-report-sync:${row.workspace_id}:google:${bucket}`,
    })),
  ];
  const results = await Promise.allSettled(jobs);
  return {
    queued: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

export async function runScheduledMetaPublishWatchdog() {
  return recoverStuckMetaPublishPlans({ stuckMinutes: 5, maxAttempts: 3 });
}
