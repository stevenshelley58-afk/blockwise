import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getVideoProject } from "@/lib/adstudio/video/repository";

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
    return NextResponse.json({ project });
  } catch (error) {
    if (errorCode(error) === "video_project_not_found") return NextResponse.json({ error: "Video project not found." }, { status: 404 });
    return NextResponse.json({ error: "Video project could not be loaded." }, { status: 500 });
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
