import { tasks } from "@trigger.dev/sdk/v3";

import {
  buildTemplatePhotoPrepTaskKeys,
  type AdStudioTemplatePhotoPrepPayload,
} from "./template-photo-prep-job.ts";
import type { AdStudioFormat } from "./types.ts";

export type TemplatePhotoPrepQueueResult = {
  status: "skipped" | "queued" | "queue_failed";
  pendingFormats: AdStudioFormat[];
  taskId?: string;
  error?: string;
};

export async function queueAdStudioTemplatePhotoPrep(
  payload: AdStudioTemplatePhotoPrepPayload,
  pendingFormats: AdStudioFormat[],
): Promise<TemplatePhotoPrepQueueResult> {
  const uniquePendingFormats = [...new Set(pendingFormats)];
  if (!payload.sourceImageForModel || uniquePendingFormats.length === 0) {
    return { status: "skipped", pendingFormats: [] };
  }

  try {
    const keys = buildTemplatePhotoPrepTaskKeys(payload);
    const run = await tasks.trigger(
      "adstudio.template-photo-prep",
      {
        ...payload,
        formats: uniquePendingFormats,
      },
      {
        idempotencyKey: keys.idempotencyKey,
        concurrencyKey: keys.concurrencyKey,
        tags: ["adstudio-photo-prep", payload.workspaceId, payload.campaignId ?? "cache", keys.contentKey],
        maxAttempts: 2,
      },
    );

    return {
      status: "queued",
      pendingFormats: uniquePendingFormats,
      taskId: typeof (run as { id?: unknown }).id === "string" ? (run as { id: string }).id : undefined,
    };
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warning",
      msg: "adstudio_template_photo_prep_queue_failed",
      workspaceId: payload.workspaceId,
      campaignId: payload.campaignId ?? null,
      pendingFormats: uniquePendingFormats,
      error: error instanceof Error ? error.message : String(error),
    }));

    return {
      status: "queue_failed",
      pendingFormats: uniquePendingFormats,
      error: error instanceof Error ? error.message : "Template photo prep could not be queued.",
    };
  }
}
