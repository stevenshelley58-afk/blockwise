import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VideoRepositoryContext = {
  supabase: SupabaseClient;
  workspaceId: string;
  userId?: string | null;
};

export type VideoProjectStatus = "draft" | "script_ready" | "queued" | "render_queued" | "rendering" | "succeeded" | "ready" | "failed" | "cancelled";
export type VideoRenderJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type VideoProject = {
  id: string;
  workspaceId: string;
  customerAdId: string | null;
  templateId: string | null;
  brandKitId: string | null;
  project: Record<string, unknown>;
  plan: Record<string, unknown>;
  /** Compatibility projection for the video script flow; canonical storage remains project_json. */
  scriptPlan: Record<string, unknown> | null;
  version: number;
  status: VideoProjectStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type VideoRenderJob = {
  id: string;
  workspaceId: string;
  projectId: string;
  status: VideoRenderJobStatus;
  attempts: number;
  provider: string | null;
  providerJobId: string | null;
  providerMetadata: Record<string, unknown>;
  costMetadata: Record<string, unknown>;
  outputMp4AssetId: string | null;
  outputPosterAssetId: string | null;
  outputCaptionsAssetId: string | null;
  idempotencyKey: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type CreateVideoProjectInput = {
  project?: unknown;
  projectJson?: unknown;
  plan?: unknown;
  planJson?: unknown;
  templateId?: string | null;
  brandKitId?: string | null;
  customerAdId?: string | null;
  status?: VideoProjectStatus;
};

export type UpdateVideoProjectInput = Partial<CreateVideoProjectInput>;

export class VideoRepositoryError extends Error {
  readonly code: "video_project_not_found" | "video_project_conflict" | "video_project_invalid" | "video_project_storage" | "video_render_not_allowed";
  constructor(code: VideoRepositoryError["code"], message: string) {
    super(message);
    this.name = "VideoRepositoryError";
    this.code = code;
  }
}

export class VideoProjectNotFoundError extends VideoRepositoryError {
  constructor(id: string) { super("video_project_not_found", `Video project ${id} was not found.`); }
}

export class VideoProjectConflictError extends VideoRepositoryError {
  constructor(id: string) { super("video_project_conflict", `Video project ${id} changed; reload before saving.`); }
}

const PROJECT_COLUMNS = "id, workspace_id, customer_ad_id, template_id, brand_kit_id, project_json, plan_json, version, status, created_by, created_at, updated_at, completed_at";
const JOB_COLUMNS = "id, workspace_id, project_id, status, attempts, provider, provider_job_id, provider_metadata_json, cost_metadata_json, output_mp4_asset_id, output_poster_asset_id, output_captions_asset_id, idempotency_key, error_code, error_message, created_at, queued_at, started_at, finished_at, updated_at";

export async function createVideoProject(ctx: VideoRepositoryContext, input: CreateVideoProjectInput): Promise<VideoProject> {
  const project = validatedJson(input.project ?? input.projectJson, "project");
  const plan = validatedJson(input.plan ?? input.planJson, "plan");
  const now = new Date().toISOString();
  const { data, error } = await ctx.supabase
    .from("ad_video_projects")
    .insert({
      workspace_id: ctx.workspaceId,
      customer_ad_id: input.customerAdId ?? null,
      template_id: normalizeOptional(input.templateId),
      brand_kit_id: input.brandKitId ?? null,
      project_json: project,
      plan_json: plan,
      status: input.status ?? "draft",
      created_by: ctx.userId ?? null,
      created_at: now,
      updated_at: now,
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error || !data) throw new VideoRepositoryError("video_project_storage", error?.message ?? "Video project could not be created.");
  return mapProject(data);
}

export async function getVideoProject(ctx: VideoRepositoryContext, id: string): Promise<VideoProject> {
  const { data, error } = await ctx.supabase
    .from("ad_video_projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) throw new VideoRepositoryError("video_project_storage", error.message);
  if (!data) throw new VideoProjectNotFoundError(id);
  return mapProject(data);
}

export async function updateVideoProject(
  ctx: VideoRepositoryContext,
  id: string,
  input: UpdateVideoProjectInput,
  expectedVersion: number,
): Promise<VideoProject> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new VideoProjectConflictError(id);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), version: expectedVersion + 1 };
  if (input.project !== undefined || input.projectJson !== undefined) patch.project_json = validatedJson(input.project ?? input.projectJson, "project");
  if (input.plan !== undefined || input.planJson !== undefined) patch.plan_json = validatedJson(input.plan ?? input.planJson, "plan");
  if (input.templateId !== undefined) patch.template_id = normalizeOptional(input.templateId);
  if (input.brandKitId !== undefined) patch.brand_kit_id = input.brandKitId;
  if (input.customerAdId !== undefined) patch.customer_ad_id = input.customerAdId;
  if (input.status !== undefined) patch.status = input.status;
  if (input.status === "succeeded" || input.status === "failed" || input.status === "cancelled") patch.completed_at = new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from("ad_video_projects")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .eq("version", expectedVersion)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error) throw new VideoRepositoryError("video_project_storage", error.message);
  if (data) return mapProject(data);
  const { data: existing, error: lookupError } = await ctx.supabase
    .from("ad_video_projects").select("id").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (lookupError) throw new VideoRepositoryError("video_project_storage", lookupError.message);
  if (!existing) throw new VideoProjectNotFoundError(id);
  throw new VideoProjectConflictError(id);
}

export async function queueVideoRender(ctx: VideoRepositoryContext, id: string): Promise<VideoRenderJob> {
  const project = await getVideoProject(ctx, id);
  if (["cancelled", "succeeded"].includes(project.status)) {
    throw new VideoRepositoryError("video_render_not_allowed", "Only a draft or failed video project can be queued.");
  }
  const idempotencyKey = videoRenderIdempotencyKey(project);
  const now = new Date().toISOString();
  const inserted = await ctx.supabase
    .from("ad_video_render_jobs")
    .upsert({
      workspace_id: ctx.workspaceId,
      project_id: project.id,
      status: "queued",
      idempotency_key: idempotencyKey,
      queued_at: now,
      updated_at: now,
    }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: false })
    .select(JOB_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) throw new VideoRepositoryError("video_project_storage", inserted.error?.message ?? "Video render could not be queued.");
  // This update is intentionally best effort only after the durable job exists;
  // a worker must never mistake a queued project for a publishable output.
  await ctx.supabase.from("ad_video_projects").update({ status: "queued", updated_at: now }).eq("id", id).eq("workspace_id", ctx.workspaceId);
  return mapJob(inserted.data);
}

export function videoRenderIdempotencyKey(project: Pick<VideoProject, "workspaceId" | "id" | "version" | "project" | "plan">): string {
  const fingerprint = createHash("sha256").update(stableJson({ project: project.project, plan: project.plan })).digest("hex");
  return `adstudio_video:${project.workspaceId}:${project.id}:v${project.version}:${fingerprint}`;
}

function validatedJson(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VideoRepositoryError("video_project_invalid", `${field} must be a JSON object.`);
  const json = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  if (JSON.stringify(json).length > 2_000_000) throw new VideoRepositoryError("video_project_invalid", `${field} is too large.`);
  return json;
}

function normalizeOptional(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

function mapProject(row: any): VideoProject {
  return {
    id: row.id, workspaceId: row.workspace_id, customerAdId: row.customer_ad_id ?? null,
    templateId: row.template_id ?? null, brandKitId: row.brand_kit_id ?? null,
    project: row.project_json ?? {}, plan: row.plan_json ?? {}, scriptPlan: row.plan_json?.scriptPlan ?? null, version: row.version,
    status: row.status, createdBy: row.created_by ?? null, createdAt: row.created_at,
    updatedAt: row.updated_at, completedAt: row.completed_at ?? null,
  };
}

function mapJob(row: any): VideoRenderJob {
  return {
    id: row.id, workspaceId: row.workspace_id, projectId: row.project_id, status: row.status,
    attempts: row.attempts ?? 0, provider: row.provider ?? null, providerJobId: row.provider_job_id ?? null,
    providerMetadata: row.provider_metadata_json ?? {}, costMetadata: row.cost_metadata_json ?? {},
    outputMp4AssetId: row.output_mp4_asset_id ?? null, outputPosterAssetId: row.output_poster_asset_id ?? null,
    outputCaptionsAssetId: row.output_captions_asset_id ?? null, idempotencyKey: row.idempotency_key,
    errorCode: row.error_code ?? null, errorMessage: row.error_message ?? null, createdAt: row.created_at,
    queuedAt: row.queued_at, startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null, updatedAt: row.updated_at,
  };
}
