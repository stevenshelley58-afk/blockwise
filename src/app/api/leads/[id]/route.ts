import { NextResponse, type NextRequest } from "next/server";

import { crmErrorResponse, requireLeadApiContext } from "@/lib/leads/api-context";
import { mergeLeadRows } from "@/lib/leads/read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

/** GET /api/leads/[id] - detail with the activity timeline and tasks. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const guard = await requireLeadApiContext(request, request.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;
  const { context: ctx } = guard;

  try {
    const [lead, activities, tasks] = await Promise.all([
      ctx.commands.getLead(id),
      ctx.commands.listActivities(id),
      ctx.commands.listTasks({ limit: 200 }),
    ]);

    const { data: deliveryRows } = await ctx.serviceSupabase
      .from("lead_crm_delivery_jobs")
      .select("lead_id, crm_lead, state, backfill")
      .eq("workspace_id", ctx.access.workspaceId)
      .eq("crm_lead", id)
      .maybeSingle();

    const delivery = deliveryRows ? [deliveryRows] : [];
    const blockwiseLeadId = (deliveryRows as { lead_id?: string | null } | null)?.lead_id ?? null;

    const [quality, duplicates] = blockwiseLeadId
      ? await Promise.all([
          ctx.serviceSupabase
            .from("lead_quality_labels")
            .select("lead_id, label")
            .eq("workspace_id", ctx.access.workspaceId)
            .eq("lead_id", blockwiseLeadId),
          ctx.serviceSupabase
            .from("lead_dedupe_records")
            .select("lead_id, duplicate_of_lead_id")
            .eq("workspace_id", ctx.access.workspaceId)
            .eq("lead_id", blockwiseLeadId),
        ])
      : [{ data: [] }, { data: [] }];

    const [row] = mergeLeadRows({
      leads: [{ ...lead, nextTask: null }],
      quality: (quality.data ?? []) as Array<{ lead_id: string; label: string }>,
      duplicates: (duplicates.data ?? []) as Array<{ lead_id: string; duplicate_of_lead_id: string | null }>,
      delivery: delivery as Array<{ lead_id: string; crm_lead: string | null; state: string | null; backfill: boolean | null }>,
      tasks: tasks.filter((task) => task.referenceDocname === id),
    });

    return NextResponse.json({
      workspaceId: ctx.access.workspaceId,
      lead: row,
      tasks: tasks.filter((task) => task.referenceDocname === id),
      activities,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
