import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { loadAdStudioLibraryPage } from "@/lib/adstudio/library-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.searchParams.get("wave") !== "library") {
    return NextResponse.json({ error: "Unsupported bootstrap wave." }, { status: 400 });
  }
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "assets" && kind !== "ads") {
    return NextResponse.json({ error: "kind must be assets or ads." }, { status: 400 });
  }
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "24");
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 24;
  try {
    const page = await loadAdStudioLibraryPage({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      kind,
      limit,
      cursor: request.nextUrl.searchParams.get("cursor"),
      updatedAfter: request.nextUrl.searchParams.get("updated_after"),
    });
    return NextResponse.json(
      { kind, ...page },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Library page could not be loaded." },
      { status: 500 },
    );
  }
}
