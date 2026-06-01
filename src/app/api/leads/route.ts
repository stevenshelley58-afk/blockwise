import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/modules/auth/workspace-access";
import { listLeadRowsWithDedupe } from "@/modules/product/live-data";
import { createSupabaseServerClient } from "@/modules/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return NextResponse.json(await listLeadRowsWithDedupe(supabase, access.access.workspaceId));
}
