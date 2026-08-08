import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  loadTemplateV2ByHash,
  matchesAdDocTemplatePin,
  redactTemplateV2ForCustomer,
  resolveReadyTemplateV2,
} from "@/lib/adstudio/v2/template-resolver";

// GET /api/adstudio/templates-v2/[id] — public reads expose only human-approved
// gallery docs. Immutable history is available solely to an authenticated
// workspace that owns a creative pinned to the requested template + hash.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  try {
    const templateHash = request.nextUrl.searchParams.get("hash");
    if (!templateHash) {
      const template = resolveReadyTemplateV2(id);
      if (!template) return NextResponse.json({ error: "Unknown template." }, { status: 404 });
      return NextResponse.json(redactTemplateV2ForCustomer(template));
    }

    const creativeId = request.nextUrl.searchParams.get("creativeId");
    if (!creativeId || !/^[0-9a-f-]{36}$/i.test(creativeId)) {
      return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    }
    const context = await requireAdStudioRequest(request);
    if (!context.ok) return context.response;

    const creative = await context.supabase
      .from("adstudio_creatives")
      .select("canvas_json")
      .eq("workspace_id", context.access.workspaceId)
      .eq("id", creativeId)
      .maybeSingle();
    if (creative.error) throw new Error(creative.error.message);
    if (!creative.data || !matchesAdDocTemplatePin(creative.data.canvas_json, {
      templateId: id,
      templateHash,
    })) {
      return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    }

    // The owning workspace can keep editing an immutable creative even if its
    // original template is later revised or demoted from the public gallery.
    const template = loadTemplateV2ByHash(id, templateHash);
    if (!template) return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    return NextResponse.json(redactTemplateV2ForCustomer(template));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Template failed validation." },
      { status: 500 },
    );
  }
}
