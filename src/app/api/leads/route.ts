import { NextResponse, type NextRequest } from "next/server";

import {
  resolveMemberCrmIdentity,
  requireLeadApiContext,
} from "@/lib/leads/api-context";
import { applyLeadFilters, mergeLeadRows, type LeadQualityLabel } from "@/lib/leads/read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUALITY_VALUES = new Set(["high_intent", "valid", "invalid"]);

/**
 * GET /api/leads
 * Query: workspaceId, search, stage, owner, mine, unassigned, followUpDue,
 *        source, quality, includeArchived, limit, offset
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const guard = await requireLeadApiContext(request, params.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const { context } = guard;
  const workspaceId = context.access.workspaceId;
  const limit = clampInt(params.get("limit"), 25, 1, 100);
  const offset = clampInt(params.get("offset"), 0, 0, 1000);
  const includeArchived = params.get("includeArchived") === "true";
  const quality = params.get("quality");
  const mine = params.get("mine") === "true";

  const currentOwner = mine || params.get("unassigned") !== null
    ? await resolveMemberCrmIdentity(context.serviceSupabase, workspaceId, context.access.userId)
    : null;

  try {
    // Server-side CRM filters keep the read bounded; the rest are applied to
    // the merged rows so Blockwise-owned facts can be filtered too.
    const leads = await context.commands.listLeads({
      includeArchived,
      stage: params.get("stage"),
      owner: params.get("owner"),
      limit: Math.min(limit + offset, 100),
      offset: 0,
    });

    const [{ data: deliveryRows }, tasks] = await Promise.all([
      context.serviceSupabase
        .from("lead_crm_delivery_jobs")
        .select("lead_id, crm_lead, state, backfill")
        .eq("workspace_id", workspaceId),
      context.commands.listTasks({ limit: 200 }).catch(() => []),
    ]);

    const delivery = (deliveryRows ?? []) as Array<{
      lead_id: string;
      crm_lead: string | null;
      state: string | null;
      backfill: boolean | null;
    }>;
    const leadIds = [...new Set(delivery.map((row) => row.lead_id).filter(Boolean))];

    const [qualityRows, duplicateRows] = leadIds.length
      ? await Promise.all([
          context.serviceSupabase
            .from("lead_quality_labels")
            .select("lead_id, label")
            .eq("workspace_id", workspaceId)
            .in("lead_id", leadIds),
          context.serviceSupabase
            .from("lead_dedupe_records")
            .select("lead_id, duplicate_of_lead_id")
            .eq("workspace_id", workspaceId)
            .in("lead_id", leadIds),
        ])
      : [{ data: [] }, { data: [] }];

    const merged = mergeLeadRows({
      leads,
      quality: (qualityRows.data ?? []) as Array<{ lead_id: string; label: string }>,
      duplicates: (duplicateRows.data ?? []) as Array<{ lead_id: string; duplicate_of_lead_id: string | null }>,
      delivery,
      tasks,
      currentOwner,
    });

    const filtered = applyLeadFilters(merged, {
      search: params.get("search"),
      stage: params.get("stage"),
      owner: params.get("owner"),
      mine,
      unassigned: params.get("unassigned") === null ? undefined : params.get("unassigned") === "true",
      followUpDue: params.get("followUpDue") === "true",
      source: params.get("source"),
      quality: quality && QUALITY_VALUES.has(quality) ? (quality as LeadQualityLabel) : null,
      includeArchived,
      currentOwner,
    });

    return NextResponse.json({
      workspaceId,
      leads: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
      crmPendingCount: filtered.filter((row) => row.crmDeliveryState === "pending").length,
      followUpDueCount: filtered.filter((row) => row.followUpDue).length,
    });
  } catch (error) {
    console.error("[leads-api] list failed", error);
    return NextResponse.json({ error: "The enquiry list could not be loaded." }, { status: 502 });
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}
