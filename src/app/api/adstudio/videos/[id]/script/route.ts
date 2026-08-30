import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getVideoProject, updateVideoProject } from "@/lib/adstudio/video/repository";
import { generateVideoScript } from "@/lib/adstudio/video/script";
import { parseVideoProjectInput, VideoValidationError } from "@/lib/adstudio/video/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const repositoryContext = { supabase: access.supabase, workspaceId: access.access.workspaceId, userId: access.access.userId };
  let project;
  try {
    project = await getVideoProject(repositoryContext, id);
  } catch (error) {
    if (errorCode(error) === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    return NextResponse.json({ error: "Video project could not be loaded." }, { status: 500 });
  }

  const limit = await checkRateLimit(access.supabase, access.access.workspaceId, access.access.userId, {
    windowSeconds: 60,
    maxRequests: 5,
    bucket: "adstudio-video-script",
  });
  if (!limit.ok) return NextResponse.json({ error: "Script generation is temporarily limited. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  try {
    const projectInput = parseVideoProjectInput(project.project);
    const scriptPlan = await generateVideoScript(projectInput, { signal: request.signal });
    const updated = await updateVideoProject(repositoryContext, id, { plan: { ...project.plan, scriptPlan }, status: "draft" }, project.version);
    return NextResponse.json({ project: updated, scriptPlan });
  } catch (error) {
    if (error instanceof VideoValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 422 });
    const code = errorCode(error);
    if (code === "video_project_conflict") return NextResponse.json({ error: "The video changed elsewhere. Refresh and try again." }, { status: 409 });
    if (code === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    if (code === "video_project_invalid") return NextResponse.json({ error: "The video project data is invalid." }, { status: 400 });
    return NextResponse.json({ error: "Script generation is temporarily unavailable." }, { status: 503 });
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
