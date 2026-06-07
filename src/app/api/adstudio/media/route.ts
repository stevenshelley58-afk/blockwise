import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const path = request.nextUrl.searchParams.get("path")?.trim();

  if (!path) {
    return NextResponse.json({ error: "path is required." }, { status: 400 });
  }

  if (!path.startsWith(`${access.access.workspaceId}/`) || path.includes("..")) {
    return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
  }

  const { data, error } = await access.supabase.storage.from("workspace-artifacts").download(path);

  if (error || !data) {
    return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
  }

  return new NextResponse(data, {
    headers: {
      "content-type": data.type || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}
