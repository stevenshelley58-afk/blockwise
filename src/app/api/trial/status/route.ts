import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { loadTrialStatus } from "@/lib/trial/trial-status";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  try {
    const trial = await loadTrialStatus(
      (functionName, parameters) => supabase.rpc(functionName, parameters),
      access.workspaceId,
    );
    return NextResponse.json({ trial });
  } catch {
    return NextResponse.json({ trial: null });
  }
}
