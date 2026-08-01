/**
 * VPS background worker — the Trigger.dev replacement.
 *
 * Polls public.job_queue (via the service-role RPCs added in
 * 20260801030000_job_queue.sql), claims one due job at a time, dispatches to the
 * SAME worker functions the Trigger tasks call, and records success/failure.
 *
 * Why this exists: Trigger.dev strands in-flight provider jobs on every deploy
 * because a killed run holds the per-plan concurrency lock forever. A worker on
 * the VPS is never redeployed when Blockwise ships, and its lease reaper
 * (reap_stale_jobs) returns any job held by a dead worker back to pending. The
 * whole "stranded by deploy" failure class disappears.
 *
 * Phase 1 scope: the on-demand provider jobs that are cleanly importable from
 * src/lib WITHOUT pulling in @trigger.dev/sdk. The publish/mutation workers
 * still import queueReportingRefresh (Trigger-coupled) and are wired up in
 * Phase 2 after that coupling is cut. Nothing in this file touches production
 * until a producer is flipped from tasks.trigger() to enqueue_job() in Phase 2.
 *
 * Handler modules are loaded DYNAMICALLY (only when their job kind is claimed)
 * so the Trigger-coupled modules never load unless their jobs are actually
 * enqueued. This keeps the prod image free of @trigger.dev/sdk.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type ServiceSupabase = ReturnType<typeof createSupabaseServiceClient>;
type Handler = (payload: Record<string, unknown>, supabase: ServiceSupabase) => Promise<unknown>;

interface ClaimedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Dynamic dispatch: each kind lazy-imports its worker module so the import
 * graph only reaches @trigger.dev/sdk when a Trigger-coupled job is actually
 * claimed. Phase 1 enqueues only sync.meta.leads and deliver.lead.
 */
async function resolveHandler(kind: string): Promise<Handler | null> {
  switch (kind) {
    case "sync.meta.leads": {
      const { syncMetaLeadsForPlanById } = await import("../src/lib/providers/meta-leads-worker.ts");
      return (payload, supabase) =>
        syncMetaLeadsForPlanById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          planId: String(payload.planId),
          since: (payload.since as string | null | undefined) ?? null,
        });
    }
    case "deliver.lead": {
      const { executeLeadDeliveryAttemptById } = await import("../src/lib/providers/lead-delivery-worker.ts");
      return (payload, supabase) =>
        executeLeadDeliveryAttemptById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          attemptId: String(payload.attemptId),
        });
    }
    case "reporting.refresh": {
      const { refreshReportingSnapshot } = await import("../src/lib/meta-monitor/reporting-snapshots.ts");
      return (payload, supabase) =>
        refreshReportingSnapshot({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          range: String(payload.range) as import("../src/lib/meta-monitor/types.ts").MonitorRange,
          customRange: payload.customRange as import("../src/lib/meta-monitor/types.ts").MonitorCustomRange | undefined,
        });
    }
    // Phase 2: decouple these from @trigger.dev/sdk, then enable.
    // case "publish.meta.execute": { ... }
    // case "publish.meta.mutate": { ... }
    default:
      return null;
  }
}

const POLL_IDLE_MS = Number(process.env.WORKER_POLL_IDLE_MS ?? 3000);
const POLL_BUSY_MS = Number(process.env.WORKER_POLL_BUSY_MS ?? 250);
const REAP_EVERY_MS = Number(process.env.WORKER_REAP_INTERVAL_MS ?? 60_000);
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS ?? 600);

function log(message: string) {
  console.log(`[worker ${new Date().toISOString()}] ${message}`);
}

/** Run exactly one job. Returns true if a job was claimed and handled. */
async function runOnce(supabase: ServiceSupabase): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_job", { p_kind: null });
  if (error) {
    throw new Error(`claim_job failed: ${error.message}`);
  }

  const rows = (data ?? []) as ClaimedJob[];
  const job = rows[0];
  if (!job) return false;

  const handler = await resolveHandler(job.kind);
  if (!handler) {
    await supabase.rpc("fail_job", {
      p_id: job.id,
      p_error: `No handler registered for job kind "${job.kind}".`,
    });
    log(`job ${job.id} (${job.kind}) failed: unknown kind`);
    return true;
  }

  log(`job ${job.id} (${job.kind}) attempt ${job.attempts}/${job.max_attempts} start`);
  const started = Date.now();
  try {
    await handler(job.payload ?? {}, supabase);
    await supabase.rpc("complete_job", { p_id: job.id });
    log(`job ${job.id} (${job.kind}) completed in ${Date.now() - started}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data: outcome } = await supabase.rpc("fail_job", {
      p_id: job.id,
      p_error: message,
    });
    log(`job ${job.id} (${job.kind}) ${String(outcome)}: ${message}`);
  }
  return true;
}

async function reap(supabase: ServiceSupabase) {
  try {
    const { data, error } = await supabase.rpc("reap_stale_jobs", {
      p_lease_seconds: LEASE_SECONDS,
    });
    if (error) {
      log(`reap failed: ${error.message}`);
    } else if (Number(data) > 0) {
      log(`reaped ${Number(data)} stale job(s) back to pending`);
    }
  } catch (err) {
    log(`reap error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const supabase = createSupabaseServiceClient();
  log(
    `starting: pollIdle=${POLL_IDLE_MS}ms pollBusy=${POLL_BUSY_MS}ms lease=${LEASE_SECONDS}s reapEvery=${REAP_EVERY_MS}ms`,
  );

  // Periodic reaper: self-heal jobs held by a dead worker. This is the core
  // recovery mechanism that Trigger.dev lacked.
  const reaper = setInterval(() => void reap(supabase), REAP_EVERY_MS);
  reaper.unref?.();
  await reap(supabase);

  // Single-threaded claim loop. claim_job is concurrency-safe (FOR UPDATE SKIP
  // LOCKED), so multiple worker replicas can run this same loop without
  // double-processing. One job at a time keeps provider side-effects ordered
  // per worker and bounded.
  for (;;) {
    try {
      const did = await runOnce(supabase);
      await sleep(did ? POLL_BUSY_MS : POLL_IDLE_MS);
    } catch (err) {
      log(`loop error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(POLL_IDLE_MS);
    }
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
