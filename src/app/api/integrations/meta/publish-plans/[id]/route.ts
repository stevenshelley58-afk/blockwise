import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const plan = await loadMetaPublishPlan(createSupabaseServiceClient(), {
      workspaceId: access.access.workspaceId,
      planId: id,
    });

    return NextResponse.json({
      status: plan.status,
      lastError: plan.lastError,
      reconciledObjects: {
        campaigns: plan.reconciledObjects.campaignId ? 1 : 0,
        leadForms: Object.keys(plan.reconciledObjects.leadFormIds).length,
        adSets: Object.keys(plan.reconciledObjects.adSetIds).length,
        creatives: Object.keys(plan.reconciledObjects.creativeIds).length,
        ads: Object.keys(plan.reconciledObjects.adIds).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta publish plan was not found." },
      { status: 404 },
    );
  }
}
