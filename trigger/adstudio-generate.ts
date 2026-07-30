import { task } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import { recordWorkspaceFunnelEventBestEffort } from "../src/lib/analytics/progressive-funnel.ts";
import {
  runTemplateCampaignGeneration,
  type CreateCampaignBody,
} from "../src/lib/adstudio/generate-template-campaign.ts";
import {
  type AdStudioGenerationCreditReservation,
} from "../src/lib/adstudio/generation-credits.ts";
import { refundOutstandingWorkspaceCredits } from "../src/lib/credits/workspace-credits.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";


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
  reservation?: AdStudioGenerationCreditReservation | null;
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
        workspaceName: stored.workspaceName,
        region: stored.region,
        creditReservation: reservation ?? undefined,
      });

      // "done" the moment the feed (4:5) persists — the polling client shows
      // the ad now. The Story render and advisory editing plate finish after.
      await supabase
        .from("adstudio_creative_jobs")
        .update({
          status: "done",
          campaign_id: result.campaignId,
          error: null,
          updated_at: now(),
        })
        .eq("workspace_id", payload.workspaceId)
        .eq("id", payload.jobId);
      await recordWorkspaceFunnelEventBestEffort(supabase, {
        eventName: "first_generation_completed",
        workspaceId: payload.workspaceId,
        idempotencyKey: `activation:${payload.workspaceId}:first-generation-completed`,
        properties: {
          mutation_key: reservation?.mutationKey ?? payload.jobId,
          campaign_id: result.campaignId,
          execution: "trigger",
        },
      });

      // Regions were persisted with the feed. Finish the optional text-free
      // plate in the background without gating ad or editor availability.
      await result.editingLayersTask;

      // Await the story (9:16) background persist so it lands before the
      // trigger task completes (the job is already marked "done" above).
      // Never throws outward — story failure is contained inside the task.
      if (result.storyTask) await result.storyTask;

      return { jobId: payload.jobId, status: "done" as const, campaignId: result.campaignId };
    } catch (error) {
      Sentry.captureException(error);
      // Return only the renders that are still outstanding. A persisted Feed
      // remains settled even when the optional Story path fails later.
      await refundOutstandingWorkspaceCredits({
        reservation,
        mutationKey: `${reservation?.mutationKey ?? payload.jobId}:refund:job-failure`,
        reason: "generation_job_failed",
        serviceSupabase: supabase,
      });

      const message = error instanceof Error ? error.message : "Ad generation failed.";
      await supabase
        .from("adstudio_creative_jobs")
        .update({ status: "failed", error: message, updated_at: now() })
        .eq("workspace_id", payload.workspaceId)
        .eq("id", payload.jobId);

      // The job row carries the failure to the polling client. Deliberately no
      // rethrow: a trigger.dev retry would re-run generation after the credit
      // was already refunded (double-refund / double-spend).
      return { jobId: payload.jobId, status: "failed" as const, error: message };
    }
  },
});
