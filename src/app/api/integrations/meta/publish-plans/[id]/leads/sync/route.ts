import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import { queueMetaLeadSync } from "@/lib/providers/meta-leads-queue";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type SyncBody = {
  workspaceId?: string;
  since?: string | null;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as SyncBody;
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const plan = await loadMetaPublishPlan(createSupabaseServiceClient(), {
    workspaceId: access.access.workspaceId,
    planId: id,
  });
  const queued = await queueMetaLeadSync({
    workspaceId: access.access.workspaceId,
    planId: plan.planId,
    since: body.since ?? null,
  });

  return NextResponse.json({
    planId: plan.planId,
    triggerRunId: queued.id ?? null,
  });
}
