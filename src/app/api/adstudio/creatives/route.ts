import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const allowed = creativesInsert(body);
  const { data, error } = await access.supabase
    .from("adstudio_creatives")
    .insert({
      ...allowed,
      workspace_id: access.access.workspaceId,
      render_status: "draft",
    })
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ creative: data }, { status: 201 });
}

function creativesInsert(body: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "campaign_id",
    "variant_id",
    "format",
    "ad_type",
    "primary_intent",
    "display_state",
    "creative_hash",
    "assets_json",
    "copy_json",
    "notes",
  ];
  return Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
}
