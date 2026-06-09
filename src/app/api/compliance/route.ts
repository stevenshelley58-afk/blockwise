import { NextRequest, NextResponse } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { evaluateRealEstateCompliance } from "@/lib/compliance/real-estate-policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const copy =
    request.nextUrl.searchParams.get("copy") ??
    "See recent buyer demand and comparable sales activity in your suburb before planning your next move.";

  return NextResponse.json({
    result: evaluateRealEstateCompliance({
      region: "AU",
      channel: "meta",
      copy,
    }),
  });
}
