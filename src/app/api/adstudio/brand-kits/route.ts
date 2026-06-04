import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { rowToBrandKit } from "@/lib/adstudio/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const { data, error } = await context.supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", context.access.workspaceId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ brandKits: (data ?? []).map((row) => rowToBrandKit(row)) });
}
