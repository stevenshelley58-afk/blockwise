import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { resolveImageValues, resolveTemplateAssetValues } from "@/lib/adstudio/render-assets";
import { handleCanonicalPreview } from "@/lib/adstudio/canonical-preview";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getTemplateForInternalInspection } from "@/lib/adstudio/pack-gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);
  const body = await request.json().catch(() => ({})) as { document?: unknown; placement?: unknown };
  const placement = body.placement === "story" ? "story" : body.placement === "feed" ? "feed" : null;
  if (!placement) return NextResponse.json({ error: "Invalid preview request.", code: "invalid_preview" }, { status: 400 });
  try {
    const service = createSupabaseServiceClient();
    const output = await handleCanonicalPreview({
      adId: id,
      workspaceId: access.access.workspaceId,
      placement,
      document: body.document,
      deps: {
        loadAd: async (adId, workspaceId) => {
          const { data, error } = await access.supabase.from("ad_customer_ads").select("template_id").eq("id", adId).eq("workspace_id", workspaceId).maybeSingle();
          if (error || !data?.template_id) return null;
          return { templateId: data.template_id as string };
        },
        loadTemplate: templateId => getTemplateForInternalInspection(service, templateId),
        resolveImages: async (document, adId, workspaceId) => {
          const [customer, template] = await Promise.all([
            resolveImageValues(document, workspaceId, adId, service),
            resolveTemplateAssetValues(adId, workspaceId, service),
          ]);
          return { ...template, ...customer.bytes };
        },
      },
    });
    return new NextResponse(new Uint8Array(output.render.png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-blockwise-document-hash": output.documentHash,
        "x-blockwise-template-hash": `sha256:${output.templateHash}`,
        "x-blockwise-renderer": "blockwise-ad-template-renderer",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "preview_failed";
    const code = ["invalid_preview", "image_upload_required", "ad_not_found", "template_not_found"].includes(message)
      ? message
      : "preview_failed";
    const status = code === "ad_not_found" || code === "template_not_found" ? 404 : code === "image_upload_required" || code === "invalid_preview" ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "Preview could not be rendered." : code, code }, { status });
  }
}

