import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getVideoProject, queueVideoRender } from "@/lib/adstudio/video/repository";

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
  if (!project.plan || !project.plan.scriptPlan) return NextResponse.json({ error: "Create and review a script before rendering." }, { status: 422 });
  try {
    const queued = await queueVideoRender(repositoryContext, id);
    return NextResponse.json({ project: queued }, { status: 202 });
  } catch (error) {
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
