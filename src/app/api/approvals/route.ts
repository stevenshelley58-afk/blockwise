import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { listApprovalRows } from "@/lib/product/live-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "approvals");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  return NextResponse.json({ approvals: await listApprovalRows(supabase, access.workspaceId) });
}
