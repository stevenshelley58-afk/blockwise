import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { normalizeLeadQualityLabel } from "@/lib/operator/overview";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type QualityPatchBody = {
  workspaceId?: string;
  label?: unknown;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as QualityPatchBody;
  const label = normalizeLeadQualityLabel(typeof body.label === "string" ? body.label : null);
  const requestedWorkspaceId =
    typeof body.workspaceId === "string" ? body.workspaceId : request.nextUrl.searchParams.get("workspaceId");

  if (!label) {
    return NextResponse.json({ error: "label must be valid, invalid, or high_intent." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId,
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (access.access.role !== "owner" && access.access.role !== "admin" && access.access.role !== "operator") {
    return NextResponse.json({ error: "Lead quality changes require admin access." }, { status: 403 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const { data: lead, error: leadError } = await serviceSupabase
    .from("leads")
    .select("id")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (leadError || !lead) {
    return NextResponse.json({ error: leadError?.message ?? "Lead was not found." }, { status: 404 });
  }

  const { data: existingLabel, error: existingError } = await serviceSupabase
    .from("lead_quality_labels")
    .select("id")
    .eq("workspace_id", access.access.workspaceId)
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const payload = {
    workspace_id: access.access.workspaceId,
    lead_id: id,
    label,
    confidence: null,
    source: "manual",
  };
  const result = existingLabel?.id
    ? await serviceSupabase
      .from("lead_quality_labels")
      .update(payload)
      .eq("id", existingLabel.id)
      .eq("workspace_id", access.access.workspaceId)
      .select("lead_id,label")
      .single()
    : await serviceSupabase
      .from("lead_quality_labels")
      .insert(payload)
      .select("lead_id,label")
      .single();

  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error?.message ?? "Lead quality could not be saved." }, { status: 500 });
  }

  return NextResponse.json({
    leadId: result.data.lead_id,
    quality: result.data.label,
  });
}
