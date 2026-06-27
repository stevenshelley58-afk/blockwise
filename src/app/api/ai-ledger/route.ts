import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { listAiLedgerRows, type AiLedgerFilters } from "@/lib/operator/overview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "operator",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const filters: AiLedgerFilters = {
    userId: cleanParam(request.nextUrl.searchParams.get("userId")),
    model: cleanParam(request.nextUrl.searchParams.get("model")),
    task: cleanParam(request.nextUrl.searchParams.get("task")),
    day: cleanParam(request.nextUrl.searchParams.get("day")),
  };

  return NextResponse.json({
    aiLedger: await listAiLedgerRows(supabase, access.access.isOperator ? undefined : access.access.workspaceId, filters),
  });
}

function cleanParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
