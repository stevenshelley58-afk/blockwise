/**
 * VPS background worker for durable provider and recovery jobs.
 *
 * Polls public.job_queue (via the service-role RPCs added in
 * 20260801030000_job_queue.sql), claims one due job at a time, dispatches to the
 * the same provider worker functions as the web app, and records success/failure.
 *
 * A worker on the VPS is not redeployed when the web app ships, and its lease reaper
 * (reap_stale_jobs) returns any job held by a dead worker back to pending. The
 * whole "stranded by deploy" failure class disappears.
 *
 * Scope: all on-demand provider jobs, including publish and mutations. The
 * Handler modules are loaded DYNAMICALLY (only when their job kind is claimed)
 * so provider code only loads when its job is actually claimed.
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
 * Dynamic dispatch: each kind lazy-imports its worker module so handler code
 * only loads when its job kind is actually claimed.
 */
async function resolveHandler(kind: string): Promise<Handler | null> {
  switch (kind) {
    case "adstudio.generate.template": {
      const { recordWorkspaceFunnelEventBestEffort } = await import("../src/lib/analytics/progressive-funnel.ts");
      const {
        assertDeterministicFeedEditingReady,
        runTemplateCampaignGeneration,
      } = await import("../src/lib/adstudio/generate-template-campaign.ts");
      return async (payload, supabase) => {
        const workspaceId = String(payload.workspaceId ?? "");
        const userId = String(payload.userId ?? "");
        const creativeJobId = String(payload.creativeJobId ?? "");
        const origin = String(payload.origin ?? "");
        if (!workspaceId || !userId || !creativeJobId || !origin) {
          throw new Error("Ad Studio recovery payload is incomplete.");
        }

        const job = await supabase
          .from("adstudio_creative_jobs")
          .select("id,status,attempts,payload,campaign_id")
          .eq("workspace_id", workspaceId)
          .eq("id", creativeJobId)
          .maybeSingle();
        if (job.error) throw new Error(job.error.message);
        if (!job.data) throw new Error(`Ad Studio job ${creativeJobId} was not found.`);
        if (job.data.status === "done") return { campaignId: job.data.campaign_id };

        const stored = (job.data.payload ?? {}) as {
          body?: import("../src/lib/adstudio/generate-template-campaign.ts").CreateCampaignBody;
          reservation?: import("../src/lib/adstudio/generation-credits.ts").AdStudioGenerationCreditReservation | null;
          workspaceName?: string;
          region?: string;
          correlationId?: string;
          expectedCampaignId?: string;
        };
        if (!stored.body) throw new Error("Ad Studio recovery job has no generation body.");
        const reservation = stored.reservation ?? undefined;

        await supabase
          .from("adstudio_creative_jobs")
          .update({
            status: "running",
            attempts: (Number(job.data.attempts) || 0) + 1,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", creativeJobId);

        let result: Awaited<ReturnType<typeof runTemplateCampaignGeneration>>;
        try {
          result = await runTemplateCampaignGeneration({
            supabase,
            workspaceId,
            userId,
            origin,
            body: stored.body,
            workspaceName: stored.workspaceName,
            region: stored.region,
            creditReservation: reservation,
            correlationId: stored.correlationId,
            expectedCampaignId: stored.expectedCampaignId,
          });
        } catch (error) {
          // Generation mutates the reservation as each format settles. Persist
          // that live balance so final failure handling refunds only credits
          // that are still outstanding, never a successfully-created Feed.
          await supabase
            .from("adstudio_creative_jobs")
            .update({
              payload: { ...stored, reservation: reservation ?? null },
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", workspaceId)
            .eq("id", creativeJobId);
          throw error;
        }
        if (result.requiresDeterministicEditing) {
          try {
            await result.editingLayersTask;
            await assertDeterministicFeedEditingReady({
              supabase,
              workspaceId,
              campaignId: result.campaignId,
            });
          } catch (error) {
            await supabase
              .from("adstudio_creative_jobs")
              .update({
                payload: { ...stored, reservation: reservation ?? null },
                updated_at: new Date().toISOString(),
              })
              .eq("workspace_id", workspaceId)
              .eq("id", creativeJobId);
            throw error;
          }
        }

        const completed = await supabase
          .from("adstudio_creative_jobs")
          .update({
            status: "done",
            campaign_id: result.campaignId,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", creativeJobId);
        if (completed.error) throw new Error(completed.error.message);

        await recordWorkspaceFunnelEventBestEffort(supabase, {
          eventName: "first_generation_completed",
          workspaceId,
          idempotencyKey: `activation:${workspaceId}:first-generation-completed`,
          properties: {
            mutation_key: reservation?.mutationKey ?? creativeJobId,
            campaign_id: result.campaignId,
            execution: "vps_recovery",
          },
        });
        if (!result.requiresDeterministicEditing) await result.editingLayersTask;
        if (result.storyTask) await result.storyTask;
        return { campaignId: result.campaignId };
      };
    }
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
    case "reconcile.customer.activation": {
      const { resolveCustomerActivation } = await import("../src/lib/activation/customer-activation.ts");
      return (payload, supabase) => {
        const workspaceId = String(payload.workspaceId ?? "");
        if (!workspaceId) throw new Error("Customer activation payload is incomplete.");
        return resolveCustomerActivation({
          workspaceId,
          serviceSupabase: supabase,
          repair: true,
        });
      };
    }
    case "check.meta.token-health": {
      const { checkMetaConnectionHealth } = await import("../src/lib/providers/meta-assets.ts");
      const { loadStoredProviderTokens } = await import("../src/lib/providers/provider-connections.ts");
      return async (payload, supabase) => {
        const workspaceId = String(payload.workspaceId ?? "");
        const connectionId = String(payload.connectionId ?? "");
        if (!workspaceId || !connectionId) throw new Error("Meta token-health payload is incomplete.");

        const connection = await supabase
          .from("provider_connections")
          .select("id,workspace_id,token_expires_at")
          .eq("workspace_id", workspaceId)
          .eq("id", connectionId)
          .eq("provider", "meta")
          .maybeSingle();
        if (connection.error) throw new Error(connection.error.message);
        if (!connection.data) throw new Error(`Meta connection ${connectionId} was not found.`);

        const tokens = await loadStoredProviderTokens(supabase, connectionId);
        const health = await checkMetaConnectionHealth({
          accessToken: tokens.accessToken ?? "",
          tokenExpiresAt: connection.data.token_expires_at,
        });
        const status = health.status === "needs_reconnect" || health.status === "missing_token"
          ? "needs_attention"
          : "connected";
        const updated = await supabase
          .from("provider_connections")
          .update({
            status,
            health_status: health.status,
            health_checked_at: health.checkedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", workspaceId)
          .eq("id", connectionId)
          .eq("provider", "meta");
        if (updated.error) throw new Error(updated.error.message);
        return health;
      };
    }
    case "sync.provider.reports": {
      const { resolveMonitorDateRange } = await import("../src/lib/monitor/dashboard-data.ts");
      const { syncProviderWorkspace } = await import("../src/lib/providers/provider-sync.ts");
      return (payload, supabase) => {
        const workspaceId = String(payload.workspaceId ?? "");
        const provider = String(payload.provider ?? "");
        if (!workspaceId || provider !== "google") {
          throw new Error("Provider report-sync payload is invalid.");
        }
        return syncProviderWorkspace({
          supabase: supabase as never,
          serviceSupabase: supabase,
          workspaceId,
          provider,
          range: resolveMonitorDateRange("last_30"),
          jobKey: "sync-provider-reports",
        });
      };
    }
    case "publish.meta.execute": {
      const { executeMetaPublishPlanById } = await import("../src/lib/providers/meta-publish-worker.ts");
      return (payload, supabase) =>
        executeMetaPublishPlanById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          planId: String(payload.planId),
        });
    }
    case "publish.meta.mutate": {
      const { executeMetaMutationById } = await import("../src/lib/providers/meta-mutation-worker.ts");
      return (payload, supabase) =>
        executeMetaMutationById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          mutationId: String(payload.mutationId),
        });
    }
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
    if (job.kind === "adstudio.generate.template" && String(outcome) === "failed") {
      await finalizeAdStudioGenerationFailure(job.payload, message, supabase);
    }
    log(`job ${job.id} (${job.kind}) ${String(outcome)}: ${message}`);
  }
  return true;
}

async function finalizeAdStudioGenerationFailure(
  payload: Record<string, unknown>,
  message: string,
  supabase: ServiceSupabase,
): Promise<void> {
  const workspaceId = String(payload.workspaceId ?? "");
  const creativeJobId = String(payload.creativeJobId ?? "");
  if (!workspaceId || !creativeJobId) return;

  const job = await supabase
    .from("adstudio_creative_jobs")
    .select("status,payload")
    .eq("workspace_id", workspaceId)
    .eq("id", creativeJobId)
    .maybeSingle();
  if (!job.data || job.data.status === "done" || job.data.status === "failed") return;
  const stored = (job.data.payload ?? {}) as {
    reservation?: import("../src/lib/adstudio/generation-credits.ts").AdStudioGenerationCreditReservation | null;
  };
  const { refundOutstandingWorkspaceCredits } = await import("../src/lib/credits/workspace-credits.ts");
  await refundOutstandingWorkspaceCredits({
    reservation: stored.reservation ?? null,
    mutationKey: `${stored.reservation?.mutationKey ?? creativeJobId}:refund:vps-recovery-failure`,
    reason: "generation_vps_recovery_failed",
    serviceSupabase: supabase,
  });
  await supabase
    .from("adstudio_creative_jobs")
    .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", creativeJobId);
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
  // recovery mechanism for a worker crash or host restart.
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
