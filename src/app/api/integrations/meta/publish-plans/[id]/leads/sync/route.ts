import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import { queueMetaLeadSync } from "@/lib/providers/meta-leads-queue";
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
  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"));

  if (!guard.ok) return guard.response;
  const { access } = guard;

  const plan = await loadMetaPublishPlan(createSupabaseServiceClient(), {
    workspaceId: access.workspaceId,
    planId: id,
  });
  const queued = await queueMetaLeadSync({
    workspaceId: access.workspaceId,
    planId: plan.planId,
    since: body.since ?? null,
  });

  return NextResponse.json({
    planId: plan.planId,
    queueJobId: queued.id ?? null,
  });
}
