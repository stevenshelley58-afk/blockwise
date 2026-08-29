import { enqueueQueuedJob } from "./job-queue-enqueue.ts";
import { queueMetaLeadSync } from "./meta-leads-queue.ts";
import { recoverStuckMetaPublishPlans } from "./meta-publish-queue.ts";
import { sendAlertEmail } from "../alerts/notify.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceSupabase = ReturnType<typeof createSupabaseServiceClient>;

type ScheduledMetaPlanRow = {
  id: string;
  workspace_id: string;
  reconciled_objects_json: { leadFormIds?: Record<string, string> } | null;
};

type ScheduledConnectionRow = {
  id: string;
  workspace_id: string;
};

type ScheduledPage<Row> = {
  data: Row[] | null;
  error: { message: string } | null;
};

const SCHEDULED_SCAN_PAGE_SIZE = 200;

export async function scanScheduledRowsById<Row extends { id: string }>(input: {
  fetchPage(afterId: string | null, limit: number): Promise<ScheduledPage<Row>>;
  handlePage(rows: Row[]): Promise<void>;
  pageSize?: number;
}): Promise<number> {
  const pageSize = input.pageSize ?? SCHEDULED_SCAN_PAGE_SIZE;
  let afterId: string | null = null;
  let scanned = 0;

  for (;;) {
    const page = await input.fetchPage(afterId, pageSize);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    if (rows.length === 0) return scanned;

    await input.handlePage(rows);
    scanned += rows.length;
    if (rows.length < pageSize) return scanned;

    const nextAfterId = rows.at(-1)?.id ?? null;
    if (!nextAfterId || nextAfterId === afterId) {
      throw new Error("Scheduled maintenance cursor did not advance.");
    }
    afterId = nextAfterId;
  }
}

export async function queueScheduledMetaLeadSyncs(service: ServiceSupabase) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let queued = 0;
  let failed = 0;
  const scanned = await scanScheduledRowsById<ScheduledMetaPlanRow>({
    fetchPage: async (afterId, limit) => {
      let query = service
        .from("meta_publish_plans")
        .select("id,workspace_id,reconciled_objects_json")
        .in("status", ["approved", "publishing", "paused_live"])
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) query = query.gt("id", afterId);
      return await query as unknown as ScheduledPage<ScheduledMetaPlanRow>;
    },
    handlePage: async (page) => {
      const rows = page.filter(
        (row) => Object.keys(row.reconciled_objects_json?.leadFormIds ?? {}).length > 0,
      );
      const results = await Promise.allSettled(rows.map((row) => queueMetaLeadSync({
        workspaceId: row.workspace_id,
        planId: row.id,
        since,
      })));
      queued += results.filter((result) => result.status === "fulfilled").length;
      failed += results.filter((result) => result.status === "rejected").length;
    },
  });
  return { scanned, queued, failed };
}

export async function queueScheduledProviderMaintenance(service: ServiceSupabase) {
  const bucket = Math.floor(Date.now() / (6 * 60 * 60_000));
  let queued = 0;
  let failed = 0;
  let scanned = 0;

  const recordResults = (results: PromiseSettledResult<unknown>[]) => {
    queued += results.filter((result) => result.status === "fulfilled").length;
    failed += results.filter((result) => result.status === "rejected").length;
  };

  const [metaScanned, googleScanned] = await Promise.all([
    scanScheduledRowsById<ScheduledConnectionRow>({
      fetchPage: async (afterId, limit) => {
        let query = service
          .from("provider_connections")
          .select("id,workspace_id")
          .eq("provider", "meta")
          .in("status", ["connected", "needs_attention"])
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return await query as unknown as ScheduledPage<ScheduledConnectionRow>;
      },
      handlePage: async (rows) => recordResults(await Promise.allSettled(rows.map((row) => enqueueQueuedJob({
        workspaceId: row.workspace_id,
        kind: "check.meta.token-health",
        payload: { workspaceId: row.workspace_id, connectionId: row.id },
        maxAttempts: 3,
        dedupeKey: `meta-token-health:${row.workspace_id}:${row.id}:${bucket}`,
      })))),
    }),
    scanScheduledRowsById<ScheduledConnectionRow>({
      fetchPage: async (afterId, limit) => {
        let query = service
          .from("provider_connections")
          .select("id,workspace_id")
          .eq("provider", "google")
          .eq("status", "connected")
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return await query as unknown as ScheduledPage<ScheduledConnectionRow>;
      },
      handlePage: async (rows) => recordResults(await Promise.allSettled(rows.map((row) => enqueueQueuedJob({
        workspaceId: row.workspace_id,
        kind: "sync.provider.reports",
        payload: { workspaceId: row.workspace_id, provider: "google" },
        maxAttempts: 3,
        dedupeKey: `provider-report-sync:${row.workspace_id}:google:${bucket}`,
      })))),
    }),
  ]);
  scanned = metaScanned + googleScanned;
  return { scanned, queued, failed };
}

export async function queueScheduledPerformanceReadModels(service: ServiceSupabase) {
  const bucket = Math.floor(Date.now() / (15 * 60_000));
  const reportingWorkspaces = new Set<string>();
  let queued = 0;
  let failed = 0;

  const recordResults = (results: PromiseSettledResult<unknown>[]) => {
    queued += results.filter((result) => result.status === "fulfilled").length;
    failed += results.filter((result) => result.status === "rejected").length;
  };

  const reportingScanned = await scanScheduledRowsById<ScheduledConnectionRow>({
      fetchPage: async (afterId, limit) => {
        let query = service
          .from("provider_connections")
          .select("id,workspace_id")
          .eq("provider", "meta")
          .eq("status", "connected")
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return await query as unknown as ScheduledPage<ScheduledConnectionRow>;
      },
      handlePage: async (rows) => {
        const workspaceIds = rows
          .map((row) => row.workspace_id)
          .filter((workspaceId) => {
            if (reportingWorkspaces.has(workspaceId)) return false;
            reportingWorkspaces.add(workspaceId);
            return true;
          });
        recordResults(await Promise.allSettled(workspaceIds.map((workspaceId) => enqueueQueuedJob({
          workspaceId,
          kind: "reporting.refresh",
          payload: { workspaceId, range: "last_30" },
          maxAttempts: 3,
          dedupeKey: `reporting-refresh:${workspaceId}:last-30:${bucket}`,
        }))));
      },
    });

  return {
    scanned: reportingScanned,
    queued,
    failed,
  };
}

export async function queueScheduledActivationReconciliations(service: ServiceSupabase) {
  const bucket = Math.floor(Date.now() / (24 * 60 * 60_000));
  let queued = 0;
  let failed = 0;
  const scanned = await scanScheduledRowsById<{ id: string }>({
      fetchPage: async (afterId, limit) => {
        let query = service
          .from("workspaces")
          .select("id")
          .order("id", { ascending: true })
          .limit(limit);
        if (afterId) query = query.gt("id", afterId);
        return await query as unknown as ScheduledPage<{ id: string }>;
      },
      handlePage: async (rows) => {
        const results = await Promise.allSettled(rows.map((row) => enqueueQueuedJob({
          workspaceId: row.id,
          kind: "reconcile.customer.activation",
          payload: { workspaceId: row.id },
          maxAttempts: 3,
          dedupeKey: `activation-reconcile:${row.id}:${bucket}`,
        })));
        queued += results.filter((result) => result.status === "fulfilled").length;
        failed += results.filter((result) => result.status === "rejected").length;
      },
    });

  return { scanned, queued, failed };
}

export async function runScheduledMetaPublishWatchdog() {
  const service = createSupabaseServiceClient();
  const [{ data: reaped, error: reapError }, recovery] = await Promise.all([
    service.rpc("reap_stale_jobs", { p_lease_seconds: 600 }),
    recoverStuckMetaPublishPlans({ stuckMinutes: 5 }),
  ]);
  if (reapError) throw new Error(`Queue reaper failed: ${reapError.message}`);

  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stalled, error: stalledError } = await service
    .from("job_queue")
    .select("id,kind,status,created_at,claimed_at,last_error")
    .in("status", ["pending", "processing"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(25);
  if (stalledError) throw new Error(`Queue watchdog failed: ${stalledError.message}`);
  if ((stalled?.length ?? 0) > 0) {
    const oldest = stalled?.[0];
    await sendAlertEmail({
      subject: `[Blockwise CRITICAL] ${stalled?.length} background job(s) stalled`,
      text: (stalled ?? []).map((job) => `${job.kind} · ${job.status} · created ${job.created_at}${job.last_error ? ` · ${job.last_error}` : ""}`).join("\n"),
      idempotencyKey: `queue-stalled:${oldest?.id}:${oldest?.status}`,
    });
  }

  return { ...recovery, reaped: Number(reaped ?? 0), stalled: stalled?.length ?? 0 };
}
