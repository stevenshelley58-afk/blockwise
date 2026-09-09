import { NextResponse, type NextRequest } from "next/server";
import { readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { getLatestVideoRenderJob, getVideoProject, updateVideoProject, type UpdateVideoProjectInput } from "@/lib/adstudio/video/repository";
import { VIDEO_BUCKET } from "@/lib/adstudio/video/storage";
import { parseVideoProjectInput, VideoValidationError } from "@/lib/adstudio/video/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  try {
    const project = await getVideoProject({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    }, id);
    const job = await getLatestVideoRenderJob({ supabase: access.supabase, workspaceId: access.access.workspaceId, userId: access.access.userId }, id);
    const media = job && job.status === "succeeded"
      ? await signedRenderMedia(access.supabase, access.access.workspaceId, job)
      : { renderUrl: null, posterUrl: null, captionsUrl: null };
    return NextResponse.json({ project, renderJob: job, ...media }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (errorCode(error) === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    return NextResponse.json({ error: "Video project could not be loaded." }, { status: 500 });
  }
}

async function signedRenderMedia(supabase: Parameters<typeof getVideoProject>[0]["supabase"], workspaceId: string, job: import("@/lib/adstudio/video/repository").VideoRenderJob) {
  const ids = [job.outputMp4AssetId, job.outputPosterAssetId, job.outputCaptionsAssetId].filter((id): id is string => Boolean(id));
  if (!ids.length) return { renderUrl: null, posterUrl: null, captionsUrl: null };
  const { data, error } = await supabase.from("ad_video_assets")
    .select("id, object_path, mime_type, validation_status")
    .eq("workspace_id", workspaceId).eq("validation_status", "validated").in("id", ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map((asset) => [asset.id, asset]));
  const sign = async (id: string | null, expectedMime: string | string[]) => {
    if (!id) return null;
    const asset = byId.get(id);
    const allowedMime = Array.isArray(expectedMime) ? expectedMime.includes(asset?.mime_type) : asset?.mime_type === expectedMime;
    if (!asset || !allowedMime || !asset.object_path.startsWith(`${workspaceId}/`) || asset.object_path.includes("..")) return null;
    const result = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(asset.object_path, 3600);
    return result.error ? null : result.data?.signedUrl ?? null;
  };
  return {
    renderUrl: await sign(job.outputMp4AssetId, "video/mp4"),
    posterUrl: await sign(job.outputPosterAssetId, ["image/jpeg", "image/png"]),
    captionsUrl: await sign(job.outputCaptionsAssetId, "text/vtt"),
  };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const body = await readJsonBody<Record<string, unknown>>(request);
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return NextResponse.json({ error: "A valid expectedVersion is required." }, { status: 400 });
  }
  const patch: UpdateVideoProjectInput = {};
  const projectValue = body.project ?? body.projectJson;
  if (projectValue !== undefined) {
    try { patch.project = parseVideoProjectInput(projectValue, { requireReadiness: false, workspaceId: access.access.workspaceId }); }
    catch (error) {
      if (error instanceof VideoValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
      return NextResponse.json({ error: "The video project data is invalid." }, { status: 400 });
    }
  }
  const planValue = body.plan ?? body.planJson;
  if (planValue !== undefined) patch.plan = planValue;
  // Lifecycle status is server-owned (script generation and render workers
  // advance it); accepting it here would let a client bypass readiness gates.
  for (const key of ["templateId", "brandKitId", "customerAdId"] as const) {
    if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "No editable video project fields were provided." }, { status: 400 });
  try {
    const project = await updateVideoProject({ supabase: access.supabase, workspaceId: access.access.workspaceId, userId: access.access.userId }, id, patch, Number(expectedVersion));
    return NextResponse.json({ project });
  } catch (error) {
    const code = errorCode(error);
    if (code === "video_project_conflict") return NextResponse.json({ error: "The video changed elsewhere. Refresh and try again." }, { status: 409 });
    if (code === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    if (code === "video_project_invalid") return NextResponse.json({ error: "The video project data is invalid." }, { status: 400 });
    return NextResponse.json({ error: "Video project could not be updated." }, { status: 500 });
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
