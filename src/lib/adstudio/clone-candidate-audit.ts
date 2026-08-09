import { persistCloneRender } from "./clone-generation.ts";
import { cloneRequestHash } from "./clone-quality-gate.ts";
import type { ImageProviderRequest } from "./providers.ts";
import type { AdStudioCloneQualityReview } from "./types.ts";

export type CloneCandidateQaStatus = "pending" | "passed" | "rejected" | "technical_failed" | "aborted";

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
  /** Required on the first write; later QA updates reuse this durable path. */
  candidateImage?: string;
  candidateImagePath?: string;
  review?: AdStudioCloneQualityReview;
  qaStatus?: CloneCandidateQaStatus;
  /** Technical QA failed before it could produce a valid review. */
  qaError?: string;
  accepted: boolean;
}): Promise<string> {
  const candidateImagePath = input.candidateImagePath ?? (input.candidateImage
    ? await persistCloneRender({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      assetUrl: input.candidateImage,
      fileNameSeed: `${input.correlationId}-qa-${input.format.replace(":", "x")}-attempt-${input.attempt}`,
    })
    : null);
  if (!candidateImagePath) throw new Error("Clone candidate audit requires a generated image or its durable storage path.");
  const qaStatus = input.qaStatus
    ?? (input.review ? (input.accepted ? "passed" : "rejected") : (input.qaError ? "technical_failed" : "pending"));
  const row = {
    workspace_id: input.workspaceId,
    correlation_id: input.correlationId,
    template_id: input.templateId,
    format: input.format,
    attempt: input.attempt,
    request_hash: cloneRequestHash(input.request),
    candidate_image_path: candidateImagePath,
    accepted: input.accepted,
    qa_status: qaStatus,
    qa_error: input.qaError ? sanitizeQaError(input.qaError) : null,
    review_json: input.review ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await input.supabase
    .from("adstudio_clone_candidate_audits")
    .upsert(row, { onConflict: "workspace_id,correlation_id,format,attempt" });
  if (error) throw new Error(`Clone candidate audit could not be recorded (${error.message}).`);
  return candidateImagePath;
}

function sanitizeQaError(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 1_000) || "Clone QA failed without a provider error message.";
}
