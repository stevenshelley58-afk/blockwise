import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { loadAdStudioLibraryPage } from "@/lib/adstudio/library-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "assets" && kind !== "ads") {
    return NextResponse.json({ error: "Library kind must be assets or ads." }, { status: 400 });
  }
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 24;

  try {
    const page = await loadAdStudioLibraryPage({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      kind,
      limit,
      cursor: request.nextUrl.searchParams.get("cursor"),
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json(
      { error: "Library could not be loaded." },
      { status: 500 },
    );
  }
}
