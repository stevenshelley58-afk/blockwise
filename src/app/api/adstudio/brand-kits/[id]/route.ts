import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { isExampleBrandKitSourceUrl } from "@/lib/adstudio/persistence";
import { rowToBrandKit } from "@/lib/adstudio/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (error) return errorResponse(error);
  if (!data) return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });

  const brandKit = applyBrandAssetRows(
    rowToBrandKit(data),
    await loadAdStudioBrandAssetRows(access.supabase, access.access.workspaceId, id),
  );

  return NextResponse.json({ brandKit });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const patch = brandKitPatch(body);

  if (typeof patch.source_url === "string" && isExampleBrandKitSourceUrl(patch.source_url)) {
    return NextResponse.json({ error: "Demo brand kit URLs cannot be saved." }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from("adstudio_brand_kits")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);
  if (!data) return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });

  const brandKit = applyBrandAssetRows(
    rowToBrandKit(data),
    await loadAdStudioBrandAssetRows(access.supabase, access.access.workspaceId, id),
  );

  return NextResponse.json({ brandKit });
}

function brandKitPatch(body: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "source_type",
    "source_url",
    "business_name",
    "market_country",
    "market_region",
    "identity_json",
    "logos_json",
    "colours_json",
    "typography_json",
    "tone_json",
    "visual_style_json",
    "compliance_json",
    "contact_json",
    "review_status",
    "locked_fields_json",
  ];
  return Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
}
