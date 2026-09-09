import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getVideoProject, queueVideoRender } from "@/lib/adstudio/video/repository";
import { parseVideoProjectInput, validateVideoScriptPlan, VideoValidationError } from "@/lib/adstudio/video/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const repositoryContext = { supabase: access.supabase, workspaceId: access.access.workspaceId, userId: access.access.userId };
  const limit = await checkRateLimit(access.supabase, access.access.workspaceId, access.access.userId, {
    windowSeconds: 60,
    maxRequests: 5,
    bucket: "adstudio-video-render",
  });
  if (!limit.ok) return NextResponse.json({ error: "Video rendering is temporarily limited. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  let project;
  try {
    project = await getVideoProject(repositoryContext, id);
  } catch (error) {
    if (errorCode(error) === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    return NextResponse.json({ error: "Video project could not be loaded." }, { status: 500 });
  }
  try {
    if (!project.plan || !project.plan.scriptPlan) return NextResponse.json({ error: "Create and review a script before rendering." }, { status: 422 });
    const projectInput = parseVideoProjectInput(project.project, { requireReadiness: true, workspaceId: access.access.workspaceId });
    validateVideoScriptPlan(project.plan.scriptPlan, projectInput);
    const queued = await queueVideoRender(repositoryContext, id);
    // Keep the project envelope used by the editor while exposing the durable
    // job separately for polling/diagnostics.
    const projectStatus = queued.status === "succeeded" ? "succeeded" : queued.status === "running" ? "rendering" : queued.status === "failed" ? "failed" : "render_queued";
    return NextResponse.json({ project: { ...project, status: projectStatus }, job: queued }, { status: 202 });
  } catch (error) {
    if (error instanceof VideoValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 422 });
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
    if (code === "video_project_conflict") return NextResponse.json({ error: "The video changed elsewhere. Refresh and try again." }, { status: 409 });
    if (code === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    if (code === "video_project_invalid") return NextResponse.json({ error: "The video project data is invalid." }, { status: 400 });
    if (code === "video_render_not_allowed") return NextResponse.json({ error: "This video is not ready to render." }, { status: 422 });
    return NextResponse.json({ error: "Video render could not be queued." }, { status: 503 });
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
