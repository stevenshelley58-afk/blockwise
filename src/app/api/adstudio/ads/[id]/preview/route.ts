import { NextResponse, type NextRequest } from "next/server";
import { adDocumentSchema, type AdDocumentParsed } from "../../../../../../../packages/ad-template-contract/src/schema.ts";
import { renderPlacement } from "../../../../../../../packages/ad-template-renderer/src/renderer.ts";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { containsInlineImageData } from "@/lib/adstudio/persisted-document";
import { resolveImageValues, resolveTemplateAssetValues } from "../save/route";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/lib/adstudio/document-token";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> | { id: string } };
export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);
  const body = await request.json().catch(() => ({})) as { document?: unknown; placement?: unknown };
  const placement = body.placement === "story" ? "story" : body.placement === "feed" ? "feed" : null;
  const parsed = adDocumentSchema.safeParse(body.document);
  if (!placement || !parsed.success) return NextResponse.json({ error: "Invalid preview request.", code: "invalid_preview" }, { status: 400 });
  const document = parsed.data as AdDocumentParsed;
  if (containsInlineImageData(document.sharedImageValues)) return NextResponse.json({ error: "Upload images before previewing this ad.", code: "image_upload_required" }, { status: 400 });
  const service = createSupabaseServiceClient();
  try {
    const { data: ad, error } = await access.supabase.from("ad_customer_ads").select("template_id").eq("id", id).eq("workspace_id", access.access.workspaceId).maybeSingle();
    if (error || !ad?.template_id || document.templateId !== ad.template_id) return NextResponse.json({ error: "Ad not found.", code: "ad_not_found" }, { status: 404 });
    const { data: row, error: templateError } = await service.from("ad_templates").select("template_json").eq("template_id", ad.template_id).maybeSingle();
    if (templateError || !row) return NextResponse.json({ error: "Template not found.", code: "template_not_found" }, { status: 404 });
    const template = row.template_json as Parameters<typeof renderPlacement>[0]["template"];
    const [customerImages, templateAssets] = await Promise.all([resolveImageValues(document, access.access.workspaceId, id, service), resolveTemplateAssetValues(id, access.access.workspaceId, service)]);
    const textValues = Object.fromEntries(template.textInputs.map(input => [input.key, document.sharedTextValues[input.key] ?? input.placeholder]));
    const result = await renderPlacement({ template, imageValues: { ...templateAssets, ...customerImages.bytes }, textValues, colourMap: document.resolvedColourMap, cropOverrides: placement === "feed" ? document.feedCropOverrides : document.storyCropOverrides }, placement);
    return new NextResponse(result.png, { headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-blockwise-document-hash": sha256Hex(document), "x-blockwise-template-hash": sha256Hex(template), "x-blockwise-renderer": "blockwise-ad-template-renderer" } });
  } catch (error) {
    console.error("Ad Studio canonical preview failed", { code: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Preview could not be rendered.", code: "preview_failed" }, { status: 400 });
  }
}

