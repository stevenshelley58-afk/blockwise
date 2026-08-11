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
 * Scope: all on-demand provider jobs, including publish and mutations.
 * Handler modules are loaded dynamically. Startup preflight resolves the
 * publish and reporting handlers so a broken production dependency fails
 * before the worker can claim a job; other handlers load when first claimed.
 * Provider execution is VPS-only; there is no alternate task-runner path.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { resolveSupabaseServerCredential } from "../src/lib/supabase/credentials.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type ServiceSupabase = ReturnType<typeof createSupabaseServiceClient>;
type HandlerExecutionContext = {
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  metaActivationCompensationFetchImpl?: typeof fetch;
};
type Handler = (
  payload: Record<string, unknown>,
  supabase: ServiceSupabase,
  context: HandlerExecutionContext,
) => Promise<unknown>;
type HandlerResolver = (kind: string) => Promise<Handler | null>;

interface ClaimedJob {
  id: string;
  workspace_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  lease_token: string;
}

/**
 * Dynamic dispatch: each kind lazy-imports its worker module so handler code
 * only loads when its job kind is actually claimed.
 */
export async function resolveHandler(kind: string): Promise<Handler | null> {
  switch (kind) {
    case "adstudio.generate.template": {
      const { recordWorkspaceFunnelEventBestEffort } = await import("../src/lib/analytics/progressive-funnel.ts");
      const {
        assertDeterministicFeedEditingReady,
        runTemplateCampaignGeneration,
      } = await import("../src/lib/adstudio/generate-template-campaign.ts");
      const { loadRuntimeProviderToken } = await import("../src/lib/providers/provider-connections.ts");
      return async (payload, supabase, context) => {
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
        if (job.data.status === "done" || job.data.status === "failed") {
          return { campaignId: job.data.campaign_id };
        }

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
        const [openAiApiKey, googleAiApiKey] = await Promise.all([
          loadRuntimeProviderToken(supabase, "openai"),
          loadRuntimeProviderToken(supabase, "google"),
        ]);
        if (!openAiApiKey && !googleAiApiKey) {
          throw new Error("No encrypted image-generation runtime credential is provisioned.");
        }
        // Never mutate process.env or put this key in the VPS deployment file.
        // Each provider receives an explicit copy scoped to this job.
        const providerEnv = {
          ...process.env,
          ...(openAiApiKey ? { OPENAI_API_KEY: openAiApiKey } : {}),
          ...(googleAiApiKey ? { GOOGLE_AI_API_KEY: googleAiApiKey } : {}),
        };

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
            providerEnv,
            signal: context.signal,
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
      return (payload, supabase, context) =>
        syncMetaLeadsForPlanById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          planId: String(payload.planId),
          since: (payload.since as string | null | undefined) ?? null,
          fetchImpl: context.fetchImpl,
        });
    }
    case "deliver.lead": {
      const { executeLeadDeliveryAttemptById } = await import("../src/lib/providers/lead-delivery-worker.ts");
      return (payload, supabase, context) =>
        executeLeadDeliveryAttemptById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          attemptId: String(payload.attemptId),
          fetchImpl: context.fetchImpl,
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
      return (payload, supabase, context) =>
        executeMetaPublishPlanById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          planId: String(payload.planId),
          fetchImpl: context.fetchImpl,
          compensationFetchImpl: context.metaActivationCompensationFetchImpl,
          signal: context.signal,
        });
    }
    case "publish.meta.mutate": {
      const { executeMetaMutationById } = await import("../src/lib/providers/meta-mutation-worker.ts");
      return (payload, supabase, context) =>
        executeMetaMutationById({
          serviceSupabase: supabase,
          workspaceId: String(payload.workspaceId),
          mutationId: String(payload.mutationId),
          fetchImpl: context.fetchImpl,
          compensationFetchImpl: context.metaActivationCompensationFetchImpl,
        });
    }
    default:
      return null;
  }
}

const POLL_IDLE_MS = positiveNumber("WORKER_POLL_IDLE_MS", 3000);
const POLL_BUSY_MS = positiveNumber("WORKER_POLL_BUSY_MS", 250);
const REAP_EVERY_MS = positiveNumber("WORKER_REAP_INTERVAL_MS", 60_000);
const LEASE_SECONDS = positiveNumber("WORKER_LEASE_SECONDS", 600);
const HEARTBEAT_EVERY_MS = positiveNumber(
  "WORKER_HEARTBEAT_INTERVAL_MS",
  Math.max(1_000, Math.floor((LEASE_SECONDS * 1_000) / 3)),
);
const META_ACTIVATION_COMPENSATION_REQUEST_TIMEOUT_MS = 30_000;
const LEASE_LOSS_HANDLER_DRAIN_TIMEOUT_MS = 100_000;
const JOB_EXECUTION_TIMEOUT_MS = positiveNumber("WORKER_JOB_TIMEOUT_MS", 15 * 60_000);
const JOB_TIMEOUT_HANDLER_DRAIN_MS = 30_000;

if (HEARTBEAT_EVERY_MS >= LEASE_SECONDS * 1_000) {
  throw new Error("WORKER_HEARTBEAT_INTERVAL_MS must be shorter than WORKER_LEASE_SECONDS.");
}

function log(message: string) {
  console.log(`[worker ${new Date().toISOString()}] ${message}`);
}

/** Run exactly one job. Returns true if a job was claimed and handled. */
export async function runOnce(
  supabase: ServiceSupabase,
  options: {
    resolveHandler?: HandlerResolver;
    heartbeatEveryMs?: number;
    heartbeatTimeoutMs?: number;
    leaseSeconds?: number;
    fetchImpl?: typeof fetch;
    executionTimeoutMs?: number;
    shutdownSignal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS;
  const heartbeatEveryMs = options.heartbeatEveryMs ?? HEARTBEAT_EVERY_MS;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
    throw new Error("Worker lease duration must be an integer between 30 and 3600 seconds.");
  }
  if (!Number.isFinite(heartbeatEveryMs) || heartbeatEveryMs <= 0 || heartbeatEveryMs >= leaseSeconds * 1_000) {
    throw new Error("Worker heartbeat interval must be positive and shorter than the lease.");
  }
  const { data, error } = await supabase.rpc("claim_job_v2", {
    p_kind: null,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`claim_job_v2 failed: ${error.message}`);
  }

  const rows = (data ?? []) as ClaimedJob[];
  const job = rows[0];
  if (!job) return false;

  assertClaimedJob(job);

  log(`job ${job.id} (${job.kind}) attempt ${job.attempts}/${job.max_attempts} start`);
  const started = Date.now();
  const heartbeat = startLeaseHeartbeat(supabase, job, {
    everyMs: heartbeatEveryMs,
    leaseSeconds,
    timeoutMs: options.heartbeatTimeoutMs,
  });
  const executionController = new AbortController();
  const executionTimeoutMs = options.executionTimeoutMs ?? JOB_EXECUTION_TIMEOUT_MS;
  const executionSignals = [heartbeat.signal, executionController.signal];
  if (options.shutdownSignal) executionSignals.push(options.shutdownSignal);
  const executionSignal = AbortSignal.any(executionSignals);
  let executionError: Error | null = null;
  const handlerPromise = (async () => {
    assertPayloadWorkspace(job);
    const handler = await (options.resolveHandler ?? resolveHandler)(job.kind);
    if (!handler) {
      throw new Error(`No handler registered for job kind "${job.kind}".`);
    }
    const fetchImpl = createLeaseGuardedFetch(executionSignal, options.fetchImpl);
    await handler(job.payload ?? {}, supabase, {
      signal: executionSignal,
      fetchImpl,
      ...(job.kind === "publish.meta.execute" || job.kind === "publish.meta.mutate"
        ? { metaActivationCompensationFetchImpl: createMetaActivationCompensationFetch(options.fetchImpl) }
        : {}),
    });
  })();

  const timeoutError = new Error(`Job execution timed out after ${executionTimeoutMs}ms.`);
  const executionTimeout = setTimeout(() => executionController.abort(timeoutError), executionTimeoutMs);
  const executionTimedOut = new Promise<never>((_resolve, reject) => {
    executionController.signal.addEventListener("abort", () => reject(executionController.signal.reason), { once: true });
  });

  try {
    await Promise.race([handlerPromise, heartbeat.whenLost, executionTimedOut]);
  } catch (err) {
    executionError = toError(err);
  } finally {
    clearTimeout(executionTimeout);
  }

  const heartbeatError = await heartbeat.stop();
  if (heartbeatError) {
    // Never settle a lost lease. Ordinary provider I/O has already been
    // aborted, but an activation handler may still be completing its bounded,
    // PAUSE-only compensation. Wait for that safety path before this worker
    // can claim another job.
    try {
      await withTimeout(
        handlerPromise.then(() => undefined, () => undefined),
        LEASE_LOSS_HANDLER_DRAIN_TIMEOUT_MS,
        `Lease-loss handler drain timed out after ${LEASE_LOSS_HANDLER_DRAIN_TIMEOUT_MS}ms.`,
      );
    } catch (drainError) {
      throw new WorkerRestartRequiredError(
        `Job ${job.id} did not stop after lease loss: ${toError(drainError).message}`,
      );
    }
    throw heartbeatError;
  }

  if (executionError) {
    if (executionController.signal.aborted) {
      try {
        await withTimeout(
          handlerPromise.then(() => undefined, () => undefined),
          JOB_TIMEOUT_HANDLER_DRAIN_MS,
          `Timed-out handler did not stop within ${JOB_TIMEOUT_HANDLER_DRAIN_MS}ms.`,
        );
      } catch (drainError) {
        throw new WorkerRestartRequiredError(
          `Job ${job.id} remained active after timeout: ${toError(drainError).message}`,
        );
      }
    }
    const outcome = await settleFailedJob(supabase, job, executionError.message);
    if (job.kind === "adstudio.generate.template" && outcome === "failed") {
      await finalizeAdStudioGenerationFailure(job.payload, executionError.message, supabase);
      await releaseAdStudioGenerationLock(job.payload, supabase);
    }
    log(`job ${job.id} (${job.kind}) ${outcome}: ${executionError.message}`);
    return true;
  }

  await settleCompletedJob(supabase, job);
  if (job.kind === "adstudio.generate.template") {
    await releaseAdStudioGenerationLock(job.payload, supabase);
  }
  log(`job ${job.id} (${job.kind}) completed in ${Date.now() - started}ms`);
  return true;
}

async function releaseAdStudioGenerationLock(
  payload: Record<string, unknown>,
  supabase: ServiceSupabase,
): Promise<void> {
  const workspaceId = String(payload.workspaceId ?? "");
  const dedupeKey = String(payload.generationDedupKey ?? "");
  const creativeJobId = String(payload.creativeJobId ?? "");
  if (!workspaceId || !dedupeKey || !creativeJobId) return;
  const deleted = await supabase
    .from("adstudio_generation_locks")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("dedupe_key", dedupeKey)
    // Ownership fence: an older terminal job must never delete a lock that a
    // newer retry has already reclaimed and rebound to itself.
    .eq("job_id", creativeJobId);
  if (deleted.error) {
    console.error("Ad Studio generation lock release failed", deleted.error.message);
  }
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

function startLeaseHeartbeat(
  supabase: ServiceSupabase,
  job: ClaimedJob,
  options: { everyMs: number; leaseSeconds: number; timeoutMs?: number },
): {
  signal: AbortSignal;
  whenLost: Promise<never>;
  stop: () => Promise<Error | null>;
} {
  let stopped = false;
  let failure: Error | null = null;
  let inFlight: Promise<void> | null = null;
  let leaseDeadline = Date.now() + options.leaseSeconds * 1_000;
  let nextAttemptAt = Date.now() + options.everyMs;
  const controller = new AbortController();
  let rejectWhenLost!: (error: Error) => void;
  const whenLost = new Promise<never>((_resolve, reject) => {
    rejectWhenLost = reject;
  });
  // Promise.race observes this immediately in runOnce; this defensive catch
  // also prevents an unhandled rejection during exceptional setup failures.
  void whenLost.catch(() => undefined);
  const timeoutMs = options.timeoutMs ?? Math.max(
    100,
    Math.min(10_000, Math.floor(options.everyMs / 2), Math.floor((options.leaseSeconds * 1_000) / 4)),
  );
  const retryMs = Math.max(50, Math.min(1_000, Math.floor(options.everyMs / 4)));

  const loseLease = (error: Error) => {
    if (failure) return;
    failure = error;
    clearInterval(timer);
    controller.abort(error);
    rejectWhenLost(error);
  };

  const timer = setInterval(() => {
    if (stopped || failure || inFlight || Date.now() < nextAttemptAt) return;

    inFlight = heartbeatJob(supabase, job, options.leaseSeconds, timeoutMs)
      .then(() => {
        leaseDeadline = Date.now() + options.leaseSeconds * 1_000;
        nextAttemptAt = Date.now() + options.everyMs;
      })
      .catch((error: unknown) => {
        const heartbeatError = toError(error);
        if (heartbeatError instanceof LeaseLostError || Date.now() + timeoutMs >= leaseDeadline) {
          loseLease(heartbeatError);
          return;
        }
        // A transport timeout is not proof that the lease was lost. Retry
        // inside the known lease window instead of abandoning heartbeats.
        nextAttemptAt = Date.now() + retryMs;
      })
      .finally(() => {
        inFlight = null;
      });
  }, Math.max(10, Math.min(1_000, options.everyMs)));
  return {
    signal: controller.signal,
    whenLost,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
      return failure;
    },
  };
}

async function heartbeatJob(
  supabase: ServiceSupabase,
  job: ClaimedJob,
  leaseSeconds: number,
  timeoutMs: number,
): Promise<void> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("heartbeat_job", {
      p_workspace_id: job.workspace_id,
      p_id: job.id,
      p_lease_token: job.lease_token,
      p_lease_seconds: leaseSeconds,
    })),
    timeoutMs,
    `heartbeat_job timed out after ${timeoutMs}ms.`,
  );
  if (error) {
    throw new Error(`heartbeat_job failed: ${error.message}`);
  }
  if (data !== true) {
    throw new LeaseLostError(`heartbeat_job lost the lease for job ${job.id}.`);
  }
}

class LeaseLostError extends Error {}
class WorkerRestartRequiredError extends Error {}

function createLeaseGuardedFetch(signal: AbortSignal, fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (signal.aborted) throw signal.reason;
    const requestSignal = init?.signal ?? (
      typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined
    );
    const combinedSignal = requestSignal
      ? AbortSignal.any([signal, requestSignal])
      : signal;
    return fetchImpl(input, { ...init, signal: combinedSignal });
  };
}

/**
 * Emergency transport for Meta activation rollback only. It deliberately does
 * not inherit the lost queue lease signal, but it rejects every operation
 * except a PAUSED status write or the matching status verification read.
 */
function createMetaActivationCompensationFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (typeof input !== "string" && !(input instanceof URL)) {
      throw new Error("Meta activation compensation requires an explicit Graph API URL.");
    }

    const url = new URL(String(input));
    const pathParts = url.pathname.split("/").filter(Boolean);
    const targetsMetaObject =
      url.protocol === "https:" &&
      url.hostname === "graph.facebook.com" &&
      pathParts.length === 2 &&
      /^v\d+\.\d+$/u.test(pathParts[0] ?? "") &&
      /^\d+$/u.test(pathParts[1] ?? "");
    const method = (init?.method ?? "GET").toUpperCase();
    let permitted = false;

    if (targetsMetaObject && method === "POST" && url.search === "" && typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        permitted = Object.keys(body).length === 1 && body.status === "PAUSED";
      } catch {
        permitted = false;
      }
    } else if (targetsMetaObject && method === "GET" && init?.body == null) {
      permitted =
        url.searchParams.size === 1 &&
        url.searchParams.get("fields") === "configured_status,effective_status,status";
    }

    if (!permitted) {
      throw new Error(
        "Meta activation compensation permits only PAUSED writes and status verification reads.",
      );
    }

    const requestSignal = init?.signal;
    const timeoutSignal = AbortSignal.timeout(META_ACTIVATION_COMPENSATION_REQUEST_TIMEOUT_MS);
    return fetchImpl(input, {
      ...init,
      redirect: "error",
      signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
    });
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settleCompletedJob(supabase: ServiceSupabase, job: ClaimedJob): Promise<void> {
  const { data, error } = await supabase.rpc("complete_job_v2", {
    p_workspace_id: job.workspace_id,
    p_id: job.id,
    p_lease_token: job.lease_token,
  });
  if (error) {
    throw new Error(`complete_job_v2 failed: ${error.message}`);
  }
  if (data !== true) {
    throw new Error(`complete_job_v2 lost the lease for job ${job.id}.`);
  }
}

async function settleFailedJob(
  supabase: ServiceSupabase,
  job: ClaimedJob,
  message: string,
): Promise<"pending" | "failed"> {
  const { data, error } = await supabase.rpc("fail_job_v2", {
    p_workspace_id: job.workspace_id,
    p_id: job.id,
    p_lease_token: job.lease_token,
    p_error: message,
  });
  if (error) {
    throw new Error(`fail_job_v2 failed: ${error.message}`);
  }
  if (data !== "pending" && data !== "failed") {
    throw new Error(`fail_job_v2 lost the lease for job ${job.id}.`);
  }
  return data;
}

function assertClaimedJob(job: ClaimedJob): void {
  if (
    !job.id ||
    !job.workspace_id ||
    !job.kind ||
    !job.lease_token ||
    !Number.isInteger(job.attempts) ||
    !Number.isInteger(job.max_attempts)
  ) {
    throw new Error("claim_job_v2 returned a malformed job lease.");
  }
}

function assertPayloadWorkspace(job: ClaimedJob): void {
  if (String(job.payload?.workspaceId ?? "") !== job.workspace_id) {
    throw new Error(`Job ${job.id} payload workspace does not match its queue workspace.`);
  }
}

type WorkerPreflightReport = {
  status: "ready";
  revision: string;
  handlers: Record<"publish.meta.execute" | "reporting.refresh", "loaded">;
  routing: { vpsOnly: true };
  runtime: {
    providerWritesEnabled: true;
    supabaseUrlPresent: true;
    supabaseCredentialPresent: true;
    tokenEncryptionKeyPresent: true;
    stripeSecretKeyPresent: boolean;
  };
};

/**
 * Credential-safe image/runtime contract check. It loads the same handler
 * modules used by dispatch, verifies the VPS runtime environment and embedded
 * revision, and reports booleans only. It never creates a Supabase client or
 * makes a provider/network request.
 */
export async function preflightWorker(expectedRevision?: string): Promise<WorkerPreflightReport> {
  const revision = readEmbeddedRevision();
  if (expectedRevision) {
    assertExpectedRevision(expectedRevision, revision);
  }

  for (const kind of ["publish.meta.execute", "reporting.refresh"] as const) {
    const handler = await resolveHandler(kind);
    if (!handler) {
      throw new Error(`Worker preflight could not resolve ${kind}.`);
    }
  }

  const providerWritesEnabled = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
  const supabaseUrlPresent = hasValue(process.env.NEXT_PUBLIC_SUPABASE_URL) || hasValue(process.env.SUPABASE_URL);
  const supabaseCredentialPresent = Boolean(resolveSupabaseServerCredential());
  const tokenEncryptionKeyPresent = hasValue(process.env.TOKEN_ENCRYPTION_KEY);
  const stripeSecretKeyPresent = hasValue(process.env.STRIPE_SECRET_KEY);

  const missing: string[] = [];
  if (!providerWritesEnabled) missing.push("BLOCKWISE_ENABLE_PROVIDER_WRITES=true");
  if (!supabaseUrlPresent) missing.push("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseCredentialPresent) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (!tokenEncryptionKeyPresent) missing.push("TOKEN_ENCRYPTION_KEY");
  if (missing.length > 0) {
    throw new Error(`Worker preflight failed; missing: ${missing.join(", ")}.`);
  }

  return {
    status: "ready",
    revision,
    handlers: {
      "publish.meta.execute": "loaded",
      "reporting.refresh": "loaded",
    },
    routing: { vpsOnly: true },
    runtime: {
      providerWritesEnabled: true,
      supabaseUrlPresent: true,
      supabaseCredentialPresent: true,
      tokenEncryptionKeyPresent: true,
      stripeSecretKeyPresent,
    },
  };
}

function readEmbeddedRevision(): string {
  try {
    const revision = readFileSync(new URL("../REVISION", import.meta.url), "utf8").trim();
    if (revision) return revision;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return process.env.BLOCKWISE_WORKER_REVISION?.trim() || "development";
}

function assertExpectedRevision(expected: string, actual = readEmbeddedRevision()): void {
  if (!/^[0-9a-f]{40}$/u.test(expected)) {
    throw new Error("Expected worker revision must be a full 40-character lowercase Git SHA.");
  }
  if (actual !== expected) {
    throw new Error(`Worker revision mismatch: expected ${expected}, image contains ${actual}.`);
  }
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  const expectedRevision = process.env.BLOCKWISE_WORKER_EXPECTED_REVISION?.trim();
  if (!expectedRevision) {
    throw new Error("BLOCKWISE_WORKER_EXPECTED_REVISION is required.");
  }
  await preflightWorker(expectedRevision);

  const supabase = createSupabaseServiceClient();
  const shutdownController = new AbortController();
  let shutdownRequested = false;
  const requestShutdown = (signal: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log(`${signal} received; stopping after the current job is safely released`);
    shutdownController.abort(new Error(`Worker shutdown requested by ${signal}.`));
  };
  const onSigterm = () => requestShutdown("SIGTERM");
  const onSigint = () => requestShutdown("SIGINT");
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  log(
    `starting: revision=${expectedRevision} pollIdle=${POLL_IDLE_MS}ms pollBusy=${POLL_BUSY_MS}ms lease=${LEASE_SECONDS}s heartbeatEvery=${HEARTBEAT_EVERY_MS}ms reapEvery=${REAP_EVERY_MS}ms`,
  );

  // Periodic reaper: self-heal jobs held by a dead worker. This is the core
  // recovery mechanism for a worker crash or host restart.
  const reaper = setInterval(() => void reap(supabase), REAP_EVERY_MS);
  reaper.unref?.();
  await reap(supabase);

  // Single-threaded claim loop. claim_job_v2 is concurrency-safe (FOR UPDATE SKIP
  // LOCKED), so multiple worker replicas can run this same loop without
  // double-processing. One job at a time keeps provider side-effects ordered
  // per worker and bounded.
  try {
    while (!shutdownRequested) {
      try {
        const did = await runOnce(supabase, { shutdownSignal: shutdownController.signal });
        if (!shutdownRequested) await sleep(did ? POLL_BUSY_MS : POLL_IDLE_MS);
      } catch (err) {
        if (err instanceof WorkerRestartRequiredError) throw err;
        log(`loop error: ${err instanceof Error ? err.message : String(err)}`);
        if (!shutdownRequested) await sleep(POLL_IDLE_MS);
      }
    }
  } finally {
    clearInterval(reaper);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
  }
}

async function entrypoint(args: string[]): Promise<void> {
  if (args[0] === "--preflight") {
    const expectedIndex = args.indexOf("--expect-revision");
    const expectedRevision = expectedIndex >= 0 ? args[expectedIndex + 1] : undefined;
    if (expectedIndex >= 0 && !expectedRevision) {
      throw new Error("--expect-revision requires a full Git SHA.");
    }
    const recognizedLength = expectedIndex >= 0 ? 3 : 1;
    if (args.length !== recognizedLength) {
      throw new Error("Unknown worker preflight argument.");
    }
    console.log(JSON.stringify(await preflightWorker(expectedRevision)));
    return;
  }
  if (args.length > 0) {
    throw new Error(`Unknown worker argument: ${args[0]}`);
  }
  await main();
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  process.on("unhandledRejection", (reason) => {
    console.error("[worker] unhandled rejection:", reason);
    process.exit(1);
  });
  entrypoint(process.argv.slice(2)).catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
}
