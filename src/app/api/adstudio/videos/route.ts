import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest, readJsonBody } from "@/lib/adstudio/http";
import { createVideoProject } from "@/lib/adstudio/video/repository";
import { parseVideoProjectInput, VideoValidationError } from "@/lib/adstudio/video/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  try {
    const input = parseVideoProjectInput(await readJsonBody<unknown>(request), { requireReadiness: false, workspaceId: access.access.workspaceId });
    const project = await createVideoProject({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    }, { project: input, plan: { scriptPlan: null }, status: "draft" });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return mapVideoError(error);
  }
}

function mapVideoError(error: unknown): NextResponse {
  if (error instanceof VideoValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
  const code = errorCode(error);
  if (code === "video_project_invalid") return NextResponse.json({ error: "The video project data is invalid." }, { status: 400 });
  if (code === "video_project_conflict") return NextResponse.json({ error: "The video changed elsewhere. Refresh and try again." }, { status: 409 });
  if (code === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
  return NextResponse.json({ error: "Video project could not be created." }, { status: 500 });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
