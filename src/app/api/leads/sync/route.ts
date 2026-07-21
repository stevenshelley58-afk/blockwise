import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { syncMetaLeadsForPlanById } from "@/lib/providers/meta-leads-worker";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirror the scheduled cron's plan eligibility: only plans that have been
// published far enough to own a lead form can be polled for leads.
const SYNCABLE_STATUSES = ["approved", "publishing", "paused_live"] as const;

type SyncBody = {
  workspaceId?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SyncBody;
  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const { access } = guard;

  const serviceSupabase = createSupabaseServiceClient();

  const { data: plans, error: plansError } = await serviceSupabase
    .from("meta_publish_plans")
    .select("id,status,reconciled_objects_json")
    .eq("workspace_id", access.workspaceId)
    .in("status", [...SYNCABLE_STATUSES])
    .limit(100);

  if (plansError) {
    return NextResponse.json({ error: plansError.message }, { status: 500 });
  }

  // Prefer paused_live (running) over publishing/approved; then first with a lead form.
  const rank: Record<string, number> = { paused_live: 0, publishing: 1, approved: 2 };
  const eligible = ((plans ?? []) as Array<{ id: string; status: string; reconciled_objects_json: { leadFormIds?: Record<string, string> } | null }>)
    .filter((plan) => Object.keys(plan.reconciled_objects_json?.leadFormIds ?? {}).length > 0)
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  const nowIso = new Date().toISOString();
  const { error: stampError } = await serviceSupabase
    .from("workspaces")
    .update({ last_meta_lead_sync_at: nowIso })
    .eq("id", access.workspaceId);

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      planId: null,
      fetched: 0,
      inserted: 0,
      duplicate: 0,
      syncedAt: nowIso,
      reason: "no_published_plan",
      ...(stampError ? { stampError: stampError.message } : {}),
    });
  }

  let fetched = 0;
  let inserted = 0;
  let duplicate = 0;
  let planId: string | null = null;
  let syncError: string | null = null;

  for (const plan of eligible) {
    try {
      const result = await syncMetaLeadsForPlanById({
        serviceSupabase,
        workspaceId: access.workspaceId,
        planId: plan.id,
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      fetched += result.fetched;
      inserted += result.inserted;
      duplicate += result.duplicate;
      planId ??= plan.id;
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Lead sync failed.";
    }
  }

  return NextResponse.json({
    ok: !syncError,
    planId,
    fetched,
    inserted,
    duplicate,
    syncedAt: nowIso,
    ...(syncError ? { error: syncError } : {}),
  });
}
