import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const patch = variantPatch(body);
  const { data, error } = await access.supabase
    .from("adstudio_campaign_variants")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ variant: data });
}

function variantPatch(body: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "name",
    "format",
    "platform",
    "dimensions_json",
    "copy_json",
    "creative_refs_json",
    "status",
    "notes",
  ];
  return Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
}
