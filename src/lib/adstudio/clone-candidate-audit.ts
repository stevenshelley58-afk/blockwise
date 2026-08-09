import { persistCloneRender } from "./clone-generation.ts";
import { cloneRequestHash } from "./clone-quality-gate.ts";
import type { ImageProviderRequest } from "./providers.ts";
import type { AdStudioCloneQualityReview } from "./types.ts";

export type CloneCandidateAuditClient = {
  storage: Parameters<typeof persistCloneRender>[0]["supabase"]["storage"];
  from(table: "adstudio_clone_candidate_audits"): {
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Store a paid candidate and its exact bound review outside the customer
 * campaign. Rejected candidates remain private evidence and are never used as
 * reference inputs for later full-ad generation.
 */
export async function recordCloneCandidateAudit(input: {
  supabase: CloneCandidateAuditClient;
  workspaceId: string;
  correlationId: string;
  templateId: string;
  format: "4:5" | "9:16";
  attempt: number;
  request: ImageProviderRequest;
  candidateImage: string;
  review: AdStudioCloneQualityReview;
  accepted: boolean;
}): Promise<string> {
  const candidateImagePath = await persistCloneRender({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    assetUrl: input.candidateImage,
    fileNameSeed: `${input.correlationId}-qa-${input.format.replace(":", "x")}-attempt-${input.attempt}`,
  });
  const row = {
    workspace_id: input.workspaceId,
    correlation_id: input.correlationId,
    template_id: input.templateId,
    format: input.format,
    attempt: input.attempt,
    request_hash: cloneRequestHash(input.request),
    candidate_image_path: candidateImagePath,
    accepted: input.accepted,
    review_json: input.review,
    updated_at: new Date().toISOString(),
  };
  const { error } = await input.supabase
    .from("adstudio_clone_candidate_audits")
    .upsert(row, { onConflict: "workspace_id,correlation_id,format,attempt" });
  if (error) throw new Error(`Clone candidate audit could not be recorded (${error.message}).`);
  return candidateImagePath;
}
