import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { ManualPublishError, getManualPublishRequest } from "@/lib/adstudio/manual-publish";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> | { requestId: string } };

/** Serve only the two exact assets captured on a manual request to operators. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const { requestId } = await Promise.resolve(context.params);
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const path = request.nextUrl.searchParams.get("path")?.trim();
  if (!workspaceId || !path) return NextResponse.json({ error: "workspaceId and path are required." }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const manualRequest = await getManualPublishRequest(service, { mutationId: requestId });
    if (!manualRequest || manualRequest.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
    }
    if (path !== manualRequest.feedPngPath && path !== manualRequest.storyPngPath) {
      return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
    }
    if (!path.startsWith(`${workspaceId}/`) || path.includes("..")) {
      return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
    }

    const { data, error } = await service.storage.from("workspace-artifacts").download(path);
    if (error || !data) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
    return new NextResponse(data, {
      headers: {
        "content-type": data.type || "application/octet-stream",
        "content-disposition": "inline",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ManualPublishError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Operator manual publish media request failed", { requestId });
    return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
  }
}
