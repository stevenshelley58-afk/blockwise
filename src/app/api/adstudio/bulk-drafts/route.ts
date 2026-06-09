import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// GET /api/adstudio/bulk-drafts?workspaceId=...&format=1:1&status=draft&page=0
export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const { searchParams } = request.nextUrl;
  const format = searchParams.get("format");
  const status = searchParams.get("status") ?? "draft";
  const page = Math.max(0, Number(searchParams.get("page") ?? "0"));

  let query = access.supabase
    .from("adstudio_campaign_variants")
    .select("id, campaign_id, angle, headline, status, score_json, updated_at")
    .eq("workspace_id", access.access.workspaceId)
    .like("angle", "bulk:%")
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  // Optional format filter: angle is 'bulk:<format>' so we can filter by that prefix.
  if (format) {
    query = query.like("angle", `bulk:${format}`);
  }

  const { data: variants, error } = await query;
  if (error) return errorResponse(error);

  const variantIds = (variants ?? []).map((v: { id: string }) => v.id);

  let creativeMap: Record<string, { format: unknown; canvas_json: unknown }> = {};
  if (variantIds.length > 0) {
    const { data: creativeRows } = await access.supabase
      .from("adstudio_creatives")
      .select("variant_id, format, canvas_json")
      .in("variant_id", variantIds);

    for (const row of creativeRows ?? []) {
      const r = row as { variant_id: string; format: unknown; canvas_json: unknown };
      creativeMap[r.variant_id] = r;
    }
  }

  const drafts = (variants ?? []).map((v: {
    id: string;
    campaign_id: string;
    angle: string;
    headline: string;
    status: string;
    score_json: Record<string, unknown> | null;
    updated_at: string;
  }) => {
    const creative = creativeMap[v.id];
    const canvasMeta = (
      (creative?.canvas_json as Record<string, unknown> | null)?.metadata as Record<string, unknown> | null
    ) ?? {};

    return {
      variantId: v.id,
      campaignId: v.campaign_id,
      angle: v.angle,
      headline: v.headline,
      status: v.status,
      score: (v.score_json?.score as number) ?? 0,
      format: creative?.format ?? null,
      imageUrl: canvasMeta.image_url ?? null,
      copyText: canvasMeta.copy_text ?? null,
      styleGuidance: canvasMeta.style_guidance ?? null,
      qaGates: canvasMeta.qa_gates ?? null,
      updatedAt: v.updated_at,
    };
  });

  return NextResponse.json({
    drafts,
    page,
    pageSize: PAGE_SIZE,
    hasMore: drafts.length === PAGE_SIZE,
  });
}

// PATCH /api/adstudio/bulk-drafts
// Body: { variantId: string, action: "approve" | "dismiss" }
// approve → sets status="approved", flows to export pipeline
// dismiss → deletes auto-generated creative + variant (no human investment)
export async function PATCH(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const body = await readJsonBody<{ variantId?: string; action?: string }>(request);
  const { variantId, action } = body;

  if (!variantId || !action) {
    return NextResponse.json({ error: "variantId and action are required." }, { status: 400 });
  }

  if (action !== "approve" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'approve' or 'dismiss'." }, { status: 400 });
  }

  // Verify the variant belongs to this workspace and is a bulk draft.
  const { data: existing, error: lookupError } = await access.supabase
    .from("adstudio_campaign_variants")
    .select("id, status")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", variantId)
    .like("angle", "bulk:%")
    .maybeSingle();

  if (lookupError) return errorResponse(lookupError);
  if (!existing) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

  if (action === "approve") {
    const { data, error } = await access.supabase
      .from("adstudio_campaign_variants")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("workspace_id", access.access.workspaceId)
      .eq("id", variantId)
      .select("id, status, angle")
      .maybeSingle();

    if (error) return errorResponse(error);
    return NextResponse.json({ variant: data });
  }

  // dismiss: remove auto-generated creative then variant
  await access.supabase
    .from("adstudio_creatives")
    .delete()
    .eq("workspace_id", access.access.workspaceId)
    .eq("variant_id", variantId);

  const { error: deleteError } = await access.supabase
    .from("adstudio_campaign_variants")
    .delete()
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", variantId);

  if (deleteError) return errorResponse(deleteError);
  return NextResponse.json({ dismissed: true, variantId });
}
