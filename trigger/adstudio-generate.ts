import { task } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import {
  runTemplateCampaignGeneration,
  type CreateCampaignBody,
} from "../src/lib/adstudio/generate-template-campaign.ts";
import {
  refundReservedTrialCredit,
  type AdStudioGenerationTrialReservation,
} from "../src/lib/adstudio/generation-trial.ts";
import { adStudioGenerationFailureMessage } from "../src/lib/adstudio/generation-mode.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

// Generous budget — the whole point of the async path is that copy + clone +
// QA rerolls never race a serverless timeout (trigger.config maxDuration still
// bounds the run).
const JOB_DEADLINE_MS = 8 * 60_000;
const MAX_CLONE_ATTEMPTS = 3;

type GenerateTemplateCampaignPayload = {
  workspaceId: string;
  userId: string;
  jobId: string;
  /** Absolute base URL for resolving the template's public sample image. */
  origin: string;
  body: CreateCampaignBody;
};

/** Extra request context the route stored on the job row (payload jsonb). */
type StoredJobPayload = {
  body?: CreateCampaignBody;
  reservation?: AdStudioGenerationTrialReservation | null;
  workspaceName?: string;
  region?: string;
};

export const generateAdStudioTemplateCampaignTask = task({
  id: "adstudio.generate.template",
  run: async (payload: GenerateTemplateCampaignPayload) => {
    const supabase = createSupabaseServiceClient();
    const now = () => new Date().toISOString();

    const job = await supabase
      .from("adstudio_creative_jobs")
      .select("id,status,attempts,payload,campaign_id")
      .eq("workspace_id", payload.workspaceId)
      .eq("id", payload.jobId)
      .maybeSingle();

    if (job.error) throw new Error(job.error.message);
    if (!job.data) throw new Error(`Ad Studio job ${payload.jobId} was not found.`);
    // Idempotency: a re-delivered task never regenerates a finished job.
    if (job.data.status === "done") {
      return { jobId: payload.jobId, status: "done" as const, campaignId: job.data.campaign_id as string | null };
    }

    const stored = (job.data.payload ?? {}) as StoredJobPayload;
    const reservation = stored.reservation ?? null;

    await supabase
      .from("adstudio_creative_jobs")
      .update({ status: "running", attempts: (Number(job.data.attempts) || 0) + 1, updated_at: now() })
      .eq("workspace_id", payload.workspaceId)
      .eq("id", payload.jobId);

    try {
      const result = await runTemplateCampaignGeneration({
        supabase,
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        origin: payload.origin,
        body: stored.body ?? payload.body,
        deadlineMs: JOB_DEADLINE_MS,
        maxCloneAttempts: MAX_CLONE_ATTEMPTS,
        workspaceName: stored.workspaceName,
        region: stored.region,
        isTrialWorkspace: reservation?.isTrialWorkspace ?? false,
      });

      await supabase
        .from("adstudio_creative_jobs")
        .update({
          status: "done",
          campaign_id: result.campaignId,
          qa: result.qa,
          error: null,
          updated_at: now(),
        })
        .eq("workspace_id", payload.workspaceId)
        .eq("id", payload.jobId);

      return { jobId: payload.jobId, status: "done" as const, campaignId: result.campaignId };
    } catch (error) {
      Sentry.captureException(error);
      // The route reserved the trial credit before enqueueing; a failed job
      // gives it back (no-op for paid workspaces via shouldRefund).
      await refundReservedTrialCredit(reservation, supabase);

      const quality = (stored.body ?? payload.body).firstAd.generationQuality ?? "fast";
      const message = adStudioGenerationFailureMessage(quality);
      await supabase
        .from("adstudio_creative_jobs")
        .update({ status: "failed", error: message, qa: null, updated_at: now() })
        .eq("workspace_id", payload.workspaceId)
        .eq("id", payload.jobId);

      // The job row carries the failure to the polling client. Deliberately no
      // rethrow: a trigger.dev retry would re-run generation after the credit
      // was already refunded (double-refund / double-spend).
      return { jobId: payload.jobId, status: "failed" as const, error: message };
    }
  },
});
