import type { SupabaseClient } from "@supabase/supabase-js";
import { getVideoProject, queueVideoRender, videoRenderIdempotencyKey, type VideoProject, type VideoRenderJob, type VideoRepositoryContext } from "./repository.ts";

export type RenderProviderRequest = {
  jobId: string;
  workspaceId: string;
  projectId: string;
  project: Record<string, unknown>;
  plan: Record<string, unknown>;
};

export type RenderProviderOutput = {
  mp4AssetId: string;
  posterAssetId?: string | null;
  captionsAssetId?: string | null;
  providerJobId?: string | null;
  providerMetadata?: Record<string, unknown>;
  costMetadata?: Record<string, unknown>;
};

/** Implemented by the durable worker/provider, never by a Vercel request. */
export interface RenderProvider {
  readonly name: string;
  render(request: RenderProviderRequest): Promise<RenderProviderOutput>;
}

export type RenderQueueContract = {
  provider: string;
  idempotencyKey: string;
  projectVersion: number;
  status: "queued";
};

export async function enqueueVideoRender(ctx: VideoRepositoryContext, projectId: string): Promise<VideoRenderJob> {
  return queueVideoRender(ctx, projectId);
}

export function buildRenderQueueContract(project: VideoProject, provider = "pending-worker"): RenderQueueContract {
  return { provider, idempotencyKey: videoRenderIdempotencyKey(project), projectVersion: project.version, status: "queued" };
}

export async function claimNextVideoRenderJob(supabase: SupabaseClient, workspaceId: string): Promise<VideoRenderJob | null> {
  const found = await supabase.from("ad_video_render_jobs")
    .select("*").eq("workspace_id", workspaceId).eq("status", "queued").order("queued_at", { ascending: true }).limit(1).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  if (!found.data) return null;
  const now = new Date().toISOString();
  const claimed = await supabase.from("ad_video_render_jobs").update({ status: "running", attempts: (found.data.attempts ?? 0) + 1, started_at: now, updated_at: now })
    .eq("id", found.data.id).eq("workspace_id", workspaceId).eq("status", "queued").select("*").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return null;
  await supabase.from("ad_video_projects").update({ status: "rendering", updated_at: now })
    .eq("id", found.data.project_id).eq("workspace_id", workspaceId).in("status", ["render_queued", "queued"]);
  return mapJob(claimed.data);
}

export async function succeedVideoRenderJob(supabase: SupabaseClient, input: { workspaceId: string; projectId: string; jobId: string; output: RenderProviderOutput }): Promise<VideoRenderJob> {
  const now = new Date().toISOString();
  await assertValidatedRenderOutputs(supabase, input.workspaceId, input.output);
  const result = await supabase.from("ad_video_render_jobs").update({
    status: "succeeded", output_mp4_asset_id: input.output.mp4AssetId, output_poster_asset_id: input.output.posterAssetId ?? null,
    output_captions_asset_id: input.output.captionsAssetId ?? null, provider_job_id: input.output.providerJobId ?? null,
    provider_metadata_json: input.output.providerMetadata ?? {}, cost_metadata_json: input.output.costMetadata ?? {},
    finished_at: now, updated_at: now, error_code: null, error_message: null,
  }).eq("id", input.jobId).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("status", "running").select("*").single();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Render job is no longer running.");
  await supabase.from("ad_video_projects").update({ status: "succeeded", updated_at: now, completed_at: now })
    .eq("id", input.projectId).eq("workspace_id", input.workspaceId).eq("status", "rendering");
  return mapJob(result.data);
}

async function assertValidatedRenderOutputs(supabase: SupabaseClient, workspaceId: string, output: RenderProviderOutput): Promise<void> {
  const ids = [output.mp4AssetId, output.posterAssetId, output.captionsAssetId].filter((id): id is string => Boolean(id));
  const { data, error } = await supabase.from("ad_video_assets")
    .select("id, mime_type, asset_role, validation_status")
    .eq("workspace_id", workspaceId).eq("validation_status", "validated").in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((asset) => [asset.id, asset]));
  const mp4 = byId.get(output.mp4AssetId);
  if (!mp4 || mp4.mime_type !== "video/mp4" || mp4.asset_role !== "output") throw new Error("Render output MP4 is not a validated workspace asset.");
  if (output.posterAssetId) {
    const poster = byId.get(output.posterAssetId);
    if (!poster || !["image/jpeg", "image/png"].includes(poster.mime_type) || poster.asset_role !== "poster") throw new Error("Render poster is not a validated workspace asset.");
  }
  if (output.captionsAssetId) {
    const captions = byId.get(output.captionsAssetId);
    if (!captions || captions.mime_type !== "text/vtt" || captions.asset_role !== "captions") throw new Error("Render captions are not a validated workspace asset.");
  }
}

export async function failVideoRenderJob(supabase: SupabaseClient, input: { workspaceId: string; projectId: string; jobId: string; errorCode: string; errorMessage: string; retryable?: boolean }): Promise<VideoRenderJob> {
  const now = new Date().toISOString();
  const status = input.retryable ? "queued" : "failed";
  const result = await supabase.from("ad_video_render_jobs").update({ status, error_code: input.errorCode, error_message: input.errorMessage.slice(0, 2000), updated_at: now, ...(status === "failed" ? { finished_at: now } : {}) })
    .eq("id", input.jobId).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("status", "running").select("*").single();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Render job is no longer running.");
  await supabase.from("ad_video_projects").update({ status: input.retryable ? "render_queued" : "failed", updated_at: now, ...(status === "failed" ? { completed_at: now } : {}) })
    .eq("id", input.projectId).eq("workspace_id", input.workspaceId).eq("status", "rendering");
  return mapJob(result.data);
}

export async function loadRenderRequest(ctx: VideoRepositoryContext, job: Pick<VideoRenderJob, "projectId" | "id">): Promise<RenderProviderRequest> {
  const project = await getVideoProject(ctx, job.projectId);
  return { jobId: job.id, workspaceId: project.workspaceId, projectId: project.id, project: project.project, plan: project.plan };
}

function mapJob(row: any): VideoRenderJob {
  return { id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, status: row.status, attempts: row.attempts ?? 0, provider: row.provider ?? null, providerJobId: row.provider_job_id ?? null, providerMetadata: row.provider_metadata_json ?? {}, costMetadata: row.cost_metadata_json ?? {}, outputMp4AssetId: row.output_mp4_asset_id ?? null, outputPosterAssetId: row.output_poster_asset_id ?? null, outputCaptionsAssetId: row.output_captions_asset_id ?? null, idempotencyKey: row.idempotency_key, errorCode: row.error_code ?? null, errorMessage: row.error_message ?? null, createdAt: row.created_at, queuedAt: row.queued_at, startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null, updatedAt: row.updated_at };
}
